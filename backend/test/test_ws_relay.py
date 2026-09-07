# SPDX-License-Identifier: Apache-2.0
# backend/test/test_ws_relay.py
#
# Exercises the WS relay end-to-end (control-plane JSON + binary relay) against
# a fake serial connection -- no real hardware needed for this layer's own
# logic (framing/multiplexing/fault handling). Real pyserial behavior
# (DTR/RTS quirks, actual disconnect timing) still needs a real-hardware pass
# per docs/working-notes/backend-platform-decision.md §5 -- not claimed here.

import asyncio
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.framing import encode_frame
from thingstudio_backend.serial_relay import SerialRelayError
from thingstudio_backend.ws_relay import make_websocket_handler


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

        # Feed one complete protocol frame on the "serial" side, byte-at-a-time
        # to exercise the reassembler, not just a single push().
        frame = encode_frame(3, bytes([9, 9, 9]))
        conn = factory.instances[-1]
        for b in frame:
            conn.feed(bytes([b]))

        msg = await ws.receive()
        assert msg.type.name == "BINARY"
        assert msg.data == frame  # forwarded verbatim, not re-encoded

        await ws.close()


@pytest.mark.asyncio
async def test_ws_binary_from_browser_is_written_to_serial_verbatim() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()  # status: connected

        already_framed = encode_frame(1, b"payload")
        await ws.send_bytes(already_framed)
        await asyncio.sleep(0.05)  # let the handler task process it

        assert factory.instances[-1].written == [already_framed]
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
