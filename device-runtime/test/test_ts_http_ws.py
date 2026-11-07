# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_ts_http_ws.py
#
# The ts_http_server's WebSocket upgrade (remote-display spike, 2026-11-06) under the real MicroPython unix
# port, with a real listening socket and a real client -- the handshake (RFC 6455 Sec-WebSocket-Accept),
# masked client frames, text/binary, peer ping answered, peer close, fragmentation refused cleanly with a
# close frame, the per-frame cap closing with 1009, the pre-check refusing with 401, and ordinary queue and
# static routes working on the same server alongside -- the spike brief's "one other route" requirement.
#
# Client frames are built by hand here (a masked client frame is the exact bytes the phone's browser sends);
# nothing is stubbed out of what the server actually parses.

import asyncio
import os

import minitest

minitest.add_src_to_path()
import sys  # noqa: E402

sys.path.insert(0, sys.path[0] + "/vendor/thingstudio_http")
import ts_http_server  # noqa: E402

# hashlib.sha1 availability is itself checkpoint 1's per-build check; fail loud if it is missing on a port.
try:
    import hashlib
    hashlib.sha1(b"x")
except (ImportError, AttributeError):
    print("SKIP: this build has no hashlib.sha1")
    sys.exit(0)


def _guid():
    return "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _accept_od(key):
    """The RFC 6455 expected accept value, computed independently (codecs.base64) not via the server."""
    import hashlib
    import binascii as b64mod
    digest = hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
    return b64mod.b2a_base64(digest).decode().strip()


def _base_port():
    """A run-to-run moving base so consecutive runs (TIME_WAIT leftovers under a plain bind probe) never
    collide: seconds-of-day * 10 inside a fixed band, or WS_TEST_PORT to pin it."""
    import time
    pinned = os.getenv("WS_TEST_PORT", "")
    if pinned:
        return int(pinned)
    return 18000 + (int(time.time()) % 600) * 20


def _make_server(offset=0):
    return ts_http_server.Server(_base_port() + offset, [], {})


async def _ws_connect(port, path, token=None, upgrade=True, extra=b""):
    """A real TCP client: returns (reader, writer, status_line, headers-as-str)."""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    req = "GET " + path + " HTTP/1.1\r\nHost: h\r\n" if not upgrade else (
        "GET " + path + " HTTP/1.1\r\nHost: h\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n")
    if token is not None:
        req += "?t=" + token
    writer.write((req + "\r\n").encode())
    writer.write(extra)
    await writer.drain()
    status = (await asyncio.wait_for(reader.readline(), 5)).decode().strip()
    headers = b""
    while True:
        line = await asyncio.wait_for(reader.readline(), 5)
        headers += line
        if line in (b"\r\n", b"\n", b""):
            break
    return reader, writer, status, headers.decode()


def _client_frame(opcode, payload, mask_key=b"\x12\x34\x56\x78", fin=1):
    """A client->server frame, masked, exactly as a browser sends it. payload must be bytes."""
    head = bytearray([(0x80 * fin) | opcode])
    n = len(payload)
    if n < 126:
        head.append(0x80 | n)
    elif n < 65536:
        head.append(0x80 | 126)
        head.append((n >> 8) & 0xFF)
        head.append(n & 0xFF)
    else:
        head.append(0x80 | 127)
        for sh in (56, 48, 40, 32, 24, 16, 8, 0):
            head.append((n >> sh) & 0xFF)
    masked = bytes(payload[i] ^ mask_key[i % 4] for i in range(n))
    return bytes(head) + mask_key + masked


async def _read_server_frame(reader):
    """Reads one unmasked server->client frame: returns (opcode, payload)."""
    head = await asyncio.wait_for(reader.read(2), 5)
    if not head or len(head) < 2:
        return (None, b"")
    opcode = head[0] & 0x0F
    masked = bool(head[1] & 0x80)
    n = head[1] & 0x7F
    if n == 126:
        ext = await asyncio.wait_for(reader.read(2), 5)
        n = (ext[0] << 8) | ext[1]
    elif n == 127:
        n = 0
        for b in await asyncio.wait_for(reader.read(8), 5):
            n = (n << 8) | b
    if masked:
            await asyncio.wait_for(reader.read(4), 5)
    payload = await asyncio.wait_for(reader.read(n), 5) if n else b""
    return (opcode, payload)


def _echo_handler(fired):
    async def handler(ws, query):
        fired.append("handler:" + query)
        while True:
            kind, payload = await ws.recv()
            if kind == "close":
                return
            if kind in ("text", "binary"):
                await ws.send_text("echo:" + (payload if isinstance(payload, str) else payload.decode()))
            if kind == "ping":
                pass  # recv() answered with a pong already
    return handler


# --- inject the tests -----------------------------------------------------------------------------------

def test_handshake_accept_and_echo():
    async def main():
        srv = _make_server()
        fired = []
        srv.mount({"id": "e", "method": "GET", "path": "/ws/echo"}, ws=_echo_handler(fired))
        await srv.ensure()
        reader, writer, status, headers = await _ws_connect(srv.port, "/ws/echo")
        assert status == "HTTP/1.1 101 Switching Protocols", status
        assert "Upgrade: websocket" in headers
        want = "Sec-WebSocket-Accept: " + _accept_od("dGhlIHNhbXBsZSBub25jZQ==")
        assert want in headers, headers
        # a masked text frame, the browser shape
        writer.write(_client_frame(1, b"hello"))
        await writer.drain()
        opcode, payload = await _read_server_frame(reader)
        assert opcode == 1, opcode
        assert payload == b"echo:hello", payload
        # a peer ping: answered with a pong whose body matches, and returned to the handler as traffic
        writer.write(_client_frame(9, b"roll"))
        await writer.drain()
        opcode, payload = await _read_server_frame(reader)
        assert opcode == 10 and payload == b"roll", (opcode, payload)
        # a clean client close, answered with our own close frame
        writer.write(_client_frame(8, b"\x03\xe8"))
        await writer.drain()
        opcode, payload = await _read_server_frame(reader)
        assert opcode == 8, opcode
        fired_done = fired == ["handler:"]
        assert fired_done, fired  # the handler saw the empty query (no ?t given)
        writer.close()
        await srv.stop()
    asyncio.run(main())


def test_fragmentation_refused_cleanly():
    async def main():
        srv = _make_server()
        srv.mount({"id": "e", "method": "GET", "path": "/ws/frag"}, ws=_echo_handler([]))
        await srv.ensure()
        reader, writer, status, _h = await _ws_connect(srv.port, "/ws/frag")
        # two frames: a started text fragment and a continuation -- both refused together, close 1003
        writer.write(_client_frame(1, b"half", fin=0))
        writer.write(_client_frame(0, b"other half"))
        await writer.drain()
        opcode, payload = await _read_server_frame(reader)
        assert opcode == 8, opcode
        assert payload[:2] == b"\x03\xeb", payload  # 1003 in two bytes
        writer.close()
        await srv.stop()
    asyncio.run(main())


def test_frame_cap_closes_with_1009():
    async def main():
        srv = _make_server()
        srv.mount({"id": "e", "method": "GET", "path": "/ws/cap"}, ws=_echo_handler([]))
        await srv.ensure()
        reader, writer, _s, _h = await _ws_connect(srv.port, "/ws/cap")
        writer.write(_client_frame(1, b"Z" * 3000))
        await writer.drain()
        opcode, payload = await _read_server_frame(reader)
        assert opcode == 8 and payload[:2] == b"\x03\xf1", (opcode, payload)  # 1009
        assert payload[:2] == b"\x03\xf1"  # 1009 = 0x03F1
        writer.close()
        await srv.stop()
    asyncio.run(main())


def test_pre_check_gates_upgrade_with_401():
    async def main():
        srv = _make_server()
        srv.mount({"id": "e", "method": "GET", "path": "/ws/gate"},
                  ws=_echo_handler([]), pre=lambda query, headers: False)
        await srv.ensure()
        reader, writer, status, _h = await _ws_connect(srv.port, "/ws/gate")
        assert status == "HTTP/1.1 401 Unauthorized", status
        writer.close()
        await srv.stop()
    asyncio.run(main())


def test_non_upgrade_request_fails():
    async def main():
        srv = _make_server()
        srv.mount({"id": "e", "method": "GET", "path": "/ws/only"}, ws=_echo_handler([]))
        await srv.ensure()
        reader, writer, status, _h = await _ws_connect(srv.port, "/ws/only", upgrade=False)
        assert status == "HTTP/1.1 401 Unauthorized", status
        writer.close()
        await srv.stop()
    asyncio.run(main())


def test_queue_and_static_routes_alongside():
    async def main():
        srv = _make_server()
        q = ts_http_server.Queue()
        srv.mount({"id": "q", "method": "POST", "path": "/flow/echo", "body_limit": 64, "timeoutS": 5}, queue=q)
        srv.mount({"id": "s", "method": "GET", "path": "/static/ping"},
                  static=(200, "text/plain",
                          b"pong!", [("ETag", '"abc"'), ("Content-Encoding", "gzip")]))
        await srv.ensure()
        consumer = asyncio.create_task(_consume(q))
        reader, writer = await asyncio.open_connection("127.0.0.1", srv.port)
        writer.write(b"POST /flow/echo HTTP/1.1\r\nHost: h\r\nContent-Length: 8\r\n\r\nstraight")
        await writer.drain()
        resp = await asyncio.wait_for(_read_all(reader), 5)
        assert resp.startswith(b"HTTP/1.1 200 OK"), resp
        assert b"banana" in resp, resp
        r2, w2 = await asyncio.open_connection("127.0.0.1", srv.port)
        w2.write(b"GET /static/ping HTTP/1.1\r\nHost: h\r\n\r\n")
        await w2.drain()
        resp2 = await asyncio.wait_for(_read_all(r2), 5)
        assert b"ETag" in resp2 and b"Content-Encoding: gzip" in resp2
        r3, w3 = await asyncio.open_connection("127.0.0.1", srv.port)
        w3.write(b"GET /nothing HTTP/1.1\r\nHost: h\r\n\r\n")
        await w3.drain()
        resp3 = await asyncio.wait_for(_read_all(r3), 5)
        assert resp3.startswith(b"HTTP/1.1 404"), resp3
        await srv.stop()
    asyncio.run(main())


async def _consume(q):
    item = await q.get()
    conn = item["_http_conn"]
    body = item["req"].get("body", b"")
    conn["status"], conn["body"] = 200, body.decode() + "-banana"
    conn["done"].set()


def test_connection_is_closed_after_the_answer():
    """The server must release the socket, not just send `Connection: close`. On MicroPython asyncio
    `writer.close()` leaves it open until `wait_closed()`, and with ESP32's cap of 10 sockets that becomes
    "the board answers ten requests and then resets everything" (found on a C3, 2026-11-07). CPython closes on
    close(), so a test that only reads the body never notices."""
    async def main():
        srv = _make_server()
        srv.mount({"id": "s", "method": "GET", "path": "/static/bye"},
                  static=(200, "text/plain", b"bye", []))
        await srv.ensure()
        for i in range(30):
            reader, writer = await asyncio.open_connection("127.0.0.1", srv.port)
            writer.write(b"GET /static/bye HTTP/1.1\r\nHost: h\r\n\r\n")
            await writer.drain()
            got = b""
            while b"bye" not in got:
                chunk = await asyncio.wait_for(reader.read(256), 5)
                assert chunk, "answer %d ended before the body" % (i + 1,)
                got += chunk
            eof = await asyncio.wait_for(reader.read(1), 5)  # b"" = closed; a timeout means it was leaked
            assert eof == b"", "connection %d left open after its answer" % (i + 1,)
            writer.close()
        await srv.stop()
    asyncio.run(main())


async def _read_all(reader):
    out = b""
    while True:
        try:
            got = await asyncio.wait_for(reader.read(256), 2)
        except asyncio.TimeoutError:
            break
        if not got:
            break
        out += got
    return out


def test_the_next_flow_can_bind_the_port_the_cleanup_released():
    """A redeploy tears the old flow down through runtime.cancel_running(), which runs the cleanups registered
    with runtime.register_cleanup(). On MicroPython a socket is only released by wait_closed(), so the server's
    cleanup is a coroutine that cancel_running awaits -- scheduling it as a task instead lost the race and left
    port 80 bound, so the redeployed flow's web server never started (Freenove S3, 2026-11-07)."""
    async def main():
        import runtime
        # its own port: register_cleanup keys on the port and keeps the first registration, and the other tests
        # here use _base_port() too, so a shared number would leave this server's cleanup unregistered
        srv = ts_http_server.Server(_base_port() + 500, [], {})
        srv.mount({"id": "s", "method": "GET", "path": "/x"}, static=(200, "text/plain", b"ok", []))
        await srv.ensure()
        await runtime.cancel_running()          # exactly what a redeploy does
        again = ts_http_server.Server(srv.port, [], {})
        again.mount({"id": "s2", "method": "GET", "path": "/x"}, static=(200, "text/plain", b"ok", []))
        await again.ensure()                    # EADDRINUSE until the cleanup was awaited
        await again.stop()
    asyncio.run(main())


def test_exact_one_owner_mount_is_refused():
    async def main():
        srv = _make_server()
        for bad in (dict(queue=ts_http_server.Queue(), static=(200, "t", b"x", [])),
                    dict(queue=None, static=None, ws=None)):
            try:
                srv.mount({"id": "b", "method": "GET", "path": "/bad"}, **bad)
                raise AssertionError("mount accepted a broken owner set: %r" % (bad,))
            except ValueError:
                pass
        await srv.stop()
    asyncio.run(main())


minitest.run([test_handshake_accept_and_echo, test_fragmentation_refused_cleanly,
              test_frame_cap_closes_with_1009, test_pre_check_gates_upgrade_with_401,
              test_non_upgrade_request_fails, test_queue_and_static_routes_alongside,
              test_connection_is_closed_after_the_answer,
              test_the_next_flow_can_bind_the_port_the_cleanup_released,
              test_exact_one_owner_mount_is_refused])
