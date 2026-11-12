# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_ts_remote.py
#
# The remote display's board side (vendor/thingstudio_remote/ts_remote.py, remote-display spike
# 2026-11-06) under the real MicroPython unix port: the login flow (no password fails 503 closed; a wrong
# password is refused 401; the right one returns the token), the derivation both sides share, the per-route ws
# gate, definition validation and surface building, signed input frames (a replay or altered frame is
# refused), tap/nav/form/ctl dispatch against a real thingstudio_gui, the chunked definition, the deadman
# link policy, and the take-over of a second viewer. Sockets are stubs -- the real TCP path's own tests are
# test_ts_http_ws.py's job.
#
# Environment: THINGSTUDIO_BOARD_SETTINGS_PATH and THINGSTUDIO_SETTINGS_PATH must point at scratch files,
# the same off-device override every other THINGSTUDIO_*_PATH test uses.

import json
import binascii
import os
import asyncio

import minitest

minitest.add_src_to_path()
import sys  # noqa: E402

import board_settings  # noqa: E402

SRC = sys.path[0]
sys.path.insert(0, SRC + "/vendor/thingstudio_http")
sys.path.insert(0, SRC + "/vendor/thingstudio_gui")
sys.path.insert(0, SRC + "/vendor/thingstudio_remote")  # the vendor folder holds the ts_remote package

import ts_http_server  # noqa: E402
import gui  # noqa: E402

sys.modules["thingstudio_gui"] = gui  # on the board the file lands as thingstudio_gui.py

import ts_remote  # noqa: E402
import device_settings  # noqa: E402

PASSWORD = "spike-pass-1"


class FakeWS:
    """Everything Remote._session and its tasks need of a WebSocket, scripted."""

    def __init__(self, inbox=None):
        self.inbox = list(inbox or [])
        self.sent = []
        self.closes = []
        self.closed = False
        self.writer = None

    async def recv(self):
        if self.inbox:
            return self.inbox.pop(0)
        while True:
            if self.closed:
                return ("close", self.closes[-1] if self.closes else 1000)
            await asyncio.sleep_ms(20)

    async def send_text(self, body):
        self.sent.append(body)

    async def send_close(self, code=1000):
        self.closes.append(code)
        self.closed = True

    async def close(self, code=1000):
        await self.send_close(code)  # the real WebSocket.close is send_close + releasing the socket

    async def ping(self, payload=b""):
        pass  # recv() would deliver the peer's answer; a stalled viewer just never pongs


def _setup(password=PASSWORD, deadman=None):
    """One scratch board-settings state, one gui, one server, one validated Remote."""
    for p in (os.getenv("THINGSTUDIO_BOARD_SETTINGS_PATH", ""), os.getenv("THINGSTUDIO_SETTINGS_PATH", "")):
        if p:
            try:
                os.remove(p)
            except OSError:
                pass
    board_settings._reset_cache_for_tests()
    device_settings._reset_cache_for_tests()
    device_settings.set_namespace("remote-spike")
    if password is not None:
        err = board_settings.apply(new_password=password)
        assert err is None, err
    device_settings.set("threshold", 21)
    g = gui.GUI()
    srv = ts_http_server.Server(18401, [], {})
    des = {
        "v": 1, "display": "main", "minIntervalMs": 100,
        "pages": [
            {"name": "home", "tree": {
                "kind": "column", "gap": 4, "children": [
                    {"wid": "temp", "kind": "readout", "config": {"decimals": 1}},
                    {"wid": "bar", "kind": "bar", "config": {"lo": 0, "hi": 100}},
                    {"wid": "led", "kind": "led", "config": {}},
                    {"wid": "boop", "kind": "button", "config": {"mode": "momentary", "text": "B"}},
                    {"wid": "pump", "kind": "button",
                     "config": {"mode": "toggle", "controlled": True, "onText": "P ON", "offText": "P OFF"}},
                    {"wid": "go", "kind": "button",
                     "config": {"mode": "navigate", "target": "set", "text": "go"}},
                ]}},
            {"name": "set", "tree": {
                "kind": "column", "gap": 4, "children": [
                    {"wid": "th", "kind": "number", "config": {"label": "threshold", "key": "threshold",
                                                              "default": 20, "form": "cfg"}},
                    {"wid": "nm", "kind": "text", "config": {"label": "name", "key": "name", "default": "", "form": "cfg"}},
                    {"wid": "save", "kind": "submit", "config": {"form": "cfg", "label": "Save"}},
                ]}},
        ],
        "modals": [],
    }
    remote = ts_remote.Remote(g, srv, des, display="main")
    remote.stage()
    if deadman is not None:
        remote.set_link_policy("safe", deadman)
    return remote, g, srv, des


async def _login(remote, answer_hex=None):
    """One TSAUTH1 round through the module's own login path: challenge GET, then the POST."""
    conn = {"status": None, "body": None}
    remote._answer_login({"req": {"method": "GET"}, "_http_conn": conn})
    assert conn["status"] == 200, conn
    ledger = (conn["body"] if isinstance(conn["body"], str) else conn["body"].decode()).split(" ")
    assert ledger[0] == "TSAUTH1" and len(ledger) == 5
    nonce_hex = ledger[2]
    nonce = binascii.unhexlify(nonce_hex)
    if answer_hex is None:
        key = binascii.unhexlify(board_settings.load()["key"])
        answer_hex = binascii.hexlify(board_settings.hmac_sha256(key, nonce)).decode()
    conn = {"status": None, "body": None}
    remote._answer_login({"req": {"method": "POST", "body": ("TSAUTH1 " + answer_hex).encode()},
                          "_http_conn": conn})
    return conn, nonce_hex, nonce


def _fresh_session(out):
    return {"out": out, "count": 0, "link": "up", "armed": False, "last_seen": ts_remote.ticks(),
            "last_ctl": None, "ws": None}


# minitest runs each test function fresh; each opens (or reuses) its own scratch settings state.

def test_login_requires_password_and_right_answer():
    async def main():
        remote, g, srv, des = _setup(password=None)
        conn = {"status": None, "body": None}
        remote._answer_login({"req": {"method": "GET"}, "_http_conn": conn})
        assert conn["status"] == 503, conn  # fail closed: no password, no login

        remote, g, srv, des = _setup(password=PASSWORD)
        # a wrong answer is refused: same shape, wrong HMAC
        conn, _n, nonce = await _login(remote, answer_hex="00" * 32)
        assert conn["status"] == 401, conn
        conn, _n, nonce = await _login(remote)
        assert conn["status"] == 200, conn
        logged = json.loads(conn["body"])
        key = binascii.unhexlify(board_settings.load()["key"])
        session_key = board_settings.hmac_sha256(key, nonce + b" remote display input v1")
        want = binascii.hexlify(board_settings.hmac_sha256(session_key, b"open session v1")).decode()
        assert logged["token"] == want, logged
        assert remote._logged["token"] == want
        assert logged["display"] == "main" and logged["v"] == 1
    import asyncio
    asyncio.run(main())


def test_login_rate_limit_answers_429():
    async def main():
        remote, g, srv, des = _setup()
        conn = {"status": None, "body": None}
        for i in range(ts_remote._LOGIN_MAX):  # one normal login is two requests: the GET and the POST
            remote._answer_login({"req": {"method": "GET"}, "_http_conn": conn})
            assert conn["status"] == 200, (i, conn)
        before = remote._challenge
        remote._answer_login({"req": {"method": "GET"}, "_http_conn": conn})
        assert conn["status"] == 429, conn  # past the cap: no challenge minted...
        assert remote._challenge == before  # ...the pending one from before is untouched, nothing new
        remote._answer_login({"req": {"method": "POST", "body": b"TSAUTH1 " + b"0" * 64}, "_http_conn": conn})
        assert conn["status"] == 429, conn  # a POST answer is refused the same way, nothing verified
        assert remote._logged is None
        # an attempt falls out of the window and the route answers again (no 60 s sleep in the test:
        # age one stored tick past the window and the prune does the rest)
        remote._attempts[0] = ts_remote.ticks() - (ts_remote._LOGIN_WINDOW_MS + 1000)
        remote._answer_login({"req": {"method": "GET"}, "_http_conn": conn})
        assert conn["status"] == 200, conn
        # a real login still fits inside the budget on a fresh remote: GET + POST = 2 of 10
        remote, g, srv, des = _setup()
        conn, _n, _nonce = await _login(remote)
        assert conn["status"] == 200, conn
    import asyncio
    asyncio.run(main())


def test_login_queue_overflow_answers_503():
    async def main():
        import asyncio
        q = ts_remote._LoginQueue()
        for _ in range(ts_remote._LOGIN_Q_MAX):  # filled, not consumed: the board is the bottleneck here
            q.put({"_http_conn": None})
        conn = {"status": None, "body": None, "done": asyncio.Event()}
        q.put({"_http_conn": conn})
        assert conn["status"] == 503, conn  # said so on the spot, not queued into its 15 s timeout
        assert conn["done"].is_set()
        assert len(q._items) == ts_remote._LOGIN_Q_MAX  # the pending work is unchanged
    import asyncio
    asyncio.run(main())


def test_token_gate():
    async def main():
        remote, g, srv, des = _setup()
        proto = "sec-websocket-protocol"
        offer = ts_remote.WS_PROTOCOL + "-"
        # no login yet: fail closed whatever the header says
        assert remote._token_ok("", {proto: offer + "f" * 64}) is False
        _c, _n, _nonce = await _login(remote)
        token = remote._logged["token"]
        assert remote._token_ok("", {proto: offer + token}) is True
        # a client may offer several subprotocols comma-separated; ours is accepted wherever it sits
        assert remote._token_ok("", {proto: "chat-v2, " + offer + token + " ,x"}) is True
        # wrong token, no header, no prefix, empty or trailing token: all refused with 401
        assert remote._token_ok("", {proto: offer + "0" * len(token)}) is False
        assert remote._token_ok("", {}) is False
        assert remote._token_ok("", {proto: token}) is False
        assert remote._token_ok("", {proto: offer}) is False
        assert remote._token_ok("", {proto: offer + token + "x"}) is False
    import asyncio
    asyncio.run(main())


def test_start_mounts_every_route_on_the_real_server():
    """start() is what a deployed flow calls; the rest of this file drives Remote's parts directly, so a
    mount() call start() got wrong (timeoutS/body_limit as keywords, not route keys -- found on a C3,
    2026-11-06) passed every test here and only failed on hardware."""
    async def main():
        remote, g, srv, des = _setup()
        await remote.start()
        table = srv.table
        page = table[("GET", ts_remote.PREFIX)]
        assert page[0] is None and page[2] is not None and page[2][0] == 200, page  # static (status, type, body, headers)
        ws = table[("GET", ts_remote.PREFIX + "ws")]
        assert ws[2] is not None and ws[3] is not None, ws  # ws handler + the pre= token gate
        get = table[("GET", ts_remote.PREFIX + "login")]
        assert get[0] is not None and get[1] == ts_remote._LOGIN_TIMEOUT_S, get
        post = table[("POST", ts_remote.PREFIX + "login")]
        assert post[0] is not None and post[1] == ts_remote._LOGIN_TIMEOUT_S, post
        assert post[4] == ts_remote._LOGIN_BODY_MAX, post
        await srv.stop()
    import asyncio
    asyncio.run(main())


def test_definition_problems_are_named():
    def build(des):
        remote = ts_remote.Remote(gui.GUI(), ts_http_server.Server(18402, [], {}), des)
        remote.stage()

    def bad(name, des):
        try:
            build(des)
        except ts_remote.BadDefinition as e:
            assert name in str(e), (name, str(e))
            return
        raise AssertionError("definition accepted: " + name)

    build({"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "children": [
        {"wid": "w", "kind": "label", "config": {}}]}}]})
    bad("twice", {"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "children": [
        {"wid": "w", "kind": "label", "config": {}}, {"wid": "w", "kind": "label", "config": {}}]}}]})
    bad("container", {"v": 1, "pages": [{"name": "p", "tree": {"kind": "grid", "children": []}}]})
    bad("gap", {"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "gap": -1, "children": []}}]})
    bad("mode", {"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "children": [
        {"wid": "w", "kind": "button", "config": {"mode": "laser"}}]}}]})
    bad("key", {"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "children": [
        {"wid": "f", "kind": "number", "config": {"label": "x"}}]}}]})
    # unknown widget kinds degrade on the page (P1): the builder accepts them
    build({"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "children": [
        {"wid": "w", "kind": "wobbly", "config": {}}]}}]})

    build({"v": 1, "pages": [{"name": "p", "tree": {"kind": "column", "children": [
        {"wid": "f", "kind": "number", "config": {"key": "k"}}]}}]})


def test_definition_builds_surface_and_fields():
    async def main():
        remote, g, srv, des = _setup()
        assert sorted(g.widgets.keys()) == ["bar", "boop", "go", "led", "nm", "pump", "save", "temp", "th"]
        assert g.widgets["boop"].touchable and not g.widgets["temp"].touchable
        assert g.value("th") == device_settings.get("threshold")
        assert set(g.surfaces["main"].pages.keys()) == {"home", "set"}
        placed = [w for w, _r in g.surfaces["main"].pages["set"]["widgets"]]
        assert "th" in placed
        # registered modes: the controlled toggle starts unknown, the unwired kind is the same
        assert g.widgets["pump"].mode == "toggle" and g.widgets["pump"].controlled
    import asyncio
    asyncio.run(main())


def test_input_frames_signed_and_replayed_are_refused():
    async def main():
        remote, g, srv, des = _setup()
        _conn, _n, nonce = await _login(remote)
        key = binascii.unhexlify(board_settings.load()["key"])
        sk = board_settings.hmac_sha256(key, nonce + b" remote display input v1")
        session = {"count": 0}

        def frame(msg, count=None, sign_key=sk):
            body = json.dumps({"c": count if count is not None else session["count"] + 1, "m": msg})
            sig = binascii.hexlify(board_settings.hmac_sha256(sign_key, body.encode())).decode()
            return body.encode() + b"\n" + sig.encode()

        out = remote._check(session, frame({"type": "hi", "v": 1}))
        assert out == {"type": "hi", "v": 1}
        assert session["count"] == 1
        f1 = frame({"type": "hi", "v": 1}, count=1)
        try:
            remote._check(session, f1)  # the exact same frame again: a replay (counter stuck at 1)
            raise AssertionError("replay accepted")
        except ValueError:
            pass
        raw2 = frame({"type": "hi", "v": 1}, count=2)
        tweaked = raw2.replace(b"hi", b"ho")  # altered after signing
        try:
            remote._check(session, tweaked)
            raise AssertionError("altered frame accepted")
        except ValueError as e:
            assert "wrong signature" in repr(e) or "wrong signature" in str(e), e
        try:
            remote._check(session, b'{"c":2,"m":{"type":"x"}}')
            raise AssertionError("unsigned frame accepted")
        except ValueError:
            pass
        if session["count"] == 2:
            session["count"] = 1  # resync for the jump test
        try:
            remote._check(session, frame({"type": "x"}, count=7))  # a counter that skips ahead
            raise AssertionError("jump accepted")
        except ValueError:
            pass
    import asyncio
    asyncio.run(main())


def test_dispatch_tap_and_nav():
    async def main():
        remote, g, srv, des = _setup()
        _conn, _n, _nonce = await _login(remote)
        session = _fresh_session(ts_remote._BQueue())
        remote._out = session["out"]

        _reply, err = remote._dispatch(session, {"type": "tap", "wid": "boop", "phase": "down"})
        assert err is None, err
        _reply, err = remote._dispatch(session, {"type": "tap", "wid": "boop", "phase": "up"})
        assert err is None, err
        payload = await g.event("boop")  # the flow's event queue today gets the same as a touch would
        assert payload is None  # a momentary button's payload is none; the tap went through

        # navigation is board-owned (SPEC 5): named pages, next/prev over the declaration order, home
        remote._dispatch(session, {"type": "nav", "cmd": "set"})
        assert g.surfaces["main"].page == "set", g.surfaces["main"].page
        remote._dispatch(session, {"type": "nav", "cmd": "home"})
        assert g.surfaces["main"].page == "home"
        remote._dispatch(session, {"type": "nav", "cmd": "next"})
        assert g.surfaces["main"].page == "set"  # top-level pages in declaration order: home, set
        remote._dispatch(session, {"type": "nav", "cmd": "prev"})
        assert g.surfaces["main"].page == "home"
        # the carousel-index message is gone: an unknown type is one unsigned err, the connection stays up
        reply, err = remote._dispatch(session, {"type": "page", "n": 0})
        assert err is not None and "unknown" in err, (reply, err)
        # a button on the page tree navigates the surface itself
        remote._dispatch(session, {"type": "tap", "wid": "go", "phase": "down"})
        remote._dispatch(session, {"type": "tap", "wid": "go", "phase": "up"})
        assert g.surfaces["main"].page == "set"
    import asyncio
    asyncio.run(main())


def test_screen_message_through_the_surface():
    async def main():
        remote, g, srv, des = _setup()
        out = ts_remote._BQueue()
        remote._out = out
        g.set_value("temp", 20.5, now=0)
        g.step(now=0)
        msg = json.loads(await out.get())
        assert msg["type"] == "screen" and msg["page"] == "home", msg
        assert msg["values"]["temp"][0] == 20.5 and msg["values"]["temp"][1] == "known"
        g.set_value("temp", 21.5, now=200)
        g.step(now=200)
        msg2 = json.loads(await out.get())
        assert msg2["type"] == "values" and msg2["values"]["temp"][0] == 21.5, msg2
    import asyncio
    asyncio.run(main())


def test_form_submit_writes_settings():
    async def main():
        remote, g, srv, des = _setup()
        _conn, _n, _nonce = await _login(remote)
        session = _fresh_session(ts_remote._BQueue())
        reply, err = remote._dispatch(session, {"type": "form", "form": "cfg",
                                                "values": {"threshold": "31.5", "name": "kitchen"}})
        assert err is None, err
        assert reply["type"] == "form_ok" and reply["keys"] == ["name", "threshold"], reply
        assert device_settings.get("threshold") == 31.5
        assert device_settings.get("name") == "kitchen"
        assert g.value("th") == 31.5
        # one flow event per save, carrying the written values (SPEC 5.1 step 4)
        evt = await g.event("save")
        assert evt == {"form": "cfg", "values": {"threshold": 31.5, "name": "kitchen"}}, evt
        # a value that will not convert refuses the whole form before any write: form_err names the keys
        device_settings.set("threshold", 21)
        reply, err = remote._dispatch(session, {"type": "form", "form": "cfg",
                                                "values": {"threshold": "zap", "name": "ok"}})
        assert err is None, err
        assert reply["type"] == "form_err" and reply["failed"] == {"threshold": "not a number"}, reply
        assert device_settings.get("threshold") == 21  # nothing written, name included
        # every failing key is named, not just the first
        remote._widgets["extra"] = {"kind": "number", "config": {"key": "extra", "form": "cfg"}}
        reply, err = remote._dispatch(session, {"type": "form", "form": "cfg",
                                                "values": {"threshold": "zap", "extra": "also-zap"}})
        assert reply["type"] == "form_err" and sorted(reply["failed"]) == ["extra", "threshold"], reply
        # an empty submit is allowed: writes nothing, form_ok with no keys, one event with empty values
        reply, err = remote._dispatch(session, {"type": "form", "form": "cfg", "values": {}})
        assert err is None, err
        assert reply == {"type": "form_ok", "form": "cfg", "keys": []}, reply
        assert device_settings.get("threshold") == 21
        evt = await g.event("save")
        assert evt == {"form": "cfg", "values": {}}, evt
        # a form name the definition does not carry is a plain err
        reply, err = remote._dispatch(session, {"type": "form", "form": "nope", "values": {}})
        assert err is not None
    import asyncio
    asyncio.run(main())


def test_ctl_and_deadman_link_events():
    async def main():
        remote, g, srv, des = _setup(deadman=150)
        remote._widgets["level"] = {"kind": "ctl", "config": {"lo": 0, "hi": 100}}
        out = ts_remote._BQueue()
        session = _fresh_session(out)
        remote._out = out
        remote._logged = {"key": b"x"}  # dispatch does not need the login for a ctl; only _check does
        _reply, err = remote._dispatch(session, {"type": "ctl", "wid": "pos", "value": 50})
        assert err is not None  # unknown widget refused (there is no ctl named pos in this definition)
        _reply, err = remote._dispatch(session, {"type": "ctl", "wid": "level", "value": "42"})
        assert err is None, err
        msg = await remote.control()
        assert msg["payload"] == 42.0 and msg["wid"] == "level", msg
        _reply, err = remote._dispatch(session, {"type": "ctl", "wid": "level", "value": 200})
        assert err is not None
        # within the deadman window the link stays up; past it, a sweep fires down once
        remote._evaluate(session, "sweep")
        assert session["link"] == "up", session
        session["last_ctl"] = ts_remote.ticks() - 400
        remote._evaluate(session, "sweep")
        assert session["link"] == "down", session
        assert await remote.link_change() == "down"
        # the next ctl re-arms and reports up
        remote._dispatch(session, {"type": "ctl", "wid": "level", "value": 10})
        assert await remote.link_change() == "up"
        assert session["link"] == "up"
        # a pong-stale miss without a fresh input fires down once, and no follow-up sweeps re-fire it
        session["armed"] = False
        session["last_seen"] = ts_remote.ticks() - 5000
        remote._evaluate(session, "sweep")
        assert session["link"] == "down"
        assert remote.link._items == ["down"]  # exactly one event per transition
        remote._evaluate(session, "sweep")
        assert remote.link._items == ["down"]  # still down: nothing more queued
    import asyncio
    asyncio.run(main())


def test_ping_replies_with_echo():
    async def main():
        remote, g, srv, des = _setup()
        session = _fresh_session(ts_remote._BQueue())
        reply, err = remote._dispatch(session, {"type": "ping", "at": 1234})
        assert err is None, err
        assert reply["type"] == "pong" and reply["echo"] == 1234, reply
    import asyncio
    asyncio.run(main())


import os  # noqa: E402


def test_dead_socket_is_closed_after_the_miss_window():
    async def main():
        remote, g, srv, des = _setup()
        w = FakeWS()
        session = {"ws": w, "out": ts_remote._BQueue(), "count": 0, "link": "up", "armed": False,
                   "last_seen": ts_remote.ticks() - (ts_remote._MISSED_PONG_MS + 500), "last_ctl": None,
                   "tasks": None}
        remote._conn, remote._out = session, session["out"]
        pinger = asyncio.create_task(remote._pings(session))
        await asyncio.sleep_ms(100)
        assert w.closes, w.closes  # the board closed its side, not waiting out TCP's own timeout
        assert remote._conn is None
        pinger.cancel()
        await asyncio.sleep_ms(30)
    import asyncio
    asyncio.run(main())


def test_a_new_session_gets_a_whole_screen():
    async def main():
        remote, g, srv, des = _setup()
        _conn, _n, _nonce = await _login(remote)
        # the first session: the surface's initial full push carries a screen
        w1 = FakeWS()
        t1 = asyncio.create_task(remote._session(w1, ""))
        await asyncio.sleep_ms(150)
        g.set_value("temp", 20.5, now=0)
        g.step(now=0)
        await asyncio.sleep_ms(50)  # the writer task needs a turn to drain the queue into ws.sent
        assert "screen" in [json.loads(m).get("type") for m in w1.sent], w1.sent
        # a viewer connecting to the RUNNING surface must also get a whole screen (SPEC 5: session start
        # and reconnects) -- before the fix it saw only the values of widgets that happened to change,
        # and never learned what page it was on (found end-to-end on the S3, 2026-11-12)
        w2 = FakeWS()
        t2 = asyncio.create_task(remote._session(w2, ""))
        await asyncio.sleep_ms(150)
        g.set_value("temp", 21.5, now=200)
        g.step(now=200)
        await asyncio.sleep_ms(50)
        kinds2 = [json.loads(m).get("type") for m in w2.sent]
        assert "screen" in kinds2, (kinds2, w2.sent)
        screens = [json.loads(m) for m in w2.sent if json.loads(m).get("type") == "screen"]
        assert screens[0]["page"] == "home" and screens[0]["values"]["temp"][0] == 21.5, screens
        w1.closed = True
        w2.closed = True
        for t in (t1, t2):
            t.cancel()
        await asyncio.sleep_ms(30)
    import asyncio
    asyncio.run(main())


def test_session_sends_definition_and_takes_over():
    async def main():
        remote, g, srv, des = _setup()
        _conn, _n, _nonce = await _login(remote)
        w1 = FakeWS()
        t1 = asyncio.create_task(remote._session(w1, ""))
        await asyncio.sleep_ms(150)
        parts = [json.loads(m) for m in w1.sent if json.loads(m)["type"] == "screen_def"]
        assert len(parts) == parts[0]["n"] and parts[0]["n"] > 1  # chunked into >1 piece
        assert [p["i"] for p in parts] == list(range(parts[0]["n"]))
        whole = "".join(p["part"] for p in parts)
        assert json.loads(whole)["v"] == 1
        w2 = FakeWS()
        t2 = asyncio.create_task(remote._session(w2, ""))
        await asyncio.sleep_ms(600)
        assert w1.closes == [4000], w1.closes
        kinds = [json.loads(m).get("type") for m in w1.sent]
        assert "takeover" in kinds, kinds
        assert json.loads([m for m in w1.sent if "takeover" in m][0])["reason"]
        # settle the leftover tasks: the run loop's own shutdown waits on nothing here, but the spawned
        # session tasks (via runtime.spawn) keep the loop alive on some ports
        w2.closed = True
        w1.closed = True
        for t in (t1, t2):
            t.cancel()
        await asyncio.sleep_ms(30)
    asyncio.run(main())


minitest.run([test_login_requires_password_and_right_answer, test_login_rate_limit_answers_429,
              test_login_queue_overflow_answers_503, test_token_gate,
              test_start_mounts_every_route_on_the_real_server,
              test_definition_problems_are_named, test_definition_builds_surface_and_fields,
              test_input_frames_signed_and_replayed_are_refused, test_dispatch_tap_and_nav,
              test_screen_message_through_the_surface, test_form_submit_writes_settings,
              test_ctl_and_deadman_link_events, test_ping_replies_with_echo,
              test_dead_socket_is_closed_after_the_miss_window, test_a_new_session_gets_a_whole_screen,
              test_session_sends_definition_and_takes_over])



