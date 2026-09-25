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
import serial
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.framing import encode_frame
from thingstudio_backend.line_framing import encode_f64_line
from thingstudio_backend.raw_repl import RawReplError
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


class FakeRawPort:
    """Stands in for a real serial.Serial opened for install_runtime -- RuntimeInstaller itself
    is faked out in these tests (FakeRuntimeInstaller below). Only board_recovery.catch_prompt
    reads and writes it: by default it answers like a board already at the ">>>" prompt;
    `reply=b""` makes it a board that never answers."""

    reply = b"\r\n>>> "

    def __init__(self, port: str, baudrate: int = 115200, timeout: float | None = None) -> None:
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.closed = False
        self.written: list[bytes] = []

    def write(self, data: bytes) -> int:
        self.written.append(data)
        return len(data)

    def read(self, size: int = 1) -> bytes:
        return type(self).reply

    def close(self) -> None:
        self.closed = True


class FakeRawPortFactory:
    """`open_effect`, if set, is raised instead of returning a port -- simulates the OS-level
    open failure serial.Serial itself would raise (permission denied, port busy, etc.)."""

    def __init__(self, open_effect: Exception | None = None) -> None:
        self.instances: list[FakeRawPort] = []
        self._open_effect = open_effect

    def __call__(
        self, port: str, baudrate: int = 115200, timeout: float | None = None, write_timeout: float | None = None
    ) -> FakeRawPort:
        if self._open_effect is not None:
            raise self._open_effect
        conn = FakeRawPort(port, baudrate, timeout)
        conn.write_timeout = write_timeout
        self.instances.append(conn)
        return conn


class FakeRuntimeInstaller:
    """Stands in for runtime_installer.RuntimeInstaller -- `install_effect`, if set, is raised
    instead of "succeeding," simulating a raw-REPL failure partway through a real install
    without needing raw_repl.py's own protocol logic (that's raw_repl.py's own test file's job,
    not this one's)."""

    def __init__(self, install_effect: Exception | None = None, progress: list[tuple[int, int, str]] | None = None) -> None:
        self.install_calls: list[object] = []
        self._install_effect = install_effect
        self._progress = progress or []

    def install(self, port: object, include_vendor: bool = True, timeouts: object = None, on_progress=None, compiled=None) -> None:
        self.install_calls.append(port)
        self.last_compiled = compiled
        for step in self._progress:
            if on_progress is not None:
                on_progress(*step)
        if self._install_effect is not None:
            raise self._install_effect


def _make_app(
    factory: FakeSerialConnectionFactory,
    raw_port_factory: FakeRawPortFactory | None = None,
    runtime_installer: FakeRuntimeInstaller | None = None,
) -> web.Application:
    app = web.Application()
    kwargs: dict[str, object] = {}
    if raw_port_factory is not None:
        kwargs["raw_port_factory"] = raw_port_factory
    if runtime_installer is not None:
        kwargs["runtime_installer"] = runtime_installer
    app.router.add_get("/ws", make_websocket_handler(factory, **kwargs))
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
        # Then a plain "no longer connected" (2026-09-24), so the editor shows the board as gone
        # rather than still connected to a dead link.
        gone = await ws.receive_json()
        assert gone == {"type": "status", "connected": False, "port": "/dev/fake0"}

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


@pytest.mark.asyncio
async def test_install_runtime_success() -> None:
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller()
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")

        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        reply = await ws.receive_json()

        assert reply == {"type": "install_runtime_result", "ok": True}
        assert raw_ports.instances[-1].port == "/dev/fake0"
        assert raw_ports.instances[-1].closed is True  # closed after install, success or not
        assert installer.install_calls == [raw_ports.instances[-1]]
        await ws.close()


@pytest.mark.asyncio
async def test_install_runtime_requires_a_port() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime"})
        reply = await ws.receive_json()
        assert reply["type"] == "install_runtime_result"
        assert reply["ok"] is False
        assert "no port given" in reply["error"]
        await ws.close()


@pytest.mark.asyncio
async def test_install_runtime_closes_an_existing_relay_connection_first() -> None:
    """Raw REPL needs exclusive access to the port -- an install_runtime request while already
    connected via the normal relay path must close that connection before opening its own."""
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller()
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")

        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        connect_status = await ws.receive_json()
        assert connect_status["connected"] is True
        relay_conn = factory.instances[-1]
        assert relay_conn.closed is False

        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        disconnect_status = await ws.receive_json()
        assert disconnect_status == {"type": "status", "connected": False, "port": "/dev/fake0"}
        assert relay_conn.closed is True

        install_result = await ws.receive_json()
        assert install_result == {"type": "install_runtime_result", "ok": True}
        await ws.close()


@pytest.mark.asyncio
async def test_install_runtime_reports_a_structured_error_on_open_failure() -> None:
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory(open_effect=serial.SerialException("[Errno 13] Permission denied"))
    installer = FakeRuntimeInstaller()
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        reply = await ws.receive_json()

        assert reply["ok"] is False
        # Same NODE_ERROR text shape serial_relay.py's own connect-failure errors use --
        # ws_relay.py's own header explains why that's deliberate.
        assert reply["error"].startswith("NODE_ERROR: serial open failed on /dev/fake0:")
        assert "Permission denied" in reply["error"]
        assert installer.install_calls == []  # never reached -- the port never opened


@pytest.mark.asyncio
async def test_install_runtime_reports_a_raw_repl_failure_verbatim() -> None:
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller(install_effect=RawReplError("pushing runtime.py (open)", "device raised: b'MemoryError'"))
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        reply = await ws.receive_json()

        assert reply["ok"] is False
        assert reply["error"] == str(installer._install_effect)
        assert "diagnosis" not in reply  # failed mid-push: says nothing about the board's firmware
        assert raw_ports.instances[-1].closed is True  # still closed even though install raised


@pytest.mark.asyncio
async def test_install_runtime_diagnoses_a_silent_board() -> None:
    """Real case, 2026-09-23: a blank ESP32-S2 with no MicroPython sent nothing back at all."""
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller(
        install_effect=RawReplError("entering raw REPL", "timed out waiting for ..., last seen: b''", seen=b"")
    )
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        reply = await ws.receive_json()

        assert reply["ok"] is False
        assert reply["diagnosis"] == "silent"


@pytest.mark.asyncio
async def test_install_runtime_opens_the_port_with_a_write_timeout() -> None:
    """pyserial blocks forever on write by default -- the real 2026-09-23 ESP32-S2 install hang."""
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    async with TestClient(TestServer(_make_app(factory, raw_ports, FakeRuntimeInstaller()))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        await ws.receive_json()
        assert raw_ports.instances[-1].write_timeout is not None
        assert raw_ports.instances[-1].write_timeout > 0


@pytest.mark.asyncio
async def test_install_runtime_relays_progress_before_the_result() -> None:
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller(progress=[(1, 2, "errors.py"), (2, 2, "main.py")])
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        msgs = [await ws.receive_json() for _ in range(3)]
        assert msgs[0] == {"type": "install_runtime_progress", "index": 1, "total": 2, "file": "errors.py"}
        assert msgs[1] == {"type": "install_runtime_progress", "index": 2, "total": 2, "file": "main.py"}
        assert msgs[2] == {"type": "install_runtime_result", "ok": True}


@pytest.mark.asyncio
async def test_raw_write_goes_to_the_serial_port_unframed() -> None:
    factory = FakeSerialConnectionFactory()
    async with TestClient(TestServer(_make_app(factory, FakeRawPortFactory(), FakeRuntimeInstaller()))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "connect", "port": "/dev/fake0"})
        await ws.receive_json()  # status connected
        await ws.send_json({"type": "raw_write", "text": "1+1\r"})
        for _ in range(20):
            if factory.instances[-1].written:
                break
            await asyncio.sleep(0.01)
        assert factory.instances[-1].written[-1] == b"1+1\r"


@pytest.mark.asyncio
async def test_remove_flow_without_a_port_is_a_clear_error() -> None:
    async with TestClient(TestServer(_make_app(FakeSerialConnectionFactory(), FakeRawPortFactory(), FakeRuntimeInstaller()))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "remove_flow"})
        reply = await ws.receive_json()
        assert reply == {"type": "remove_flow_result", "ok": False, "error": "NODE_ERROR: remove_flow requested with no port given"}


@pytest.mark.asyncio
async def test_install_runtime_stops_the_board_at_a_prompt_first() -> None:
    """2026-09-24, real Pico: a running listener ignores Ctrl-C and a native-USB board doesn't reset
    when the port opens, so install now waits for a prompt (board_recovery.catch_prompt) first."""
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller()
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        reply = await ws.receive_json()
        assert reply == {"type": "install_runtime_result", "ok": True}
        assert raw_ports.instances[0].written[0] == b"\x03"
        assert installer.install_calls == [raw_ports.instances[0]]


@pytest.mark.asyncio
async def test_install_runtime_says_what_to_do_when_the_board_never_stops(monkeypatch) -> None:
    from thingstudio_backend import ws_relay

    monkeypatch.setattr(ws_relay, "_INSTALL_CATCH_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(FakeRawPort, "reply", b"")
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = FakeRuntimeInstaller()
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        status = await ws.receive_json()
        assert status["type"] == "install_runtime_status"
        assert "unplug it and plug it back in" in status["text"]
        reply = await ws.receive_json()
        assert reply["ok"] is False
        assert "never stopped at a prompt" in reply["error"]
        assert reply["diagnosis"] == "silent"
        assert installer.install_calls == []
        assert all(p.closed for p in raw_ports.instances)


class SlowRuntimeInstaller(FakeRuntimeInstaller):
    """Blocks in install() until released, like a real install waiting for a board to reset."""

    def __init__(self) -> None:
        super().__init__()
        import threading

        self.started = threading.Event()
        self.release = threading.Event()

    def install(self, port: object, include_vendor: bool = True, timeouts: object = None, on_progress=None, compiled=None) -> None:
        self.install_calls.append(port)
        self.last_compiled = compiled
        self.started.set()
        self.release.wait(5)


@pytest.mark.asyncio
async def test_second_install_on_a_busy_port_is_refused_not_run() -> None:
    """2026-09-24, real Pico: repeated clicks on "Install runtime…" while the first install waited
    for a reset each started another install on the same port; they fought over it and all failed.
    A second install (or Remove flow, or a connect) on a busy port is refused straight away, and
    the port is free again once the first finishes."""
    factory = FakeSerialConnectionFactory()
    raw_ports = FakeRawPortFactory()
    installer = SlowRuntimeInstaller()
    async with TestClient(TestServer(_make_app(factory, raw_ports, installer))) as client:
        first = await client.ws_connect("/ws")
        second = await client.ws_connect("/ws")
        await first.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        assert await asyncio.to_thread(installer.started.wait, 5)

        await second.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        refused = await second.receive_json()
        assert refused["ok"] is False and "already running on /dev/fake0" in refused["error"]
        await second.send_json({"type": "remove_flow", "port": "/dev/fake0"})
        refused = await second.receive_json()
        assert refused["type"] == "remove_flow_result" and refused["ok"] is False
        await second.send_json({"type": "connect", "port": "/dev/fake0"})
        refused = await second.receive_json()
        assert "busy" in refused["error"]
        assert len(installer.install_calls) == 1

        installer.release.set()
        assert await first.receive_json() == {"type": "install_runtime_result", "ok": True}
        # Free again: a new install runs.
        installer.release.clear()
        installer.started.clear()
        await second.send_json({"type": "install_runtime", "port": "/dev/fake0"})
        assert await asyncio.to_thread(installer.started.wait, 5)
        installer.release.set()
        assert await second.receive_json() == {"type": "install_runtime_result", "ok": True}
        await first.close()
        await second.close()
