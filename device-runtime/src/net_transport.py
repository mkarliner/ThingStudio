# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/net_transport.py
#
# WiFi transport, device side (MVP item 6 -- docs/working-notes/wifi-transport-scoping.md).
#
# What it does:
#   - Watches the station interface. It never activates or connects WiFi itself: the flow's own
#     wifi_status node (or wifi_provision.py's captive portal) stays the one WiFi owner
#     (outstanding-items/wifi-single-owner-fix.md). Once the station has an IP AND a board password
#     is set (board_settings.py), it opens a TCP server on PORT; when either stops being true, it
#     closes it again.
#   - Answers a UDP probe on PROBE_PORT so the backend can list boards on the network. Stock
#     MicroPython answers mDNS `<hostname>.local` lookups but can't advertise a service, which is why
#     the list comes from this probe instead (decisions/wifi-transport.md).
#   - Runs one authenticated session at a time. The board speaks first:
#         board:   TSAUTH1 <hostname> <nonce hex> <salt hex> <iterations>
#         client:  TSAUTH1 <hex HMAC-SHA256(key, nonce)>
#         board:   TSAUTH OK            (or TSAUTH FAIL / TSAUTH BUSY / TSAUTH NOPASSWORD, then close)
#     After OK the connection carries exactly what the serial line carries: `F64:` protocol lines
#     both ways, plus the board's plain print() output toward the client.
#   - Mirrors output to the session with os.dupterm where the port has it (ESP32, rp2), so every
#     print() -- debug nodes, NODE_ERROR text, EXEC results -- reaches a WiFi-connected editor, not
#     just the F64 frames. Where there's no dupterm (the unix port these tests run on), only F64
#     lines are mirrored, via mirror_line() called from listener.py's _send_message.
#
# Fault handling (CLAUDE.md): every phase logs and degrades, never raises into the listener.
#   - Auth has a time limit (_AUTH_TIMEOUT_S) and a 1 s delay before FAIL, so guessing is slow.
#   - A session with no bytes from the client for _IDLE_TIMEOUT_S is dropped; the backend sends a
#     blank keepalive line every 30 s (tcp_relay.py), so only a vanished client hits this.
#   - The mirror buffer is bounded; if the client can't keep up, output is dropped and counted,
#     never allowed to block print() or grow without limit.
#   - dupterm deactivates a stream whose write() raises, so _Mirror.write() never raises.

import sys
import json

import uasyncio as asyncio

import board_settings

try:
    import os
except ImportError:
    os = None

try:
    import io

    _IOBase = io.IOBase
except (ImportError, AttributeError):
    _IOBase = object

PORT = 7462
PROBE_PORT = 7463
_TEST_IP = None
try:
    PORT = int(os.getenv("THINGSTUDIO_NET_PORT", str(PORT)))
    PROBE_PORT = int(os.getenv("THINGSTUDIO_NET_PROBE_PORT", str(PROBE_PORT)))
    # Off-device tests only: pretend the station is up at this address (the unix port has no
    # `network` module). Never set on a real board.
    _TEST_IP = os.getenv("THINGSTUDIO_NET_TEST_IP")
except (AttributeError, ValueError):
    pass

_AUTH_TIMEOUT_S = 10
_AUTH_FAIL_DELAY_MS = 1000
_IDLE_TIMEOUT_S = 90
_WATCH_TICK_MS = 250
_WATCH_NETWORK_EVERY = 8  # ticks -> check the station every 2 s
_WIFI_RETRY_S = 60  # after the WiFi driver fails to start
_MIRROR_LIMIT = 16384
PROBE_REQUEST = b"TSPROBE1"

_server = None
_listen_ip = None
_session_active = False
_session_close = None  # callable that ends the current session, or None
_mirror = None
_dupterm_active = False


def has_wifi():
    try:
        import network

        return hasattr(network, "WLAN")
    except ImportError:
        return _TEST_IP is not None


_wifi_error = None  # what the last _sta_ip() raised, if anything (the watcher backs off on it)


def _sta_ip():
    global _wifi_error
    _wifi_error = None
    if _TEST_IP is not None:
        return _TEST_IP
    try:
        import network

        sta = network.WLAN(network.STA_IF)
        if sta.active() and sta.isconnected():
            ip = sta.ifconfig()[0]
            return ip if ip and ip != "0.0.0.0" else None
    except ImportError:
        pass
    except Exception as e:  # noqa: BLE001 -- e.g. the WiFi driver failing to start for lack of memory
        _wifi_error = e
    return None


def _wifi_wanted():
    """Whether to look at the station at all. On an ESP32, merely creating network.WLAN(STA_IF) starts the
    WiFi driver, which takes tens of KB of ESP-IDF memory. A flow that never uses the network must not pay
    that, and on a board short of memory (a display flow's framebuffer) the start fails and ESP-IDF logs
    errors on every attempt (CYD, 2026-10-08). So: only with a password set (the WiFi transport) or a flow
    that imports `network` (every network node's generated code does)."""
    if board_settings.password_set():
        return True
    flow = sys.modules.get("_flow")
    return flow is not None and getattr(flow, "network", None) is not None


def listening_address():
    """The station IP while the TCP server is open, else None (HELLO's networkAddress)."""
    return _listen_ip if _server is not None else None


def apply_hostname():
    """Sets the network hostname from board settings. Must run before the station connects to take
    effect, so listener.py calls it at boot before the saved flow starts; after a change over USB it
    applies from the next WiFi connect. Ports without network.hostname() just keep their default."""
    name = board_settings.hostname()
    try:
        import network

        network.hostname(name)
    except Exception as e:  # noqa: BLE001 -- ImportError off-device, AttributeError on old firmware
        if _TEST_IP is None and has_wifi():
            print("NET_WARN could not set hostname %r: %r" % (name, e))


class _Mirror(_IOBase):
    """Write-only stream for os.dupterm: buffers output for the session's pump task."""

    def __init__(self):
        self.buf = bytearray()
        self.dropped = 0

    def write(self, data):
        try:
            n = len(data)
            if len(self.buf) + n > _MIRROR_LIMIT:
                self.dropped += n
            else:
                self.buf.extend(data)
            return n
        except Exception:  # noqa: BLE001 -- see this file's header: must never raise
            return 0

    def readinto(self, buf):
        return None  # no input via dupterm -- the session's own reader feeds the listener

    def ioctl(self, op, arg):
        return 0


def mirror_line(text):
    """Called by listener.py for every F64 line it writes. Only needed where there's no dupterm."""
    if _mirror is not None and not _dupterm_active:
        _mirror.write(text.encode() if isinstance(text, str) else text)


def _attach_mirror():
    global _mirror, _dupterm_active
    _mirror = _Mirror()
    _dupterm_active = False
    try:
        os.dupterm(_mirror, 0)
        _dupterm_active = True
    except (AttributeError, TypeError, ValueError, OSError):
        try:
            os.dupterm(_mirror)
            _dupterm_active = True
        except Exception:  # noqa: BLE001 -- no dupterm on this port: F64-only mirroring
            _dupterm_active = False


def _detach_mirror():
    global _mirror, _dupterm_active
    if _dupterm_active:
        try:
            os.dupterm(None, 0)
        except Exception:  # noqa: BLE001
            try:
                os.dupterm(None)
            except Exception:  # noqa: BLE001
                pass
    _dupterm_active = False
    _mirror = None


async def _pump(writer, stop):
    """Moves buffered output to the socket until `stop` is set or the socket fails."""
    reported = 0
    while not stop[0]:
        m = _mirror
        if m is not None and m.buf:
            data = bytes(m.buf)
            m.buf[:] = b""
            writer.write(data)
            await writer.drain()
            if m.dropped != reported:
                note = "NET_WARN dropped %d bytes of output -- the network client fell behind\n" % (m.dropped - reported)
                reported = m.dropped
                writer.write(note.encode())
                await writer.drain()
        else:
            await asyncio.sleep_ms(20)


async def _close_writer(writer):
    try:
        writer.close()
        await writer.wait_closed()
    except Exception:  # noqa: BLE001 -- closing an already-dead socket
        pass


def _peer_name(writer):
    """The client's IP for log lines. Real ports give (ip, port); the unix port gives raw sockaddr
    bytes, which aren't worth decoding for a log line."""
    try:
        info = writer.get_extra_info("peername")
        if isinstance(info, (tuple, list)) and isinstance(info[0], str):
            return info[0]
    except Exception:  # noqa: BLE001
        pass
    return "network client"


def _make_session_handler(hooks):
    async def handler(reader, writer):
        global _session_active, _session_close
        peer = _peer_name(writer)
        authed = False
        try:
            if _session_active:
                writer.write(b"TSAUTH BUSY\n")
                await writer.drain()
                print("NET_REFUSED %s -- a network session is already open" % (peer,))
                return
            nonce, line = board_settings.new_challenge()
            if nonce is None:
                writer.write(b"TSAUTH NOPASSWORD\n")
                await writer.drain()
                return
            writer.write((line + "\n").encode())
            await writer.drain()
            try:
                resp = await asyncio.wait_for(reader.readline(), _AUTH_TIMEOUT_S)
            except asyncio.TimeoutError:
                print("NET_AUTH_FAIL %s -- no answer to the challenge in %ds" % (peer, _AUTH_TIMEOUT_S))
                return
            text = resp.decode() if isinstance(resp, bytes) else resp
            if not board_settings.verify(nonce, text):
                await asyncio.sleep_ms(_AUTH_FAIL_DELAY_MS)
                writer.write(b"TSAUTH FAIL\n")
                await writer.drain()
                print("NET_AUTH_FAIL %s -- wrong password" % (peer,))
                return
            if _session_active:  # another client finished its handshake first
                writer.write(b"TSAUTH BUSY\n")
                await writer.drain()
                return
            writer.write(b"TSAUTH OK\n")
            await writer.drain()
            authed = True
        except Exception as e:  # noqa: BLE001 -- a broken handshake is the client's problem, never the listener's
            print("NET_ERR handshake with %s: %r" % (peer, e))
        finally:
            if not authed:
                await _close_writer(writer)
        if not authed:
            return

        _session_active = True
        stop = [False]
        _attach_mirror()

        try:
            me = asyncio.current_task()
        except AttributeError:
            me = None

        def _end():
            # Called from another task (the password was cleared over USB, or WiFi went down):
            # cancelling this handler runs its finally block at once, rather than waiting for the
            # session's next read timeout to notice a closed socket.
            stop[0] = True
            if me is not None:
                me.cancel()
            else:
                try:
                    writer.close()
                except Exception:  # noqa: BLE001
                    pass

        _session_close = _end
        print("NET_SESSION_OPEN %s" % (peer,))
        pump = asyncio.create_task(_pump(writer, stop))
        try:
            await hooks["on_session_start"]()
            await hooks["serve"](reader, _IDLE_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001
            print("NET_ERR session with %s: %r" % (peer, e))
        finally:
            stop[0] = True
            _detach_mirror()
            try:
                pump.cancel()
            except Exception:  # noqa: BLE001
                pass
            await _close_writer(writer)
            _session_active = False
            _session_close = None
            print("NET_SESSION_CLOSED %s" % (peer,))

    return handler


def _probe_reply(hooks):
    return json.dumps(
        {
            "ts": 1,
            "hostname": board_settings.hostname(),
            "chip": hooks["chip_type"](),
            "flow": hooks["flow_name"](),
            "port": PORT,
            "wifiTransport": board_settings.password_set(),
            "busy": _session_active,
        }
    ).encode()


def _open_probe_socket():
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except (AttributeError, OSError):
        pass
    # getaddrinfo, not a bare tuple: the unix port only accepts a resolved address, every port accepts this.
    s.bind(socket.getaddrinfo("0.0.0.0", PROBE_PORT)[0][-1])
    s.setblocking(False)
    return s


def _poll_probe(sock, hooks):
    for _ in range(4):  # answer a few per tick at most
        try:
            data, addr = sock.recvfrom(64)
        except OSError:
            return  # EAGAIN: nothing waiting
        if data.strip() == PROBE_REQUEST:
            try:
                sock.sendto(_probe_reply(hooks), addr)
            except OSError as e:
                print("NET_WARN probe reply to %r failed: %r" % (addr, e))


async def _stop_server():
    global _server, _listen_ip
    if _session_close is not None:
        _session_close()
    if _server is not None:
        try:
            _server.close()
            await _server.wait_closed()
        except Exception:  # noqa: BLE001
            pass
    _server = None
    _listen_ip = None


async def watch(hooks):
    """Long-running task (listener.py main()). hooks: on_session_start, serve, chip_type, flow_name."""
    global _server, _listen_ip
    handler = _make_session_handler(hooks)
    probe_sock = None
    tick = 0
    ip = None
    backoff_until = 0  # tick before which the station isn't looked at again, after a WiFi start failure
    while True:
        try:
            if tick % _WATCH_NETWORK_EVERY == 0:
                if tick < backoff_until or not (_TEST_IP is not None or _wifi_wanted()):
                    ip = None
                else:
                    ip = _sta_ip()
                    if _wifi_error is not None:
                        print("NET_WARN WiFi didn't start (%r) -- probably short of memory; trying again in %d s" % (_wifi_error, _WIFI_RETRY_S))
                        backoff_until = tick + _WIFI_RETRY_S * 1000 // _WATCH_TICK_MS
                want = ip is not None and board_settings.password_set()
                if want and (_server is None or ip != _listen_ip):
                    if _server is not None:
                        await _stop_server()
                    try:
                        _server = await asyncio.start_server(handler, "0.0.0.0", PORT)
                        _listen_ip = ip
                        print("NET_LISTENING %s:%d (%s.local)" % (ip, PORT, board_settings.hostname()))
                    except Exception as e:  # noqa: BLE001
                        print("NET_ERR could not listen on port %d: %r -- will retry" % (PORT, e))
                        _server = None
                elif not want and _server is not None:
                    await _stop_server()
                    print("NET_STOPPED -- %s" % ("no password set" if ip is not None else "WiFi is down"))
                if ip is not None and probe_sock is None:
                    try:
                        probe_sock = _open_probe_socket()
                    except Exception as e:  # noqa: BLE001
                        print("NET_WARN no probe responder on port %d: %r" % (PROBE_PORT, e))
                        probe_sock = False  # don't retry every tick; retried when WiFi comes back
                elif ip is None and probe_sock is not None:
                    if probe_sock:
                        try:
                            probe_sock.close()
                        except Exception:  # noqa: BLE001
                            pass
                    probe_sock = None
            if probe_sock:
                _poll_probe(probe_sock, hooks)
        except Exception as e:  # noqa: BLE001 -- this task must outlive anything it does
            print("NET_ERR watch %r -- recovering" % (e,))
        tick += 1
        await asyncio.sleep_ms(_WATCH_TICK_MS)


def settings_changed():
    """Called after SET_BOARD_SETTINGS. Clearing the password ends any open session at once; the
    watch task closes the server on its next check."""
    apply_hostname()
    if not board_settings.password_set() and _session_close is not None:
        _session_close()
