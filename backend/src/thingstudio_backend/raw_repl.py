# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/raw_repl.py
#
# MicroPython "raw REPL" client -- the same host-side primitive `mpremote`/`pyboard.py` use to
# push files onto a board's filesystem independent of whatever's currently running there. This
# is the mechanism outstanding-items/deploy-runtime-from-editor.md's 2026-09-22 scoping settled
# on for MVP item 1 (runtime install from the editor): a bare board with only stock MicroPython
# has no listener.py running at all, so there's nothing to send a framed §13 message to -- only
# a raw-REPL bootstrap, independent of the listener protocol, can do an *initial* install.
#
# Deliberately synchronous, no asyncio anywhere in this file -- the caller (runtime_installer.py)
# wraps a whole install_runtime() call in one asyncio.to_thread(), the same "sync core, async
# wrapped at the edge" shape serial_relay.py already uses for plain reads/writes. This module
# doesn't open or own a serial port either -- it operates on anything satisfying _SerialPort
# (a real serial.Serial passed in by the caller), so it has zero pyserial import of its own and
# is fully unit-testable against a fake, same dependency-injection shape
# test_serial_relay.py's _FakeSerial already established for SerialConnection.
#
# Protocol summary (MicroPython's documented raw-REPL mode; tools/pyboard.py in the upstream
# micropython repo is the reference implementation this follows):
#   Ctrl-C (0x03) -- interrupt whatever's running (e.g. a normal REPL's already-running flow)
#   Ctrl-A (0x01) -- enter raw REPL; device replies "raw REPL; CTRL-B to exit\r\n>"
#   <code bytes> + Ctrl-D (0x04) -- execute the pasted code; device replies "OK", then stdout,
#     then one 0x04, then stderr, then a second 0x04
#   Ctrl-B (0x02) -- exit raw REPL back to the friendly ">>> " prompt
#
# Fault handling per CLAUDE.md's project-wide priority (fault handling over happy path): every
# read is time-bounded (no indefinite block on a wedged/silent board -- same
# _READ_POLL_TIMEOUT_SECONDS-style reasoning serial_relay.py already uses, just at the protocol
# layer instead of the byte layer), and any protocol deviation (a missing/garbled echo,
# non-empty stderr, a timeout) raises a structured RawReplError naming the step and what was
# actually seen -- this backend's existing NODE_ERROR-style attribution convention
# (SerialRelayError), extended to this module rather than reinvented.
#
# NOT yet verified against real hardware -- built and unit-tested against a fake port only
# (2026-09-22, no board available this session). Treat as unverified until a real-hardware pass
# confirms it; see runtime_installer.py's own header and
# outstanding-items/deploy-runtime-from-editor.md for the tracking note.

from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from typing import Protocol

_CTRL_A = b"\x01"
_CTRL_B = b"\x02"
_CTRL_C = b"\x03"
_CTRL_D = b"\x04"

_RAW_REPL_BANNER = b"raw REPL; CTRL-B to exit\r\n>"
_OK = b"OK"

# Per-read poll size -- mirrors serial_relay.py's own _READ_CHUNK_SIZE, not a protocol-level
# limit on its own.
_POLL_CHUNK_SIZE = 256

# Base64-encoded in ~342-byte chunks (256 raw bytes -> ~342 base64 chars) per raw-REPL exec,
# rather than one exec pasting a whole file -- classic raw REPL has no length limit on a single
# paste in principle, but the device has to hold the *entire* incoming code text as Python
# source before it can even start executing it, so a large file (mqtt_as.py is ~36KB, per
# runtime_manifest.py's own VENDOR_FILES comment) risks the same kind of allocation pressure
# this project has already hit elsewhere on real hardware
# (learnings/hardware-bringup-hil-rig.md's MemoryError entries) -- chunking means never holding
# more than one small chunk's source text plus its decoded bytes at once. Same approach
# ampy/rshell use, for the same reason.
_DEFAULT_CHUNK_SIZE = 256


class RawReplError(Exception):
    """A raw-REPL operation failed -- always names the step and what was actually seen (or the
    absence of what was expected). This backend's existing NODE_ERROR-style attribution
    convention (serial_relay.py's SerialRelayError), not a bare/unattributed exception."""

    def __init__(self, step: str, detail: str) -> None:
        super().__init__(f"NODE_ERROR: runtime install failed at {step}: {detail}")
        self.step = step
        self.detail = detail


class _SerialPort(Protocol):
    """Narrow duck-typed surface this module actually calls -- a real serial.Serial satisfies
    it directly (its write()/read() signatures are a superset of this); tests substitute a fake
    with no hardware or even pyserial dependency."""

    def write(self, data: bytes) -> int | None: ...
    def read(self, size: int = 1) -> bytes: ...


@dataclass(frozen=True)
class RawReplTimeouts:
    """All in seconds. Separate knobs, not one blanket timeout -- entering raw REPL can mean
    waiting out a running flow's own event loop reacting to Ctrl-C, a different real-world bound
    than one exec's own run time (e.g. a big file write's many small execs)."""

    enter: float = 5.0
    exec_default: float = 5.0


class _ByteReader:
    """Wraps a port with a persistent internal buffer across successive read_until() calls.

    Found necessary by a real test failure (2026-09-22, no hardware needed to hit it): a single
    underlying port.read() can return a marker *and* whatever the device already sent after it
    in the same physical chunk (a fast device can have "OK" and its output ready before the
    host even issues its next read call) -- pyserial gives no guarantee of one read() per
    logical unit. A version of this that started from an empty buffer on every call (the
    original shape) would find the marker fine but then silently discard everything already
    read past it, permanently losing bytes read_until()'s *next* call needed. This class reads
    the underlying port strictly at or past that boundary; one instance's buffer is meant to
    live for exactly one exec_raw()/enter_raw_repl() call, not longer -- see those functions."""

    def __init__(self, port: _SerialPort) -> None:
        self._port = port
        self._buf = b""

    def read_until(self, marker: bytes, deadline: float, step: str) -> bytes:
        """Returns everything read so far, up to and including the first occurrence of
        `marker` -- never more than that; any bytes read past it stay buffered for this
        reader's next call. Raises RawReplError naming `step` and whatever's been seen so far
        (tail-truncated to stay readable) if `deadline` (an absolute time.monotonic() value)
        passes first -- never blocks forever, per this project's fault-handling priority."""
        while True:
            idx = self._buf.find(marker)
            if idx != -1:
                end = idx + len(marker)
                result, self._buf = self._buf[:end], self._buf[end:]
                return result
            if time.monotonic() > deadline:
                seen = self._buf[-200:] if len(self._buf) > 200 else self._buf
                raise RawReplError(step, f"timed out waiting for {marker!r}, last seen: {seen!r}")
            chunk = self._port.read(_POLL_CHUNK_SIZE)
            if chunk:
                self._buf += chunk


def enter_raw_repl(port: _SerialPort, timeouts: RawReplTimeouts = RawReplTimeouts()) -> None:
    """Interrupts whatever's running and switches the board into raw REPL. Safe to call on a
    board already in raw REPL (Ctrl-A is a no-op there) or already sitting at a bare '>>> '
    prompt."""
    port.write(_CTRL_C)
    port.write(_CTRL_C)  # pyboard.py's own belt-and-braces second interrupt, for a board that
    # swallowed the first one mid a multi-byte read -- cheap, harmless if the first landed.
    port.write(_CTRL_A)
    _ByteReader(port).read_until(_RAW_REPL_BANNER, time.monotonic() + timeouts.enter, "entering raw REPL")


def exit_raw_repl(port: _SerialPort) -> None:
    """Leaves raw REPL, back to the friendly '>>> ' prompt. Fire-and-forget -- not meaningful to
    call after hard_reset() (the other end is already gone/rebooting by then); this exists for a
    future caller that wants to leave the board sitting in a normal REPL without resetting it."""
    port.write(_CTRL_B)


def exec_raw(port: _SerialPort, code: bytes, step: str, timeout: float = 5.0) -> bytes:
    """Pastes `code` into an already-entered raw REPL and executes it (Ctrl-D). Returns stdout.
    Raises RawReplError (naming `step`) if the device doesn't echo exactly "OK" with nothing
    before it, or if execution produced anything on stderr -- MicroPython's raw-REPL wire
    contract puts a traceback there on a real Python-level error, and this project's fault-
    handling priority treats that as a real failure to surface, not something to swallow and
    push past. One _ByteReader per call, deliberately not shared across exec_raw() calls: the
    device can't reply to a command that hasn't been sent yet, so there's never legitimate
    leftover data to carry from one exec into the next."""
    port.write(code)
    port.write(_CTRL_D)
    deadline = time.monotonic() + timeout
    reader = _ByteReader(port)
    echoed = reader.read_until(_OK, deadline, f"{step} (waiting for OK echo)")
    if echoed != _OK:
        # A properly-behaved device's very first bytes back are "OK", nothing before it --
        # read_until() returning more than just the marker means something else arrived first.
        raise RawReplError(step, f"unexpected bytes before OK echo: {echoed!r}")
    stdout = reader.read_until(_CTRL_D, deadline, f"{step} (reading stdout)")[: -len(_CTRL_D)]
    stderr = reader.read_until(_CTRL_D, deadline, f"{step} (reading stderr)")[: -len(_CTRL_D)]
    if stderr:
        raise RawReplError(step, f"device raised: {stderr!r}")
    return stdout


def write_file_chunked(port: _SerialPort, dest_name: str, data: bytes, step: str, chunk_size: int = _DEFAULT_CHUNK_SIZE) -> None:
    """Writes `data` to `dest_name` on the device's filesystem, base64-chunked through repeated
    small raw-REPL execs -- see this module's header for why chunking, not one big paste."""
    exec_raw(port, f"f=open({dest_name!r},'wb')".encode(), f"{step} (open)")
    for i in range(0, len(data), chunk_size):
        chunk_b64 = base64.b64encode(data[i : i + chunk_size])
        code = f"import ubinascii\nf.write(ubinascii.a2b_base64({chunk_b64!r}))".encode()
        exec_raw(port, code, f"{step} (chunk {i // chunk_size + 1} of {(len(data) - 1) // chunk_size + 1})")
    exec_raw(port, b"f.close()", f"{step} (close)")


def hard_reset(port: _SerialPort) -> None:
    """machine.reset() -- a real chip reset, same reasoning outstanding-items/reset-before-
    deploy.md already gives for why this (not Ctrl-D's soft-reboot shortcut) is what actually
    gets a clean device state, and what's needed here to make the newly-written main.py boot
    into. Executed as a normal raw-REPL exec (the caller is expected to already be in raw REPL
    at this point, install_runtime()'s own last step) rather than the friendly-REPL Ctrl-D
    shortcut, so it behaves the same regardless of prior state.
    Deliberately doesn't wait for a reply: the reset tears down the serial connection's other
    end immediately, so there's nothing to read back. The caller is expected to close this port
    right after calling this, not keep reading from it -- see runtime_installer.py."""
    port.write(b"import machine\nmachine.reset()")
    port.write(_CTRL_D)


def install_runtime(port: _SerialPort, files: list[tuple[str, bytes]], timeouts: RawReplTimeouts = RawReplTimeouts()) -> None:
    """Pushes `files` (a caller-supplied, already-ordered [(dest_filename, contents), ...] list
    -- this module has no opinion on where those bytes come from or what belongs in the list,
    see runtime_installer.py for that) onto `port`'s board via raw REPL, then hard-resets it.
    The browser-triggered equivalent of test-flows/deploy_runtime.py's own manual mpremote
    sequence. Raises RawReplError (from whichever step failed) on any problem -- no partial-
    success return value, since a partially-written runtime is not a state worth distinguishing
    from a total failure; the caller's own retry is "run this again from the top"."""
    enter_raw_repl(port, timeouts)
    for dest_name, data in files:
        write_file_chunked(port, dest_name, data, f"pushing {dest_name}")
    hard_reset(port)
