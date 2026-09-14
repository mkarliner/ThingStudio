# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/wifi_provision.py
#
# Boot-time WiFi self-provisioning: soft-AP + captive-portal DNS/HTTP, so a device whose deployed
# flow references an "unmanaged" thingstudio/config/wifi config can learn a real network's
# credentials from a phone/laptop instead of needing them baked into the flow. Scoped in
# docs/working-notes/outstanding-items/wifi-provisioning-captive-portal.md (2026-09-14 sessions,
# confirmed with Mike before this was written) -- read that file for the full decision trail; this
# header only restates what's load-bearing to understand the code below.
#
# **This is the first thing in this codebase that has to run before the listener starts and before
# any deployed flow's own code runs at all** (that file's own "Where this actually lives"
# section). listener.py's main() calls provision_if_needed() below, synchronously, before
# _resume_flow() -- see that call site's own comment for why it has to happen in that order: the
# flow's own generated wifiSetupStatement() code (wifi-status.ts) still runs exactly as it does
# today either way (it just finds the interface already connected by the time it runs, for the
# "unmanaged" case specifically -- `.active(True)` on an already-active+connected interface is a
# harmless no-op).
#
# Confirmed decisions this module implements (see the outstanding-items file for the full reasoning
# behind each, not restated here):
#   - Trigger: first-run only by default. A flow's WiFi config being "unmanaged" is what tells the
#     compiler to send this feature's marker at all (wifi-status.ts's computeWifiProvisionMarker(),
#     editor-side) -- this module itself only ever sees the two plain booleans that marker resolves
#     to (self_provision, allow_reprovision), not the config directly.
#   - A separate allow_reprovision flag (off by default) opts into reopening the portal on a later
#     connect failure, not just first-run -- Mike's explicit caveat: only safe on a trusted network,
#     since reopening an unauthenticated-by-default AP is itself an attack surface. The AP is WPA2
#     secured (not open) specifically to narrow that, not eliminate it.
#   - Credential persistence: a dedicated flash file this feature owns (_CRED_PATH below), not
#     ESP-IDF's NVS auto-reconnect cache -- that NVS mechanism is the confirmed root cause of the
#     redeploy-cleanup WiFi reconnect bug this project already hit once
#     (docs/working-notes/decisions/redeploy-network.md).
#   - AP password: settable, simple default ("thingstudio", DEFAULT_AP_PASSWORD below -- 11 chars,
#     clears WPA2-PSK's 8-char minimum). The actual "editor pushes a new value" mechanism isn't
#     built this pass (folds into the same pre-listener boot-sequence work, per the outstanding-items
#     file) -- load_ap_password()/set_ap_password() below just make the persisted file ready for it,
#     not a dead end, without a protocol message wired up to call set_ap_password() yet.
#
# Web server: hand-rolled, not tinyweb (this file's own earlier scoping-session research flagged
# tinyweb as the recommended vendor pick) -- reversed on reflection while actually implementing this:
# the real surface here is one GET (serve a form) and one POST (read it back), small enough that
# hand-rolling matches this project's own established preference for a small native implementation
# over a third-party dependency of uncertain maintenance currency (cbor.py's precedent, explicitly
# cited approvingly in third-party-licenses.md) better than vendoring does. Flagged as a reversal of
# the earlier written recommendation, not a silent change -- see the commit this lands in. The DNS
# catch-all responder was always going to be hand-rolled either way (every real implementation
# researched does the same -- no library covers it).
#
# Every phase in this file degrades to "give up, log clearly, return None/False" rather than raising
# -- this project's fault-handling-over-happy-path priority (CLAUDE.md), applied here the same way
# listener.py's own _resume_flow()/_handle_deploy() already apply it to a corrupt persisted flow: a
# bad captive-portal request is adversarial-shaped input (a stray phone probe, a malformed form post,
# a truncated read), never allowed to crash boot or wedge it past _PORTAL_TIMEOUT_S.

import sys

try:
    import network
except ImportError:
    network = None  # off-device (unix-port tests have no real radio) -- provision_if_needed() degrades below

try:
    import usocket as socket
except ImportError:
    try:
        import socket
    except ImportError:
        socket = None

try:
    import uselect as select
except ImportError:
    try:
        import select
    except ImportError:
        select = None

try:
    import ujson as json
except ImportError:
    import json

try:
    import utime as time
except ImportError:
    import time

try:
    import ubinascii
except ImportError:
    ubinascii = None

try:
    import os
except ImportError:
    os = None

# ---------------------------------------------------------------------------------------------
# Persisted state: the learned STA credential plus (optionally) an AP-password override. One file,
# not two -- both are small, both are this feature's own, and there's no case where a caller needs
# one without ever touching the other. THINGSTUDIO_WIFI_PROVISION_PATH is the same test-only-env-var-
# override pattern listener.py's own _FLOW_PATH uses (off-device tests have no device flash; real
# hardware never sets this).
# ---------------------------------------------------------------------------------------------

_CRED_PATH = "/_wifi_provision.json"
try:
    _CRED_PATH = os.getenv("THINGSTUDIO_WIFI_PROVISION_PATH", _CRED_PATH)
except (AttributeError, TypeError):
    pass  # os is None off-device without the env var set -- real 3s-style default stands

# docs/working-notes/outstanding-items/wifi-provisioning-captive-portal.md: "proposed default:
# thingstudio (11 chars), Mike's call to confirm or pick something else" -- confirmed as-is.
DEFAULT_AP_PASSWORD = "thingstudio"

# MicroPython's own network.WLAN(AP_IF) default static IP when no static_ip is configured -- relied
# on, not re-configured, so the DNS catch-all's answer (this constant) and the HTTP redirect's
# Location header (run_portal(), below) always agree with where the AP interface actually is.
_AP_IP = "192.168.4.1"

_PORTAL_TIMEOUT_S = 600  # 10 minutes -- bounded, not indefinite: boot must eventually continue even
# if no one ever provisions the device (fault-handling priority, same as every other bounded
# network-I/O timeout already in this project). Overridable for tests only, same convention as
# _BOOT_DELAY_S in listener.py.
try:
    _PORTAL_TIMEOUT_S = float(os.getenv("THINGSTUDIO_WIFI_PORTAL_TIMEOUT_S", str(_PORTAL_TIMEOUT_S)))
except (AttributeError, TypeError, ValueError):
    pass


def _load_state():
    try:
        with open(_CRED_PATH) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_state(data):
    try:
        with open(_CRED_PATH, "w") as f:
            json.dump(data, f)
    except OSError as e:
        print("WIFI_PROVISION_ERR could not persist %s: %r" % (_CRED_PATH, e))


def get_sta_credential():
    """Returns the persisted (ssid, password) this feature learned via a previous portal session, or
    None if nothing's been provisioned yet (the ordinary first-run case) or the file is missing/
    corrupt (same "degrade, never raise" contract listener.py's own _read_flow_meta() uses)."""
    data = _load_state()
    ssid, password = data.get("ssid"), data.get("password")
    if isinstance(ssid, str) and ssid and isinstance(password, str):
        return ssid, password
    return None


def save_credential(ssid, password):
    """Persists a freshly learned credential, preserving any already-stored AP-password override --
    a portal save only ever carries ssid/password, never touches that field."""
    data = _load_state()
    data["ssid"] = ssid
    data["password"] = password
    _save_state(data)


def get_ap_password():
    data = _load_state()
    override = data.get("apPassword")
    return override if isinstance(override, str) and override else DEFAULT_AP_PASSWORD


def set_ap_password(password):
    """Not called anywhere yet -- see this file's header on the not-yet-built editor->device push
    mechanism. Exists now so the persisted-file shape is ready for it without a later migration."""
    data = _load_state()
    data["apPassword"] = password
    _save_state(data)


# ---------------------------------------------------------------------------------------------
# DNS catch-all responder -- every real captive-portal implementation researched for this feature
# (outstanding-items/wifi-provisioning-captive-portal.md's research links) answers every query with
# the AP's own IP, regardless of what hostname was asked about; this is the standard trick, not a
# simplification specific to this project.
# ---------------------------------------------------------------------------------------------


def _build_dns_reply(query, ip_bytes):
    """Given one raw incoming DNS query packet, returns a reply answering the SAME question with a
    single A record pointing at ip_bytes (4 raw bytes) -- or None on malformed input (adversarial-
    input handling, same convention framing.py/protocol.py already apply to the real §13 wire
    protocol: degrade, don't raise)."""
    if not isinstance(query, (bytes, bytearray)) or len(query) < 12:
        return None
    txn_id = query[0:2]
    flags = b"\x81\x80"  # standard response, recursion available, no error
    qdcount = query[4:6]
    ancount = b"\x00\x01"
    nscount = b"\x00\x00"
    arcount = b"\x00\x00"
    header = txn_id + flags + qdcount + ancount + nscount + arcount
    # Question section: copied verbatim from the query, not re-parsed -- this is exactly what makes
    # this a *catch-all* responder (works identically no matter which hostname was asked about).
    question = bytes(query[12:])
    if len(question) < 5:  # smallest legal question: 1-byte empty-name terminator + 2-byte QTYPE + 2-byte QCLASS
        return None
    # Answer: a compression pointer to the question's name (0xC00C -> offset 12), TYPE A, CLASS IN,
    # a short TTL (60s -- this AP is short-lived by design), RDLENGTH 4, RDATA = the 4 IP bytes.
    answer = b"\xc0\x0c" + b"\x00\x01" + b"\x00\x01" + b"\x00\x00\x00\x3c" + b"\x00\x04" + bytes(ip_bytes)
    return header + question + answer


def _handle_dns(dns_sock):
    try:
        query, addr = dns_sock.recvfrom(512)
    except OSError:
        return
    reply = _build_dns_reply(query, bytes(int(x) for x in _AP_IP.split(".")))
    if reply is not None:
        try:
            dns_sock.sendto(reply, addr)
        except OSError:
            pass  # a probe that vanished mid-reply is not this loop's problem -- next iteration continues


# ---------------------------------------------------------------------------------------------
# Minimal hand-rolled HTTP -- see this file's header for why not a vendored library. Raw recv()
# calls rather than socket.makefile(), for the same board-portability reason listener.py avoids
# assuming a specific stdin API works identically everywhere (CLAUDE.md's board-idiosyncrasy
# corollary) -- makefile() support across MicroPython ports/versions isn't uniform enough to lean on
# for something this small.
# ---------------------------------------------------------------------------------------------


def _recv_http_request(conn, timeout_s=5):
    """Reads one HTTP request (request line + headers + body, if Content-Length is present) off
    `conn`. Bounded by timeout_s on the WHOLE read, not just the first byte -- a stalled or partial
    request must degrade to giving up, never hang the portal loop, same fault-handling priority as
    the rest of this project's network code (mirrors listener.py's own READ_TIMEOUT_S reasoning).
    Returns (method, path, body) or None on any parse/timeout/oversize failure."""
    conn.settimeout(timeout_s)
    buf = b""
    try:
        while b"\r\n\r\n" not in buf:
            chunk = conn.recv(1024)
            if not chunk:
                return None
            buf += chunk
            if len(buf) > 8192:  # a captive-portal probe or this feature's own tiny form post is
                return None  # nowhere near this size -- anything bigger is adversarial/garbled, not legitimate
        head, _, rest = buf.partition(b"\r\n\r\n")
        lines = head.split(b"\r\n")
        parts = lines[0].decode("utf-8", "replace").split(" ")
        if len(parts) < 2:
            return None
        method, path = parts[0], parts[1]
        content_length = 0
        for line in lines[1:]:
            if line.lower().startswith(b"content-length:"):
                try:
                    content_length = int(line.split(b":", 1)[1].strip())
                except ValueError:
                    content_length = 0
        body = rest
        while len(body) < content_length and len(body) < 8192:
            chunk = conn.recv(1024)
            if not chunk:
                break
            body += chunk
        return method, path, body[:content_length].decode("utf-8", "replace")
    except OSError:
        return None


def _http_response(status, body, content_type="text/html; charset=utf-8", extra_headers=""):
    body_bytes = body.encode("utf-8") if isinstance(body, str) else bytes(body)
    head = "HTTP/1.0 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n%s\r\n" % (
        status,
        content_type,
        len(body_bytes),
        extra_headers,
    )
    return head.encode("utf-8") + body_bytes


def _redirect_response():
    # Absolute URL, not "/" -- a relative redirect shows the PROBE's own hostname (e.g.
    # connectivitycheck.gstatic.com) in the OS's captive-portal UI instead of this device's, a
    # gotcha confirmed during this feature's own research (outstanding-items file's research links).
    return _http_response("302 Found", "", extra_headers="Location: http://%s/\r\n" % _AP_IP)


def _html_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _render_portal_page(networks, error=None):
    options = "".join('<option value="%s">%s</option>' % (_html_escape(n), _html_escape(n)) for n in networks)
    error_html = "<p style='color:#b00020'>%s</p>" % _html_escape(error) if error else ""
    return (
        "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' "
        "content='width=device-width,initial-scale=1'><title>Thingstudio WiFi setup</title></head>"
        "<body style='font-family:sans-serif;max-width:420px;margin:2em auto;padding:0 1em'>"
        "<h1>Connect this device to WiFi</h1>%s"
        "<form method='POST' action='/save'>"
        "<p><label>Network<br><select name='ssid' style='width:100%%'>%s</select></label></p>"
        "<p><label>Password<br><input type='password' name='password' style='width:100%%'></label></p>"
        "<button type='submit'>Connect</button>"
        "</form></body></html>"
    ) % (error_html, options)


def _url_unquote(s):
    s = s.replace("+", " ")
    b = s.encode("utf-8")
    out = bytearray()
    i = 0
    while i < len(b):
        if b[i : i + 1] == b"%" and i + 2 < len(b):
            try:
                out.append(int(bytes(b[i + 1 : i + 3]), 16))
                i += 3
                continue
            except ValueError:
                pass
        out.append(b[i])
        i += 1
    return bytes(out).decode("utf-8", "replace")


def _parse_form(body):
    """application/x-www-form-urlencoded -> dict, percent-decoded. A malformed pair is skipped, not
    fatal -- same "degrade, don't raise" convention as every other parser in this file."""
    result = {}
    for pair in body.split("&"):
        if "=" not in pair:
            continue
        key, _, value = pair.partition("=")
        result[_url_unquote(key)] = _url_unquote(value)
    return result


def _scan_networks(sta):
    try:
        results = sta.scan()
    except OSError:
        return []
    names = []
    for r in results:
        try:
            ssid = r[0].decode("utf-8", "replace")
        except (IndexError, AttributeError, TypeError):
            continue
        if ssid and ssid not in names:
            names.append(ssid)
    return names


def _try_connect(sta, ssid, password, timeout_s=15):
    if not sta.isconnected():
        sta.connect(ssid, password)
    deadline = time.ticks_add(time.ticks_ms(), int(timeout_s * 1000))
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        if sta.isconnected():
            return True
        time.sleep_ms(200)
    return False


def _handle_http(http_sock, sta):
    """Accepts and fully handles exactly one HTTP connection. Returns (ssid, password) once a
    submitted credential has been confirmed working (run_portal()'s own success signal), or None
    otherwise (including every ordinary GET of the form page itself)."""
    try:
        conn, _ = http_sock.accept()
    except OSError:
        return None
    try:
        req = _recv_http_request(conn)
        if req is None:
            return None
        method, path, body = req
        if method == "POST" and path == "/save":
            form = _parse_form(body)
            ssid = form.get("ssid", "")
            password = form.get("password", "")
            if not ssid:
                conn.sendall(_http_response("200 OK", _render_portal_page(_scan_networks(sta), error="Pick a network.")))
                return None
            if _try_connect(sta, ssid, password):
                conn.sendall(_http_response("200 OK", "<html><body>Connected. This page can be closed.</body></html>"))
                save_credential(ssid, password)
                return ssid, password
            conn.sendall(
                _http_response(
                    "200 OK", _render_portal_page(_scan_networks(sta), error="Could not connect -- check the password and try again.")
                )
            )
            return None
        if path == "/":
            conn.sendall(_http_response("200 OK", _render_portal_page(_scan_networks(sta))))
            return None
        # Any other path (OS captive-portal probes: /generate_204, /hotspot-detect.html, etc.) --
        # redirected to the real form, not 404'd (§ "Web server" of the outstanding-items research:
        # a web server that 404s unknown paths never triggers the OS's own captive-portal UI at all).
        conn.sendall(_redirect_response())
        return None
    finally:
        conn.close()


def run_portal(sta, ap_password):
    """Blocking: brings up the soft-AP + DNS + HTTP captive portal, waits (bounded by
    _PORTAL_TIMEOUT_S) for a submitted credential that actually connects, and returns (ssid,
    password) on success or None on timeout/setup failure. Never raises -- every phase degrades to
    'give up, log clearly, return None' rather than taking down boot (this file's header)."""
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    suffix = ubinascii.hexlify(ap.config("mac")).decode()[-4:] if ubinascii else "0000"
    ap_ssid = "Thingstudio-Setup-%s" % suffix
    try:
        ap.config(essid=ap_ssid, password=ap_password, authmode=network.AUTH_WPA2_PSK)
    except (OSError, ValueError) as e:
        print("WIFI_PROVISION_ERR AP config failed: %r -- giving up on this boot's provisioning attempt" % (e,))
        ap.active(False)
        return None

    dns_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    http_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = None
    try:
        dns_sock.bind(("0.0.0.0", 53))
        http_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        http_sock.bind(("0.0.0.0", 80))
        http_sock.listen(1)
    except OSError as e:
        print("WIFI_PROVISION_ERR could not open portal sockets: %r -- giving up on this boot's provisioning attempt" % (e,))
        dns_sock.close()
        http_sock.close()
        ap.active(False)
        return None

    print("WIFI_PROVISION_AP_UP ssid=%r" % ap_ssid)
    deadline = time.ticks_add(time.ticks_ms(), int(_PORTAL_TIMEOUT_S * 1000))
    try:
        while result is None and time.ticks_diff(deadline, time.ticks_ms()) > 0:
            remaining_s = max(0.1, time.ticks_diff(deadline, time.ticks_ms()) / 1000)
            readable, _, _ = select.select([dns_sock, http_sock], [], [], min(1.0, remaining_s))
            for s in readable:
                if s is dns_sock:
                    _handle_dns(dns_sock)
                elif s is http_sock:
                    result = _handle_http(http_sock, sta)
                    if result is not None:
                        break
    finally:
        dns_sock.close()
        http_sock.close()
        ap.active(False)

    if result is None:
        print("WIFI_PROVISION_TIMEOUT gave up after %ds with no working credential -- continuing boot without WiFi" % _PORTAL_TIMEOUT_S)
    return result


def provision_if_needed(self_provision, allow_reprovision):
    """The boot-time entry point listener.py's main() calls before _resume_flow() -- see that call
    site's own comment for exactly why that order matters. Returns True when the station interface
    should be considered ready (already connected via a stored credential, or freshly provisioned
    this call) or when this feature isn't in play for the deployed flow at all (self_provision is
    False -- the ordinary case for every flow that doesn't reference an "unmanaged" WiFi config,
    behaviorally unchanged from this feature's absence). Returns False when self_provision is True
    but no working connection was established -- boot continues regardless (run_portal()'s own
    header); the flow's own generated wifiSetupStatement() code still runs exactly as it does today
    either way.

    Trigger semantics (outstanding-items/wifi-provisioning-captive-portal.md, confirmed with Mike
    2026-09-14): first-run only by default -- a stored credential that fails to connect does NOT
    reopen the portal unless allow_reprovision is True, since re-exposing an AP any time WiFi drops
    is only safe on a trusted/physically-controlled network (Mike's own explicit caveat, carried into
    config-types.ts's field help text on the editor side, not just here)."""
    if network is None or socket is None or select is None:
        print("WIFI_PROVISION_SKIP no network/socket/select module on this port -- nothing to do")
        return not self_provision
    if not self_provision:
        return True

    sta = network.WLAN(network.STA_IF)
    sta.active(True)

    cred = get_sta_credential()
    if cred is not None:
        print("WIFI_PROVISION_TRY_STORED ssid=%r" % cred[0])
        if _try_connect(sta, cred[0], cred[1]):
            print("WIFI_PROVISION_CONNECTED (stored credential)")
            return True
        if not allow_reprovision:
            print(
                "WIFI_PROVISION_FAILED stored credential no longer works and this flow doesn't allow "
                "reprovisioning fallback -- continuing boot without WiFi. Enable the fallback only on "
                "a trusted network (config-types.ts's own field warns why)."
            )
            return False
        print("WIFI_PROVISION_REOPENING_PORTAL stored credential failed and this flow allows fallback reprovisioning")
    else:
        print("WIFI_PROVISION_FIRST_RUN no stored credential -- opening setup portal")

    result = run_portal(sta, get_ap_password())
    if result is None:
        return False
    print("WIFI_PROVISION_CONNECTED (freshly provisioned)")
    return True
