# SPDX-License-Identifier: Apache-2.0
# backend/test/test_serial_relay.py
#
# Unit tests for SerialConnection against a fake pyserial.Serial -- no real
# hardware needed for this layer's own logic (constructor wiring, fault
# attribution). Real pyserial/device behavior (actual write-stall timing,
# DTR/RTS quirks) still needs a real-hardware pass, same caveat as
# test_ws_relay.py's fake-serial tests one layer up.
#
# Added 2026-09-08 alongside the write_timeout fix: open() previously left
# pyserial's write_timeout at its default (None -- block forever), so a
# wedged device could hang the executor thread on write() indefinitely.
# These tests confirm the fix (write_timeout is actually passed to
# serial.Serial()) and that a write-timeout surfaces as the same structured
# SerialRelayError every other serial fault already produces, not a hang or
# a bare exception.

from __future__ import annotations

import asyncio

import pytest
import serial

from thingstudio_backend import serial_relay
from thingstudio_backend.serial_relay import SerialConnection, SerialRelayError


class _FakeSerial:
    """Stands in for a pyserial serial.Serial instance -- records the
    constructor args SerialConnection.open() passed in, and lets a test
    script a write()/read()/close() failure via _write_effect/_read_queue."""

    def __init__(self, port: str, baudrate: int = 115200, timeout=None, write_timeout=None) -> None:
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.write_timeout = write_timeout
        self.dtr: bool | None = None
        self.rts: bool | None = None
        self.written: list[bytes] = []
        self.closed = False
        self._write_effect: Exception | None = None
        self._read_queue: list[bytes] = []
        self._read_effect: Exception | None = None
        self._close_effect: Exception | None = None

    def write(self, data: bytes) -> None:
        if self._write_effect is not None:
            raise self._write_effect
        self.written.append(data)

    def read(self, size: int) -> bytes:
        if self._read_effect is not None:
            raise self._read_effect
        if self._read_queue:
            return self._read_queue.pop(0)
        return b""

    def close(self) -> None:
        if self._close_effect is not None:
            raise self._close_effect
        self.closed = True


class _FakeSerialFactory:
    """Swapped in for serial.Serial itself (monkeypatched onto the
    serial_relay module's `serial` import) so SerialConnection.open() gets a
    _FakeSerial back instead of touching real hardware."""

    def __init__(self) -> None:
        self.instances: list[_FakeSerial] = []

    def __call__(self, port: str, baudrate: int = 115200, timeout=None, write_timeout=None) -> _FakeSerial:
        fake = _FakeSerial(port, baudrate=baudrate, timeout=timeout, write_timeout=write_timeout)
        self.instances.append(fake)
        return fake


async def _open_fake(monkeypatch, port: str = "COM_FAKE") -> tuple[SerialConnection, _FakeSerial]:
    factory = _FakeSerialFactory()
    monkeypatch.setattr(serial_relay.serial, "Serial", factory)
    conn = SerialConnection(port)
    await conn.open()
    return conn, factory.instances[0]


@pytest.mark.asyncio
async def test_open_passes_read_and_write_timeouts_to_pyserial(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    assert fake.timeout == serial_relay._READ_POLL_TIMEOUT_SECONDS
    assert fake.write_timeout == serial_relay._WRITE_TIMEOUT_SECONDS
    assert fake.write_timeout is not None, "write_timeout must not be left at pyserial's block-forever default"


@pytest.mark.asyncio
async def test_open_wraps_serial_exception(monkeypatch) -> None:
    def _raise(*args, **kwargs):
        raise serial.SerialException("port busy")

    monkeypatch.setattr(serial_relay.serial, "Serial", _raise)
    conn = SerialConnection("COM_FAKE")
    with pytest.raises(SerialRelayError) as exc_info:
        await conn.open()
    assert exc_info.value.port == "COM_FAKE"
    assert exc_info.value.operation == "open"


@pytest.mark.asyncio
async def test_write_success_reaches_fake_serial(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    await conn.write(b"hello")
    assert fake.written == [b"hello"]


@pytest.mark.asyncio
async def test_write_timeout_raises_serial_relay_error_not_a_hang(monkeypatch) -> None:
    """The actual gap this session's fix closes: a write that would otherwise
    block the executor thread forever now raises pyserial's own
    SerialTimeoutException, which write() must turn into the same structured
    SerialRelayError every other serial fault produces."""
    conn, fake = await _open_fake(monkeypatch)
    fake._write_effect = serial.SerialTimeoutException("Write timeout")

    with pytest.raises(SerialRelayError) as exc_info:
        await asyncio.wait_for(conn.write(b"stuck"), timeout=2.0)

    err = exc_info.value
    assert err.port == "COM_FAKE"
    assert err.operation == "write"
    assert isinstance(err.cause, serial.SerialTimeoutException)
    assert "NODE_ERROR" in str(err)


@pytest.mark.asyncio
async def test_write_generic_serial_exception_still_wrapped(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    fake._write_effect = serial.SerialException("device vanished")

    with pytest.raises(SerialRelayError) as exc_info:
        await conn.write(b"data")

    assert exc_info.value.operation == "write"
    assert isinstance(exc_info.value.cause, serial.SerialException)


@pytest.mark.asyncio
async def test_write_before_open_raises_serial_relay_error() -> None:
    conn = SerialConnection("COM_FAKE")
    with pytest.raises(SerialRelayError) as exc_info:
        await conn.write(b"data")
    assert exc_info.value.operation == "write"


@pytest.mark.asyncio
async def test_read_loop_yields_chunks_then_stops_on_request(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    fake._read_queue = [b"abc", b"", b"def"]

    chunks: list[bytes] = []
    it = conn.read_loop()
    async for chunk in it:
        chunks.append(chunk)
        if len(chunks) == 2:
            conn.request_stop()
            break

    assert chunks == [b"abc", b"def"]


@pytest.mark.asyncio
async def test_read_loop_wraps_disconnect_as_serial_relay_error(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    fake._read_effect = serial.SerialException("unplugged")

    with pytest.raises(SerialRelayError) as exc_info:
        async for _ in conn.read_loop():
            pass

    assert exc_info.value.operation == "read"
    assert isinstance(exc_info.value.cause, serial.SerialException)


@pytest.mark.asyncio
async def test_close_success(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    await conn.close()
    assert fake.closed is True


@pytest.mark.asyncio
async def test_close_wraps_serial_exception(monkeypatch) -> None:
    conn, fake = await _open_fake(monkeypatch)
    fake._close_effect = serial.SerialException("already gone")

    with pytest.raises(SerialRelayError) as exc_info:
        await conn.close()

    assert exc_info.value.operation == "close"
