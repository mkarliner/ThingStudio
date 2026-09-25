# SPDX-License-Identifier: Apache-2.0
# backend/test/test_tcp_relay.py
#
# tcp_relay.py (WiFi transport, 2026-09-24) against a fake board: a local asyncio TCP server that
# plays device-runtime/src/net_transport.py's side of the handshake, written independently with the
# stdlib `hmac` module rather than reusing tcp_relay's own helpers. The real device side is covered
# by device-runtime/test/test_listener_integration.py against the MicroPython unix port.

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import socket
import threading

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend import tcp_relay
from thingstudio_backend.line_framing import encode_f64_line
from thingstudio_backend.tcp_relay import TcpConnection, TcpRelayError, answer_challenge, discover
from thingstudio_backend.ws_relay import make_websocket_handler

PASSWORD = "correct horse"


def _board_key(salt: bytes, password: str, iterations: int) -> bytes:
    k = salt + password.encode()
    for _ in range(iterations):
        k = hashlib.sha256(k).digest()
    return k


class FakeBoard:
    """mode: "normal", "busy", "nopassword", "silent" (never sends a challenge), "http" (not a board)."""

    def __init__(self, mode: str = "normal", password: str = PASSWORD, hostname: str = "kitchen") -> None:
        self.mode = mode
        self.password = password
        self.hostname = hostname
        self.received: list[bytes] = []
        self.writers: list[asyncio.StreamWriter] = []
        self.server: asyncio.base_events.Server | None = None
        self.port = 0
        self.authed = asyncio.Event()

    async def start(self) -> None:
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        for w in self.writers:
            w.close()
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.writers.append(writer)
        if self.mode == "busy":
            writer.write(b"TSAUTH BUSY\n")
            await writer.drain()
            writer.close()
            return
        if self.mode == "nopassword":
            writer.write(b"TSAUTH NOPASSWORD\n")
            await writer.drain()
            writer.close()
            return
        if self.mode == "silent":
            await asyncio.sleep(30)
            return
        if self.mode == "http":
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            writer.close()
            return
        nonce, salt, iterations = os.urandom(16), os.urandom(16), 50
        writer.write(f"TSAUTH1 {self.hostname} {nonce.hex()} {salt.hex()} {iterations}\n".encode())
        await writer.drain()
        line = (await reader.readline()).decode().strip()
        want = hmac.new(_board_key(salt, self.password, iterations), nonce, hashlib.sha256).hexdigest()
        if line != f"TSAUTH1 {want}":
            writer.write(b"TSAUTH FAIL\n")
            await writer.drain()
            writer.close()
            return
        writer.write(b"TSAUTH OK\n")
        writer.write(b"LISTENER_HELLO_FROM_BOARD\n")
        await writer.drain()
        self.authed.set()
        while True:
            data = await reader.read(4096)
            if not data:
                return
            self.received.append(data)

    async def send(self, data: bytes) -> None:
        self.writers[-1].write(data)
        await self.writers[-1].drain()


def test_answer_challenge_matches_an_independent_hmac() -> None:
    nonce, salt = bytes(range(16)), bytes(range(16, 32))
    challenge = f"TSAUTH1 kitchen {nonce.hex()} {salt.hex()} 7"
    want = hmac.new(_board_key(salt, "pw123456", 7), nonce, hashlib.sha256).hexdigest()
    assert answer_challenge(challenge, "pw123456") == f"TSAUTH1 {want}"
    for bad in ("TSAUTH1 x", "HELLO a b c d", f"TSAUTH1 k {nonce.hex()} {salt.hex()} 0"):
        with pytest.raises(ValueError):
            answer_challenge(bad, "pw")


@pytest.mark.asyncio
async def test_connect_with_saved_password_relays_both_ways() -> None:
    board = FakeBoard()
    await board.start()
    looked_up: list[str] = []

    def lookup(hostname: str) -> str | None:
        looked_up.append(hostname)
        return PASSWORD

    conn = TcpConnection("127.0.0.1", board.port, password_lookup=lookup)
    try:
        await conn.open()
        assert looked_up == ["kitchen"]
        assert conn.hostname == "kitchen"
        assert conn.port == "kitchen (127.0.0.1)"
        chunks = conn.read_loop()
        assert b"LISTENER_HELLO_FROM_BOARD" in await asyncio.wait_for(chunks.__anext__(), 2)
        await conn.write(b"F64:abc\n")
        await board.send(b"F64:reply\n")
        assert b"F64:reply" in await asyncio.wait_for(chunks.__anext__(), 2)
        for _ in range(20):
            if board.received:
                break
            await asyncio.sleep(0.05)
        assert b"".join(board.received) == b"F64:abc\n"
    finally:
        await conn.close()
        await board.stop()


@pytest.mark.asyncio
async def test_explicit_password_wins_over_lookup() -> None:
    board = FakeBoard()
    await board.start()
    conn = TcpConnection("127.0.0.1", board.port, password=PASSWORD, password_lookup=lambda h: "wrong wrong")
    try:
        await conn.open()
    finally:
        await conn.close()
        await board.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "password", "lookup", "code"),
    [
        ("normal", "wrong horse!", None, "auth_failed"),
        ("normal", None, lambda h: None, "no_password"),
        ("busy", PASSWORD, None, "busy"),
        ("nopassword", PASSWORD, None, "board_no_password"),
        ("http", PASSWORD, None, "network"),
    ],
)
async def test_handshake_failures_have_actionable_codes(mode, password, lookup, code) -> None:
    board = FakeBoard(mode)
    await board.start()
    conn = TcpConnection("127.0.0.1", board.port, password=password, password_lookup=lookup)
    try:
        with pytest.raises(TcpRelayError) as info:
            await conn.open()
        assert info.value.code == code
        assert "NODE_ERROR" in str(info.value)
        if code in ("no_password", "auth_failed"):
            assert info.value.hostname == "kitchen"
    finally:
        await conn.close()
        await board.stop()


@pytest.mark.asyncio
async def test_silent_server_times_out(monkeypatch) -> None:
    monkeypatch.setattr(tcp_relay, "_HANDSHAKE_TIMEOUT_S", 0.3)
    board = FakeBoard("silent")
    await board.start()
    conn = TcpConnection("127.0.0.1", board.port, password=PASSWORD)
    try:
        with pytest.raises(TcpRelayError) as info:
            await conn.open()
        assert info.value.code == "timeout"
    finally:
        await conn.close()
        await board.stop()


@pytest.mark.asyncio
async def test_connection_refused_is_a_named_error() -> None:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    conn = TcpConnection("127.0.0.1", port, password=PASSWORD)
    with pytest.raises(TcpRelayError) as info:
        await conn.open()
    assert f"127.0.0.1:{port}" in str(info.value)


@pytest.mark.asyncio
async def test_board_closing_ends_read_loop_with_an_error() -> None:
    board = FakeBoard()
    await board.start()
    conn = TcpConnection("127.0.0.1", board.port, password=PASSWORD)
    try:
        await conn.open()
        chunks = conn.read_loop()
        await asyncio.wait_for(chunks.__anext__(), 2)
        board.writers[-1].close()
        with pytest.raises(TcpRelayError) as info:
            while True:
                await asyncio.wait_for(chunks.__anext__(), 2)
        assert "closed the connection" in str(info.value)
    finally:
        await conn.close()
        await board.stop()


@pytest.mark.asyncio
async def test_keepalive_sends_blank_lines(monkeypatch) -> None:
    monkeypatch.setattr(tcp_relay, "KEEPALIVE_INTERVAL_S", 0.1)
    board = FakeBoard()
    await board.start()
    conn = TcpConnection("127.0.0.1", board.port, password=PASSWORD)
    try:
        await conn.open()
        await asyncio.sleep(0.35)
        assert b"".join(board.received).count(b"\n") >= 2
        assert b"".join(board.received).strip() == b""
    finally:
        await conn.close()
        await board.stop()


def _udp_responder(replies: list[bytes], stop: threading.Event) -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    s.settimeout(0.1)
    port = s.getsockname()[1]

    def run() -> None:
        while not stop.is_set():
            try:
                data, addr = s.recvfrom(64)
            except TimeoutError:
                continue
            except OSError:
                return
            if data == b"TSPROBE1":
                for r in replies:
                    s.sendto(r, addr)
        s.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def test_discover_parses_replies_and_ignores_junk() -> None:
    stop = threading.Event()
    good = json.dumps({"ts": 1, "hostname": "kitchen", "chip": "ESP32", "flow": "demo", "port": 7462, "wifiTransport": True, "busy": False}).encode()
    port = _udp_responder([good, b"not json", json.dumps({"ts": 2}).encode(), good], stop)
    try:
        boards = discover(timeout_s=0.5, targets=["127.0.0.1"], probe_port=port)
    finally:
        stop.set()
    assert len(boards) == 1
    b = boards[0]
    assert (b.hostname, b.address, b.port, b.chip, b.flow, b.wifi_transport, b.busy) == ("kitchen", "127.0.0.1", 7462, "ESP32", "demo", True, False)


def test_discover_with_nothing_listening_returns_empty() -> None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    assert discover(timeout_s=0.2, targets=["127.0.0.1"], probe_port=port) == []


# --- through the WebSocket relay -------------------------------------------------------------


def _app(password_lookup=None, discover_fn=None) -> web.Application:
    app = web.Application()
    kwargs = {"password_lookup": password_lookup}
    if discover_fn is not None:
        kwargs["discover_fn"] = discover_fn
    app.router.add_get("/ws", make_websocket_handler(**kwargs))
    return app


@pytest.mark.asyncio
async def test_ws_connect_by_host_relays_frames() -> None:
    board = FakeBoard()
    await board.start()
    try:
        async with TestClient(TestServer(_app(password_lookup=lambda h: PASSWORD))) as client:
            ws = await client.ws_connect("/ws")
            await ws.send_json({"type": "connect", "host": "127.0.0.1", "tcpPort": board.port})
            status = await ws.receive_json()
            assert status == {"type": "status", "network": True, "hostname": "kitchen", "connected": True, "port": "kitchen (127.0.0.1)"}
            debug = await ws.receive_json()
            assert debug == {"type": "debug", "line": "LISTENER_HELLO_FROM_BOARD"}
            frame = b"\x00\x01\x0a\xa0"
            await board.send(encode_f64_line(frame))
            msg = await ws.receive()
            assert msg.data == frame
            await ws.send_bytes(frame)
            for _ in range(20):
                if board.received:
                    break
                await asyncio.sleep(0.05)
            assert b"".join(board.received) == encode_f64_line(frame)
            await ws.close()
    finally:
        await board.stop()


@pytest.mark.asyncio
async def test_ws_connect_without_saved_password_reports_code_and_hostname() -> None:
    board = FakeBoard()
    await board.start()
    try:
        async with TestClient(TestServer(_app(password_lookup=lambda h: None))) as client:
            ws = await client.ws_connect("/ws")
            await ws.send_json({"type": "connect", "host": "127.0.0.1", "tcpPort": board.port})
            status = await ws.receive_json()
            assert status["errorCode"] == "no_password" and status["hostname"] == "kitchen"
            # Retry with a password typed by the user.
            await ws.send_json({"type": "connect", "host": "127.0.0.1", "tcpPort": board.port, "password": PASSWORD})
            status = await ws.receive_json()
            assert status["connected"] is True
            await ws.close()
    finally:
        await board.stop()


@pytest.mark.asyncio
async def test_ws_rejects_bad_tcp_port() -> None:
    async with TestClient(TestServer(_app())) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "host": "127.0.0.1", "tcpPort": "7462"})
        status = await ws.receive_json()
        assert "invalid network port" in status["error"]
        await ws.close()


@pytest.mark.asyncio
async def test_ws_discover_returns_boards() -> None:
    found = [tcp_relay.DiscoveredBoard("kitchen", "10.0.0.5", 7462, "ESP32", None, True, False)]
    async with TestClient(TestServer(_app(discover_fn=lambda: found))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "discover"})
        reply = await ws.receive_json()
        assert reply == {
            "type": "boards",
            "boards": [
                {"hostname": "kitchen", "address": "10.0.0.5", "port": 7462, "chip": "ESP32", "flow": None, "wifiTransport": True, "busy": False}
            ],
        }
        await ws.close()


def test_connect_errors_carry_a_next_step(monkeypatch) -> None:
    import errno

    monkeypatch.setattr("sys.platform", "darwin")
    text = tcp_relay._explain_connect_oserror(OSError(errno.EHOSTUNREACH, "No route to host"))
    assert "Local Network" in text and "Apple's Terminal" in text
    monkeypatch.setattr("sys.platform", "linux")
    assert "same network" in tcp_relay._explain_connect_oserror(OSError(errno.EHOSTUNREACH, "No route to host"))
    assert "Board settings" in tcp_relay._explain_connect_oserror(OSError(errno.ECONNREFUSED, "Connection refused"))
