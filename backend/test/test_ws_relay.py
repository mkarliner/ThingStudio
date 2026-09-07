# SPDX-License-Identifier: Apache-2.0
# backend/test/test_ws_relay.py
#
# Exercises the WS relay end-to-end (control-plane JSON + binary relay) against
# a fake serial connection -- no real hardware needed for this layer's own
# logic (framing/multiplexing/fault handling). Real pyserial behavior
# (DTR/RTS quirks, actual disconnect timing) still needs a real-hardware pass
# per docs/working-notes/backend-platform-decision.md §5 -- not claimed here.
#
# Updated 2026-09-07 (editor-backend-wiring session) alongside ws_relay.py's
# own fix: the fake serial connection's `feed()` now needs to be fed real
# base64/"F64:" lines (line_framing.encode_f64_line), not raw framing.py
# frame bytes, since that's what the relay now actually expects on the
# "serial" side -- matching the real device listener's wire format instead
# of the incorrect raw-binary assumption these tests previously encoded.
# framing.encode_frame is still used below, but only to build the *inner*
# §13 frame bytes that then get F64-line-wrapped -- that inner format is
# unchanged by this fix.

import asyncio
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.framing import encode_frame
from thingstudio_backend.line_framing import encode_f64_line
from thingstudio_backend.serial_relay import SerialRelayError
from thingstudio_backend.ws_relay import ConnectionSession, make_websocket_handler


class FakeSerialConnection:
    """Stands in for serial_relay.SerialConnection: same public shape
    (port, open/write/read_loop/close/request_stop), no real hardware."""

    def __init__(self, port: str, baudrate: int = 115200) -> None:
        self.port = port
        self.baudrate = baudrate
        self.written: list[bytes] = []
        self.closed = False
        self._queue: asyncio.Queue = asyncio.Queue()

    async def open(self) -> None:
        pass

    async def write(self, data: bytes) -> None:
        self.written.append(data)

    async def read_loop(self):
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if isinstance(item, Exception):
                raise item
            yield item

    def request_stop(self) -> None:
        self._queue.put_nowait(None)

    async def close(self) -> None:
        self.closed = True
        self.request_stop()

    # Test-only helpers, not part of SerialConnection's real interface.
    def feed(self, chunk: bytes) -> None:
        self._queue.put_nowait(chunk)

    def feed_error(self, exc: Exception) -> None:
        self._queue.put_nowait(exc)


class FakeSerialConnectionFactory:
    def __init__(self) -> None:
        self.instances: list[FakeSerialConnection] = []

    def __call__(self, port: str, baudrate: int = 115200) -> FakeSerialConnection:
        conn = FakeSerialConnection(port, baudrate)
        self.instances.append(conn)
        return conn


def _make_app(factory: FakeSerialConnectionFactory) -> web.Application:
    app = web.Application()
    app.router.add_get("/ws", make_websocket_handler(factory))
    return app


@pytest.mark.asyncio
async def test_list_ports_control_message() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "list_ports"})
        reply = await ws.receive_json()
        assert reply["type"] == "ports"
        assert isinstance(reply["ports"], list)
        await ws.close()


@pytest.mark.asyncio
async def test_connect_then_serial_to_ws_relay() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")

        await ws.send_json({"type": "connect", "port": "/dev/fake0", "baudrate": 115200})
        status = await ws.receive_json()
        assert status == {"type": "status", "connected": True, "port": "/dev/fake0"}
        assert factory.instances[-1].port == "/dev/fake0"

        # Feed one complete protocol frame, F64/base64-line-wrapped the way
        # the real device listener actually sends it, byte-at-a-time to
        # exercise the line reassembler, not just a single push().
        frame = encode_frame(3, bytes([9, 9, 9]))
        line = encode_f64_line(frame)
        conn = factory.instances[-1]
        for b in line:
            conn.feed(bytes([b]))

        msg = await ws.receive()
        assert msg.type.name == "BINARY"
        assert msg.data == frame  # decoded back to the inner frame, not the wire line

        await ws.close()


@pytest.mark.asyncio
async def test_serial_debug_line_relayed_as_debug_control_message() -> None:
    """A non-F64 line on the serial side is the device's own plain
    print()/debug output (listener.py's own header: LISTENER_READY,
    NODE_ERROR console echoes, etc.) -- it must still reach the browser,
    not be silently dropped, matching the direct WebSerial mode's
    onDebugLine behavior (transport.ts)."""
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()  # status: connected

        conn = factory.instances[-1]
        conn.feed(b"LISTENER_READY\r\n")

        msg = await ws.receive_json()
        assert msg == {"type": "debug", "line": "LISTENER_READY"}

        await ws.close()


@pytest.mark.asyncio
async def test_malformed_f64_line_reports_error_not_a_crash() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()  # status: connected

        conn = factory.instances[-1]
        conn.feed(b"F64:not-valid-base64!!!\n")

        status = await ws.receive_json()
        assert status["type"] == "status"
        assert "NODE_ERROR" in status["error"]

        # The session survives a garbled line -- a subsequent good frame
        # still relays correctly, same "one bad unit doesn't wedge the
        # whole socket" contract every other fault path here already has.
        frame = encode_frame(1, b"ok")
        conn.feed(encode_f64_line(frame))
        msg = await ws.receive()
        assert msg.type.name == "BINARY"
        assert msg.data == frame

        await ws.close()


@pytest.mark.asyncio
async def test_ws_binary_from_browser_is_written_to_serial_as_f64_line() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()  # status: connected

        already_framed = encode_frame(1, b"payload")
        await ws.send_bytes(already_framed)
        await asyncio.sleep(0.05)  # let the handler task process it

        # Written to the wire as one F64/base64 line, not the raw frame
        # bytes -- see line_framing.py's header for why the real device
        # listener needs this encoding rather than raw binary.
        assert factory.instances[-1].written == [encode_f64_line(already_framed)]
        await ws.close()


@pytest.mark.asyncio
async def test_disconnect_sends_status_and_closes_serial() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()

        await ws.send_json({"type": "disconnect"})
        status = await ws.receive_json()
        assert status == {"type": "status", "connected": False, "port": "/dev/fake0"}
        assert factory.instances[-1].closed is True
        await ws.close()


@pytest.mark.asyncio
async def test_serial_disconnect_mid_session_reports_structured_error_not_a_crash() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()

        conn = factory.instances[-1]
        conn.feed_error(SerialRelayError("/dev/fake0", "read", OSError("device disconnected")))

        status = await ws.receive_json()
        assert status["type"] == "status"
        assert "NODE_ERROR" in status["error"]
        assert "/dev/fake0" in status["error"]

        # The session should still be alive and respond to further control
        # messages -- one failed connection doesn't wedge the whole socket.
        await ws.send_json({"type": "list_ports"})
        reply = await ws.receive_json()
        assert reply["type"] == "ports"
        await ws.close()


@pytest.mark.asyncio
async def test_unknown_control_message_type_reports_error_not_a_crash() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "not-a-real-type"})
        status = await ws.receive_json()
        assert status["type"] == "status"
        assert "NODE_ERROR" in status["error"]
        await ws.close()


@pytest.mark.asyncio
async def test_malformed_json_control_message_reports_error_not_a_crash() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_str("not json{{{")
        status = await ws.receive_json()
        assert status["type"] == "status"
        assert "NODE_ERROR" in status["error"]
        await ws.close()


class FakeWebSocketAlreadyClosing:
    """Stands in for aiohttp.web.WebSocketResponse when the socket is already
    gone by the time a send is attempted -- e.g. cleanup()/_disconnect()
    reaching _send_status() after the browser tab has closed, or after a
    race with another connection to the same board. Real aiohttp raises
    ConnectionResetError from send_str() in that situation; this fake
    reproduces that deterministically without needing a live socket."""

    async def send_str(self, data: str) -> None:
        raise ConnectionResetError("Cannot write to closing transport")


@pytest.mark.asyncio
async def test_send_status_on_already_closing_ws_does_not_raise() -> None:
    # Real bug, found 2026-09-07 exercising this against an actual backend
    # process for the first time: a client-editor tab closing (or racing a
    # second connection to the same board) meant cleanup()/_disconnect()'s
    # own call to _send_status() landed on a WebSocket that was already
    # gone. That raised ClientConnectionResetError straight out of
    # cleanup() -- an uncaught exception in the request handler's `finally`
    # block, exactly what this module's header comment says never happens.
    # See ws_relay.py's _send_status() for the fix this guards.
    factory = FakeSerialConnectionFactory()
    session = ConnectionSession(FakeWebSocketAlreadyClosing(), factory)  # type: ignore[arg-type]

    # _connect() itself calls _send_status(connected=True, ...) right after
    # opening -- exercise that path too, not just the cleanup() one.
    await session._connect("/dev/fake0", 115200)
    assert factory.instances[-1].closed is False

    # cleanup() -> _disconnect() -> _send_status(connected=False, ...) --
    # this used to be the exact call that raised. Should not raise now.
    await session.cleanup()
    assert factory.instances[-1].closed is True
