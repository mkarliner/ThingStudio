# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_remote/ts_remote/__init__.py
#   -- on the board as /lib/ts_remote/__init__.py (`import ts_remote`), a flow dependency of the spike flow.
#
# The remote display's board side (remote-display spike, 2026-11-06; docs/working-notes/remote-display-scoping.md
# and remote-display-spike-briefing.md). One Remote mounts its routes under /ts/remote/ on the shared
# ts_http_server (the server is a general facility; `/` stays with the flow), serves the pre-gzipped page, and
# runs the live session that shuttles a thingstudio_gui.RemoteSurface between the board's GUI model and the
# phone. Everything it actually says on the wire is the interface spec draft (interfaces/remote-display/SPEC.md)
# -- this file implements that contract, it does not define it.
#
# Board-side shape:
#   Remote(gui, server, definition, display="phone") -- validates `definition` (the flow's screens tree for the
#     phone; BadDefinition names the first problem) and builds the RemoteSurface, plus the input widget set;
#   remote.stage()          -- synchronous, at flow module scope: registers every widget with the GUI.
#   await remote.start()    -- mounts the routes on the server and starts them:
#     GET  /ts/remote/          the page (stored gzipped, served as its own bytes, never decompressed board-side)
#     GET  /ts/remote/login     a TSAUTH1 challenge over plain HTTP, the wire protocol's own line
#     POST /ts/remote/login     the page's answer, body "TSAUTH1 <hex>"; success returns {v, display, token}
#     GET  /ts/remote/ws        the WebSocket, the login token offered as the handshake's subprotocol
#                               (Sec-WebSocket-Protocol: ts-rd-v1-<token>; a browser's WebSocket API
#                               cannot set custom headers) -- wrong, missing or malformed refuses the
#                               upgrade with 401; one viewer, a second takes over, told why (a
#                               takeover notice, then close code 4000)
#     (the flow mounts anything else it wants on the same port via ts_http_server.Server.mount -- the other
#     route the spike brief asks to show alongside.)
#
# Auth: the board's TSAUTH1 transport key (`board_settings.py`) re-used over plain HTTP; the page derives the
# same key from the password with hand-written SHA-256/HMAC (no `crypto.subtle` in an insecure context). The
# password and its derived key never cross the wire. Each side derives a session key from the nonce:
#   session_key = HMAC(key, nonce + " remote display input v1")
#   token       = HMAC(session_key, "open session v1")
# Input frames are "<json>\n<hexhmac(session_key, json)>" with a strictly increasing counter, so a replayed
# or altered frame is refused (working item 10 -- input drives hardware).
#
# Login rate limit (SPEC 8.1, production tier): the login routes answer 429 past _LOGIN_MAX requests per
# _LOGIN_WINDOW_MS (one login is two -- the challenge GET and the answer POST) and 503 while requests the
# board cannot work on yet are still queued; the single _login_loop task is the concurrent-handler cap.
#
# Link (working item 11): the board pings the page every PING_MS and the page pongs; after about
# _MISSED_PONG_MS without anything arriving, the link counts as lost (a phone leaving WiFi is often never seen
# as a close). set_link_policy() decides what losing means:
#   "stale" (default) -- the page shows stale values and its own banner; the board sends nothing further;
#   "safe"            -- the flow, once per drop and once per return (`link_change()`), and a deadman arms
#                        while continuous input ("ctl") arrives: no fresh input for deadman_ms fires a second
#                        drop without any network state changing -- the drag stopped or the phone vanished,
#                        the output goes safe (the robot-leaves-WiFi checkpoint).
# The page reconnects on its own; the newest successful login's token opens the next socket, so a dead viewer
# never locks its owner out.
#
# Ordering without locks: thingstudio_gui renders (in its own task) puts JSON strings into the newest
# session's outgoing queue; that session's writer task drains exactly that queue; the page buffers
# screen/values messages until its definition pieces are assembled, so tasks may run in any order.
# An outgoing queue is bounded: a stalled viewer drops the oldest messages rather than growing the heap.
#
# Fault handling: a bad frame, a bad message or a dead socket must never reach or stop the flow -- the
# session ends, one terse console line names what, the next viewer connects normally. One of these pages
# (the session owner) that fails on upload/logins is never allowed to take the flow's tasks down with it.

import json
import binascii
import time
import runtime
import device_settings
import board_settings
import ts_http_server
import thingstudio_gui

PREFIX = "/ts/remote/"
WS_PROTOCOL = "ts-rd-v1"    # the login token rides the WebSocket handshake subprotocol: "ts-rd-v1-<token>"
PROTOCOL_V = 1
_DEF_PART_CHARS = 240    # one definition piece (a BLE-sized MTU is the eventual floor; SPEC principle P2)
_PING_MS = 1000
_MISSED_PONG_MS = 3200   # about three missed pings before the link counts as lost
_LOGIN_BODY_MAX = 280
_LOGIN_TIMEOUT_S = 15
_LOGIN_MAX = 10             # login-route requests per window, GET and POST both (SPEC 8.1)
_LOGIN_WINDOW_MS = 60000
_LOGIN_Q_MAX = 2            # requests held pending; a further one is answered 503, never queued
_OUT_BUFFER_MAX = 96     # messages to a stalled viewer; the oldest is dropped, the heap never grows

RemoteSurface = thingstudio_gui.RemoteSurface
STATE_NAMES = thingstudio_gui.STATE_NAMES

REMOTE_WIDGET_KINDS = ("label", "readout", "bar", "trend", "led", "button", "pagedots",
                       "number", "text", "submit", "ctl")


def ticks():
    try:
        return time.ticks_ms()
    except AttributeError:
        return int(time.monotonic() * 1000)  # CPython (host tooling only)


def ms_since(reference):
    try:
        return time.ticks_diff(ticks(), reference)
    except (AttributeError, TypeError):
        return ticks() - reference


def _constant_eq(a, b):
    """Constant-time-ish equal for bytes or str (the token hex). Never stops at the first difference."""
    if len(a) != len(b):
        return False
    diff = 0
    if isinstance(a, bytes):
        for i in range(len(a)):
            diff |= a[i] ^ b[i]
    else:
        for i in range(len(a)):
            if a[i] != b[i]:
                diff = 1
    return diff == 0


def _noop_draw(surface, rect, value, state):
    pass  # a remote surface never draws; each widget still owns its value and state


class BadDefinition(ValueError):
    pass


class _BQueue:
    """A tiny bounded queue: put on a full one drops the oldest (a stalled viewer must never grow the heap)."""

    def __init__(self, cap=_OUT_BUFFER_MAX):
        self._items = []
        self._cap = cap
        self._evt = None

    def put(self, item):
        if len(self._items) >= self._cap:
            self._items.pop(0)
        self._items.append(item)
        if self._evt is not None:
            self._evt.set()

    async def get(self):
        import asyncio
        while not self._items:
            if self._evt is None:
                self._evt = asyncio.Event()
            await self._evt.wait()
            self._evt.clear()
        return self._items.pop(0)


class _LoginQueue:
    """The login routes' queue: one consumer (Remote._login_loop) and a tight pending cap. A put that
    would overflow is answered 503 on the spot -- an overloaded board says so immediately; _BQueue's
    drop-oldest would instead strand exactly the dropped request in its 15 s timeout (SPEC 8.1)."""

    def __init__(self, cap=_LOGIN_Q_MAX):
        self._items = []
        self._cap = cap
        self._evt = None

    def put(self, item):
        if len(self._items) >= self._cap:
            conn = item["_http_conn"]
            conn["status"], conn["body"] = 503, b"login busy -- try again"
            conn["done"].set()
            return
        self._items.append(item)
        if self._evt is not None:
            self._evt.set()

    async def get(self):
        import asyncio
        while not self._items:
            if self._evt is None:
                self._evt = asyncio.Event()
            await self._evt.wait()
            self._evt.clear()
        return self._items.pop(0)


class Remote:
    """One remote display on the shared server. `definition` is the flow's screens tree for the phone."""

    def __init__(self, gui, server, definition, display="phone"):
        if not isinstance(definition, dict):
            raise BadDefinition("definition must be an object, got %r" % (type(definition).__name__,))
        des_v = definition.get("v")
        if des_v != PROTOCOL_V:
            raise BadDefinition("definition v must be %d, got %r" % (PROTOCOL_V, des_v))
        self._gui = gui
        self._server = server
        self.display = display
        self._des = definition
        self._widgets = {}        # wid -> {"kind", "config"}
        self._policy = ("stale", None)
        self._logged = None       # {"key", "nonce", "token"} of the newest successful login
        self._challenge = None    # the nonce a GET handed out, being waited for by a POST
        self._conn = None         # the live session dict, or None
        self._out = None          # that session's outgoing queue; send() targets it
        self._down_at = None      # ticks() of the last link-lost declaration (safe policy), or None
        self._attempts = []       # ticks() of recent login-route requests (the rate window)
        self._login_q = _LoginQueue()
        self.controls = _BQueue(8)   # continuous input to the flow: {'payload', 'topic', 'wid'}
        self.link = _BQueue(8)       # "up"/"down" transitions to the flow (safe policy)
        self.surface = None

    def stage(self):
        """Module-scope setup: build the surface and register the widgets. Raises BadDefinition."""
        self._read_definition()
        self._build_surface()

    def _read_definition(self):
        pages = self._des.get("pages")
        if not isinstance(pages, list) or len(pages) == 0 or not all(
                isinstance(p, dict) and isinstance(p.get("name"), str) and p["name"] for p in pages):
            raise BadDefinition("definition needs pages with non-empty name strings")
        for spec in pages:
            tree = spec.get("tree")
            if tree is not None:
                self._collect(tree)
        for spec in self._des.get("modals") or []:
            tree = spec.get("tree")
            if tree is not None:
                self._collect(tree)

    def _collect(self, node):
        if not isinstance(node, dict):
            raise BadDefinition("a layout node is an object, got %r" % (node,))
        wid = node.get("wid")
        if wid is not None:
            kind = node.get("kind")
            if not isinstance(wid, str) or not wid:
                raise BadDefinition("wid is a non-empty string, got %r" % (wid,))
            if not isinstance(kind, str):
                raise BadDefinition("widget %r has no kind" % (wid,))
            cfg = node.get("config") or {}
            if not isinstance(cfg, dict):
                raise BadDefinition("widget %r config must be an object" % (wid,))
            if wid in self._widgets:
                raise BadDefinition("widget %r appears twice in the definition" % (wid,))
            self._widgets[wid] = {"kind": kind, "config": cfg}
            return
        kind = node.get("kind")
        if kind not in ("row", "column"):
            raise BadDefinition("a container is a row or column, got %r" % (kind,))
        for prop, allowed in (("align", ("start", "center", "end", "stretch")),
                              ("alignSelf", ("start", "center", "end", "stretch")),
                              ("justify", ("start", "center", "end", "space-between"))):
            if prop in node and node[prop] not in allowed:
                raise BadDefinition("%s must be one of %s, got %r" % (prop, ", ".join(allowed), node[prop]))
        gap, padding = node.get("gap", 0), node.get("padding", 0)
        if not (isinstance(gap, int) and gap >= 0) or not (isinstance(padding, int) and padding >= 0):
            raise BadDefinition("gap/padding are non-negative integers, got %r/%r" % (gap, padding))
        for child in node.get("children") or []:
            self._collect(child)

    def _build_surface(self):
        pages = self._des.get("pages")
        table = {spec["name"]: {"parent": spec.get("parent"),
                                "widgets": [(wid, (0, 0, 0, 0)) for wid in sorted(self._widgets)]}
                 for spec in pages}
        modals = {m["name"]: {"widgets": [(wid, (0, 0, 0, 0)) for wid in sorted(self._widgets)],
                              "priority": m.get("priority", 0), "timeout_ms": m.get("timeoutMs", 0)}
                  for m in (self._des.get("modals") or [])}
        for wid in self._widgets:
            if wid in self._gui.widgets:
                raise BadDefinition("widget %r is registered twice (definition or flow)" % (wid,))
            kind = self._widgets[wid]["kind"]
            self._gui.widget(wid, _noop_draw, 0, touchable=kind in ("button", "submit"))
        self.surface = RemoteSurface(self.display, self.send, table,
                                     self._des.get("carousel") or [pages[0]["name"]], modals,
                                     min_interval_ms=self._des.get("minIntervalMs", 100))
        self._gui.add_surface(self.surface)
        self._gui.follow_page(self.display)
        for wid, sp in self._widgets.items():
            kind, cfg = sp["kind"], sp["config"]
            if kind == "button":
                mode = cfg.get("mode", "momentary")
                if mode not in thingstudio_gui.MODES:
                    raise BadDefinition("button %r mode must be one of %s, got %r"
                                        % (wid, ", ".join(thingstudio_gui.MODES), mode))
                self._gui.button(wid, mode, controlled=cfg.get("controlled", False),
                                 on_val=cfg.get("on", True), off_val=cfg.get("off", False),
                                 on_press=False, target=cfg.get("target"),
                                 pending_ms=cfg.get("pendingMs", thingstudio_gui.PENDING_MS),
                                 initial=cfg.get("initial", False))
            elif kind == "submit":
                # The page's form submit is the one act; the board fires this widget's event queue when the
                # writes land (_submit_form), so the flow's own `await gui.event()` is the "saved" signal.
                self._gui.button(wid, "momentary")
            elif kind in ("number", "text"):
                key = cfg.get("key")
                if not isinstance(key, str) or not key:
                    raise BadDefinition("field %r needs a settings key" % (wid,))
                try:
                    initial = runtime.settings.get(key, cfg.get("default"))
                except Exception as e:  # noqa: BLE001
                    raise BadDefinition("field %r: settings: %r" % (wid, e))
                self._gui.set_value(wid, initial)

    def set_link_policy(self, mode, deadman_ms=None):
        if mode not in ("stale", "safe"):
            raise ValueError("link policy must be stale or safe, not %r" % (mode,))
        if deadman_ms is not None and (not isinstance(deadman_ms, (int, float)) or deadman_ms <= 0):
            raise ValueError("deadman_ms must be positive, got %r" % (deadman_ms,))
        self._policy = (mode, deadman_ms)

    async def start(self):
        from ts_remote import page_data  # the generated page module; built by tools/build_remote_page.py
        headers = [("Content-Encoding", "gzip"),
                   ("Cache-Control", "max-age=31536000, immutable"),
                   ("ETag", '\\"%s\\"' % (page_data.PAGE_VERSION,))]
        self._server.mount({"id": "remote_page", "method": "GET", "path": PREFIX},
                           static=(200, "text/html", page_data.PAGE_GZ, headers))
        self._server.mount({"id": "remote_ws", "method": "GET", "path": PREFIX + "ws"},
                           ws=self._session, pre=self._token_ok)
        # timeoutS/body_limit ride in the route dict, not as mount() keywords: mount's whole signature is
        # (route, queue=, static=, ws=, pre=), the same keys a construction-time route carries (Server.mount).
        self._server.mount({"id": "remote_login_get", "method": "GET", "path": PREFIX + "login",
                            "timeoutS": _LOGIN_TIMEOUT_S}, queue=self._login_q)
        self._server.mount({"id": "remote_login_post", "method": "POST", "path": PREFIX + "login",
                            "timeoutS": _LOGIN_TIMEOUT_S, "body_limit": _LOGIN_BODY_MAX},
                           queue=self._login_q)
        await self._server.ensure()
        runtime.spawn(self._login_loop(), "remote_display")
        self._print_url()

    def _print_url(self):
        ip = None
        try:
            import network
            ip = network.WLAN(network.STA_IF).ifconfig()[0]
            if ip.startswith("0."):
                ip = network.WLAN(network.AP_IF).ifconfig()[0]
        except Exception:  # noqa: BLE001 -- no network module here (tests, or no WiFi yet)
            pass
        if not ip:
            ip = "<board>"
        print("REMOTE_DISPLAY http://%s%s" % (ip, PREFIX))

    # -- login: TSAUTH1 re-used over plain HTTP --------------------------------

    async def _login_loop(self):
        while True:
            item = await self._login_q.get()
            conn = item["_http_conn"]
            try:
                self._answer_login(item)
            except Exception as e:  # noqa: BLE001 -- a login fault is answered, never reaches the flow
                print("REMOTE_LOGIN_ERR %r" % (e,))
                conn["status"], conn["body"] = 500, b"login failed"
            conn["done"].set()

    def _answer_login(self, item):
        req, conn = item["req"], item["_http_conn"]
        # the rate limit is before the TSAUTH1 work (SPEC 8.1): past the cap the route answers 429 whatever
        # the request is -- no challenge is minted, no answer verified
        now = ticks()
        self._attempts = [t for t in self._attempts if ms_since(t) < _LOGIN_WINDOW_MS]
        if len(self._attempts) >= _LOGIN_MAX:
            conn["status"], conn["body"] = 429, b"too many attempts -- wait a minute"
            return
        self._attempts.append(now)
        if not board_settings.password_set():
            conn["status"], conn["body"] = 503, b"no board password is set -- set one in the editor first"
            return
        if req["method"] == "GET":
            nonce, line = board_settings.new_challenge()
            self._challenge = nonce
            conn["status"], conn["body"] = 200, line
            return
        want = self._challenge
        self._challenge = None
        if want is None:
            conn["status"], conn["body"] = 400, b"ask for a challenge first (GET the same URL)"
            return
        parts = req["body"].split(b"\n", 1)[0].split(b" ", 1)
        # verify() speaks the wire protocol: a STR line "TSAUTH1 <hex>"
        line = (parts[0] + b" " + parts[1]).decode() if len(parts) >= 2 else ""
        if len(parts) != 2 or parts[0] != b"TSAUTH1" or not board_settings.verify(want, line):
            conn["status"], conn["body"] = 401, b"refused"
            return
        stored_key = binascii.unhexlify(board_settings.load()["key"])
        session_key = board_settings.hmac_sha256(stored_key, want + b" remote display input v1")
        self._logged = {"key": session_key, "nonce": want,
                        "token": binascii.hexlify(board_settings.hmac_sha256(
                            session_key, b"open session v1")).decode()}
        conn["status"], conn["body"] = 200, json.dumps(
            {"v": PROTOCOL_V, "display": self.display, "token": self._logged["token"]}).encode()

    def _token_ok(self, query, headers):
        """The ws route's pre-check: the newest login's token, offered as the WebSocket handshake
        subprotocol `Sec-WebSocket-Protocol: ts-rd-v1-<token>` -- a browser's WebSocket API cannot set
        custom headers, and a query string would travel through logs and proxies. A client may offer
        several subprotocols comma-separated; ours is accepted wherever it appears. Wrong, missing
        or malformed token refuses the upgrade with 401 before any WebSocket state exists.
        One socket per login."""
        if self._logged is None:
            return False
        want = WS_PROTOCOL + "-"
        for offer in headers.get("sec-websocket-protocol", "").split(","):
            offer = offer.strip()
            if offer.startswith(want) and _constant_eq(offer[len(want):], self._logged["token"]):
                return True
        return False

    # -- the outgoing bridge: every message to the viewer takes one text frame ----------------------------

    def send(self, msg):
        """thingstudio_gui's RemoteSurface send (dict) -> one JSON string into the newest session's queue."""
        target = self._out
        if target is None:
            return
        try:
            target.put(json.dumps(msg))
        except (TypeError, ValueError) as e:
            print("REMOTE_MSG_ERR %r" % (e,))

    # -- a session: definition, screen/value flow, input frames, heartbeat, take-over ---------------------

    async def _session(self, ws, query):
        import asyncio
        if self._logged is None:
            await ws.send_close(1008)
            return
        session = {"ws": ws, "out": _BQueue(), "count": 0, "link": "up", "armed": False,
                   "last_seen": ticks(), "last_ctl": None, "tasks": None}
        old, self._conn, self._out = self._conn, session, session["out"]
        if old is not None:
            runtime.spawn(self._evict(old), "remote_display")
        try:
            body = json.dumps(self._des)
        except (TypeError, ValueError) as e:
            print("REMOTE_DEF_ERR %r" % (e,))
            await ws.send_close(1011)
            self._end(session)
            return
        parts = [body[i:i + _DEF_PART_CHARS] for i in range(0, len(body), _DEF_PART_CHARS)]
        for i, part in enumerate(parts):
            try:
                await ws.send_text(json.dumps({"type": "screen_def", "i": i, "n": len(parts),
                                               "display": self.display, "part": part}))
            except OSError:
                self._end(session)
                return
        if self._conn is not session:
            return  # replaced while the definition was going out
        reader = runtime.spawn(self._frames(session), "remote_display")
        pinger = runtime.spawn(self._pings(session), "remote_display")
        writer = runtime.spawn(self._writer(session), "remote_display")
        session["tasks"] = (reader, pinger, writer)
        try:
            await reader
        except asyncio.CancelledError:
            pass  # evicted: the replacing session cancelled us
        except Exception as e:  # noqa: BLE001 -- a dead connection, never a flow fault
            print("REMOTE_SESSION_ERR %r" % (e,))
        for t in (pinger, writer):
            try:
                t.cancel()
            except Exception:
                pass
        self._end(session)

    def _end(self, session):
        if self._conn is session:
            self._conn = None
            self._out = None

    async def _evict(self, old):
        """A second viewer has connected: the first is told why, then closed (close code 4000 = take-over)."""
        import asyncio
        try:
            old["out"].put(json.dumps({"type": "takeover", "reason": "another viewer has logged in"}))
        except (TypeError, ValueError):
            pass
        await asyncio.sleep_ms(300)  # let the old writer drain one last queue
        for t in old.get("tasks") or ():
            try:
                t.cancel()
            except Exception:
                pass
        try:
            await old["ws"].send_close(4000)
        except Exception:
            pass
        try:
            old["ws"].writer.close()
        except Exception:
            pass

    async def _pings(self, session):
        import asyncio
        while True:
            if self._conn is not session:
                return
            self._evaluate(session, "sweep")
            try:
                await session["ws"].ping(b"hb")
            except OSError:
                self._end(session)
                return
            await asyncio.sleep_ms(_PING_MS)

    def _evaluate(self, session, event):
        """One link decision per session and event ('sweep' by the pinger, 'input'/'frame' on anything
        arriving). Down = pongs stale OR deadman out of input after arming; up = input or pongs arriving
        again while down. One 'down'/one 'up' event per transition (safe policy), one console line each."""
        mode, deadman = self._policy
        no_pong = ms_since(session["last_seen"]) >= _MISSED_PONG_MS
        no_ctl = (deadman is not None and session["armed"] and session["last_ctl"] is not None and
                  ms_since(session["last_ctl"]) >= deadman)
        down = no_pong or no_ctl
        if session["link"] == "up" and down:
            session["link"] = "down"
            session["armed"] = False
            if self._down_at is None:
                self._down_at = ticks()
            print("REMOTE_LINK down (%s)" % ("no pong for %d ms" % ms_since(session["last_seen"])
                                             if no_pong else "no input for %d ms" % ms_since(session["last_ctl"])))
            if mode == "safe":
                self.link.put("down")
        elif session["link"] == "down" and not down and event in ("input", "sweep"):
            session["link"] = "up"
            self._down_at = None
            print("REMOTE_LINK up (%s)" % ("input" if event == "input" else "pong",))
            if mode == "safe":
                self.link.put("up")

    async def link_change(self):
        return await self.link.get()

    async def control(self):
        return await self.controls.get()

    async def _frames(self, session):
        while True:
            kind, payload = await session["ws"].recv()
            if self._conn is not session:
                return
            if kind == "close":
                return
            session["last_seen"] = ticks()
            if kind == "pong":
                continue
            if kind == "ping":  # the page's own ping frame: answered inside recv(); refreshes liveness
                continue
            self._evaluate(session, "input")
            if kind != "text":
                await session["ws"].send_close(1003)
                return
            try:
                msg = self._check(session, payload)
            except (ValueError, OSError, KeyError) as e:
                print("REMOTE_INPUT_ERR %r" % (e,))
                await session["ws"].send_close(1008)
                return
            reply, err = self._dispatch(session, msg)
            if err is not None:
                reply = {"type": "err", "what": err}
            if reply is not None:
                try:
                    await session["ws"].send_text(json.dumps(reply))
                except OSError:
                    self._end(session)
                    return

    async def _writer(self, session):
        while True:
            body = await session["out"].get()
            try:
                await session["ws"].send_text(body)
            except OSError:
                self._end(session)
                return

    def _check(self, session, payload):
        """`<json>\\n<hexhmac(session_key, json)>`: constant-time signature, then a strictly increasing
        counter. Returns the message; any other shape raises (caller closes with 1008)."""
        line, _, sig = payload.partition(b"\n")
        if not sig:
            raise ValueError("unsigned input frame")
        if self._logged is None:
            raise ValueError("no login session")
        want = board_settings.hmac_sha256(self._logged["key"], line)
        try:
            got = binascii.unhexlify(sig)
        except (ValueError, TypeError):
            raise ValueError("signature is not hex")
        if not _constant_eq(got, want):
            raise ValueError("wrong signature")
        data = json.loads(line)
        if data.get("c") != session["count"] + 1:
            raise ValueError("counter %r, expected %d" % (data.get("c"), session["count"] + 1))
        session["count"] = data["c"]
        return data.get("m")

    # -- one page message -> one board action; (reply, err) like any other dispatch ------------------------

    def _dispatch(self, session, msg):
        if not isinstance(msg, dict):
            return None, "message is not an object"
        kind = msg.get("type")
        if kind == "hi":
            if msg.get("v") != PROTOCOL_V:
                return None, "unsupported version %r" % (msg.get("v"),)
            return None, None
        if kind == "tap":
            wid, phase = msg.get("wid"), msg.get("phase")
            if phase not in ("down", "up"):
                return None, "tap.phase must be down/up, got %r" % (phase,)
            try:
                self._gui.button_press(self.display, wid, phase)
            except (ValueError, KeyError) as e:
                return None, "tap: %r" % (e,)
            return None, None
        if kind == "nav":
            cmd = msg.get("cmd")
            if not isinstance(cmd, str):
                return None, "nav needs a string command"
            try:
                self._gui.navigate(self.display, cmd)
            except (ValueError, KeyError) as e:
                return None, "nav: %r" % (e,)
            return None, None
        if kind == "page":
            n = msg.get("n")
            carousel = self._des.get("carousel") or []
            if not isinstance(n, int) or not 0 <= n < len(carousel):
                return None, "page index %r" % (n,)
            self._gui.navigate(self.display, carousel[n])
            return None, None
        if kind == "form":
            return self._submit_form(msg)
        if kind == "ctl":
            wid, value = msg.get("wid"), msg.get("value")
            sp = self._widgets.get(wid)
            if sp is None or sp["kind"] != "ctl":
                return None, "ctl on unknown or non-ctl widget %r" % (wid,)
            if isinstance(value, str) or isinstance(value, int):
                try:
                    value = float(value)
                except (ValueError, TypeError):
                    return None, "ctl value %r is not a number" % (value,)
            cfg = sp["config"]
            lo, hi = cfg.get("lo", 0.0), cfg.get("hi", 1.0)
            if not lo <= value <= hi:
                return None, "ctl value %r outside %r..%r" % (value, lo, hi)
            session["armed"] = True
            session["last_ctl"] = ticks()
            self._evaluate(session, "input")
            self.controls.put({'payload': value, 'topic': wid, 'wid': wid})
            return None, None
        if kind == "ping":
            return {"type": "pong", "echo": msg.get("at"), "board": ticks()}, None
        return None, "message type %r unknown" % (kind,)

    def _submit_form(self, msg):
        """A settings form writes as one act: values converted first, then every key, then the widgets
        updated. A value that will not convert refuses the whole form before any write; a write fault is
        reported with the keys it applied before failing (the flash failed, not intent)."""
        form = msg.get("form")
        fields = self._forms_by(form)
        if fields is None:
            return None, "form %r is not in the definition" % (form,)
        values = msg.get("values")
        if not isinstance(values, dict):
            return None, "form values are an object"
        converted = {}
        for wid in fields:
            sp = self._widgets[wid]
            if sp["kind"] == "submit":
                continue
            key, kind = sp["config"].get("key"), sp["kind"]
            raw = values.get(key, values.get(wid))
            if raw is None:
                continue
            if kind == "number":
                try:
                    value = float(raw)
                    if value == int(value):  # shifts 2.0 -> 2; MicroPython floats have no is_integer()
                        value = int(value)
                except (ValueError, TypeError, OverflowError):
                    return None, "%r is not a number" % (key,)
                converted[key] = value
            else:
                try:
                    converted[key] = str(raw)[:128]
                except Exception:
                    return None, "%r is not text" % (key,)
        try:
            for key in converted:
                device_settings.set(key, converted[key])
        except device_settings.SettingsError as e:
            return {"type": "form_err", "form": form, "failed": {"write": str(e)}}, None
        for wid in fields:
            key = self._widgets[wid]["config"].get("key")
            if key in converted:
                self._gui.set_value(wid, converted[key])
        # The flow's "saved" signal: the submit widget's own event queue gets one message per successful
        # write. (With no edits submitted it is still one event, with no keys -- the reader distinguishes.)
        submit_wid = fields[0]
        try:
            self._gui.emit(submit_wid, {"form": form, "keys": sorted(converted.keys())})
        except Exception as e:  # noqa: BLE001 -- an unconsumed event queue drops, it never kills the form
            print("REMOTE_FORM_EVT %r" % (e,))
        return {"type": "form_ok", "form": form, "keys": sorted(converted.keys())}, None

    def _forms_by(self, form):
        for wid, sp in self._widgets.items():
            if sp["kind"] == "submit" and (sp["config"] or {}).get("form") == form:
                fields = [wid] + [k for k, v in self._widgets.items() if (v["config"] or {}).get("form") == form
                                  and v["kind"] in ("number", "text")]
                return fields
        return None
