# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/serial_relay.py
#
# Thin async wrapper around plain pyserial (docs/working-notes/backend-platform-decision.md
# §4: pyserial-asyncio is dead upstream, wrap blocking pyserial calls in
# asyncio.to_thread instead of taking on an async-serial dependency).
#
# Fault-handling requirements this follows, per §5 of that same note and this
# project's CLAUDE.md priority (fault handling over happy path) -- the
# backend's serial code gets the same symmetric treatment the device-side
# listener already got, not weaker treatment just because it's off-device:
#   - Every blocking read is time-bounded (pyserial's own `timeout=`), so a
#     read loop can always notice a stop request or a vanished port instead
#     of hanging indefinitely.
#   - A physical unplug (SerialException mid-read/write) is caught, wrapped
#     in a structured SerialRelayError naming the port, and surfaces to the
#     caller -- it never propagates as a bare, unattributed exception, and it
#     never wedges the relay or crashes the backend process.
#   - DTR/RTS handling on port open is exposed as explicit, optional
#     parameters rather than silently trusting pyserial's default Serial()
#     open behavior, which auto-resets some dev boards. What the *correct*
#     default is per target board is NOT decided here -- that's a real
#     hands-on check per board, flagged in the design note as something to
#     verify on hardware, not something to get right from documentation
#     alone. Defaults here deliberately leave pyserial's own behavior alone
#     (dtr=None/rts=None means "don't touch it") until that check happens.

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass

import serial
import serial.tools.list_ports

# Read timeout for the blocking pyserial read wrapped in asyncio.to_thread --
# bounds how long one to_thread() call can block, so the read loop always gets
# a chance to check its stop flag. Not a protocol timeout; purely a
# responsiveness bound on the executor thread.
_READ_POLL_TIMEOUT_SECONDS = 0.5
_READ_CHUNK_SIZE = 4096


class SerialRelayError(Exception):
    """A serial operation failed. Always names the port and the underlying cause --
    this project's NODE_ERROR convention (udp-send.ts/udp-receive.ts/http-request.ts/
    mqtt-shared.ts) applied to the backend's own serial layer."""

    def __init__(self, port: str, operation: str, cause: Exception) -> None:
        super().__init__(f"NODE_ERROR: serial {operation} failed on {port}: {cause}")
        self.port = port
        self.operation = operation
        self.cause = cause


@dataclass(frozen=True)
class SerialPortInfo:
    device: str
    description: str
    manufacturer: str | None
    vid: int | None
    pid: int | None
    serial_number: str | None


def list_ports() -> list[SerialPortInfo]:
    """Enumerate available serial ports. Does not fully disambiguate more than one
    compatible device on the same VID/PID -- per the design note, that needs its own
    device-picker UX, not a library-level fix."""
    return [
        SerialPortInfo(
            device=p.device,
            description=p.description or "",
            manufacturer=p.manufacturer,
            vid=p.vid,
            pid=p.pid,
            serial_number=p.serial_number,
        )
        for p in serial.tools.list_ports.comports()
    ]


class SerialConnection:
    """One open serial port, read/written from asyncio via a thread executor.

    Not safe to share across concurrent readers/writers -- this backend's
    scope (docs/thingstudio-design-doc.md §4/§10) is one backend, one device
    at a time, matching the rest of the project's current v1 scope.
    """

    def __init__(
        self,
        port: str,
        baudrate: int = 115200,
        dtr: bool | None = None,
        rts: bool | None = None,
    ) -> None:
        self.port = port
        self._baudrate = baudrate
        self._dtr = dtr
        self._rts = rts
        self._serial: serial.Serial | None = None
        self._stop_requested = False

    async def open(self) -> None:
        def _open() -> serial.Serial:
            # dsrdtr left at pyserial's default; dtr/rts only touched if the
            # caller explicitly asked -- see module docstring on why the
            # correct per-board default isn't decided here.
            ser = serial.Serial(self.port, baudrate=self._baudrate, timeout=_READ_POLL_TIMEOUT_SECONDS)
            if self._dtr is not None:
                ser.dtr = self._dtr
            if self._rts is not None:
                ser.rts = self._rts
            return ser

        try:
            self._serial = await asyncio.to_thread(_open)
        except (serial.SerialException, OSError) as exc:
            raise SerialRelayError(self.port, "open", exc) from exc

    async def write(self, data: bytes) -> None:
        if self._serial is None:
            raise SerialRelayError(self.port, "write", RuntimeError("port not open"))
        try:
            await asyncio.to_thread(self._serial.write, data)
        except (serial.SerialException, OSError) as exc:
            raise SerialRelayError(self.port, "write", exc) from exc

    async def read_loop(self) -> AsyncIterator[bytes]:
        """Yield raw byte chunks as they arrive until close()/request_stop() is
        called or the port errors out. Never raises past a clean SerialRelayError
        naming the failure -- the caller decides what a disconnect means for the
        rest of the session (e.g. a structured status message to the browser),
        this loop just stops."""
        if self._serial is None:
            raise SerialRelayError(self.port, "read", RuntimeError("port not open"))

        while not self._stop_requested:
            try:
                chunk = await asyncio.to_thread(self._serial.read, _READ_CHUNK_SIZE)
            except (serial.SerialException, OSError) as exc:
                raise SerialRelayError(self.port, "read", exc) from exc
            if chunk:
                yield chunk
            # An empty chunk just means the read timeout elapsed with nothing
            # available -- expected, not an error; loop back and check
            # _stop_requested again rather than treating it as EOF.

    def request_stop(self) -> None:
        """Ask read_loop() to return after its current poll interval."""
        self._stop_requested = True

    async def close(self) -> None:
        self.request_stop()
        if self._serial is not None:
            try:
                await asyncio.to_thread(self._serial.close)
            except (serial.SerialException, OSError) as exc:
                raise SerialRelayError(self.port, "close", exc) from exc
            finally:
                self._serial = None
