# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/line_framing.py
#
# The real on-the-wire encoding between this backend and the actual serial
# port -- added 2026-09-07 (editor-backend-wiring session) to fix a real
# bug in ws_relay.py's original design: it fed raw pyserial byte chunks
# directly into framing.py's FrameDecoder, which assumes §13's binary frame
# layout (2-byte length header + type + CBOR body) rides the serial wire
# unmodified. It doesn't. The actual device-side listener
# (device-runtime/src/listener.py, "Why base64-over-readline() again, not
# raw binary reads" in its own header) only ever speaks base64-encoded,
# "F64:"-prefixed text lines there -- a deliberate workaround for a real
# hardware bug (POC-D: reading a specific byte count from sys.stdin hung
# the device's event loop outright; readline() was reliable throughout).
# editor/src/protocol/transport.ts's WebSerialTransport already does this
# exact same encoding for the browser-direct path; this module is the
# backend-side equivalent, so the *serial* wire looks identical regardless
# of which connection mode reaches it. See docs/working-notes/learnings/
# backend-serial-wire-format.md for the full incident.
#
# Framing boundaries come for free from the line structure itself here --
# unlike framing.py's FrameDecoder, which has to reconstruct frame
# boundaries from an undifferentiated byte stream because raw binary has
# no boundaries of its own, one complete "F64:"-prefixed line IS one
# complete §13 frame (base64-decoded), no separate length-header parsing
# needed on top. framing.py itself is untouched by this fix -- it's still
# correct as a transport-agnostic §13 frame codec (encode_frame is still
# used by callers that build frames directly, e.g. tests), it just isn't
# what should sit directly on the raw serial byte stream.
#
# A non-"F64:" line is the device's own human-readable print()/debug
# output (LISTENER_READY, NODE_ERROR console echoes, etc.) -- surfaced as
# its own event type here, not dropped, matching listener.py's own stated
# reasoning for keeping a plain serial monitor useful, and matching
# transport.ts's onDebugLine on the browser-direct side.

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

F64_PREFIX = "F64:"
NEWLINE = 0x0A
CARRIAGE_RETURN = 0x0D


class LineFramingError(Exception):
    """A line claimed to be F64-encoded but didn't base64-decode cleanly --
    adversarial/corrupted input from the device side (or a garbled serial
    read), not a reason to crash the relay. See LineDecoder.push()."""


@dataclass(frozen=True)
class LineEvent:
    """Exactly one of `frame` or `debug_text` is set, matching the two
    kinds of line this wire format carries. `error`, when set, means this
    line claimed to be F64-encoded but failed to decode -- `frame` and
    `debug_text` are both None in that case."""

    frame: bytes | None = None
    debug_text: str | None = None
    error: LineFramingError | None = None


def encode_f64_line(frame: bytes) -> bytes:
    """Wrap one already-encoded §13 frame (framing.py's `encode_frame`
    output, or -- on this backend's relay path -- a frame built entirely
    client-side and forwarded verbatim) as one base64/F64-prefixed text
    line, ready to write to the serial port. Mirrors transport.ts's send()
    exactly (same prefix, same base64 alphabet, same trailing newline)."""
    return F64_PREFIX.encode("ascii") + base64.b64encode(frame) + b"\n"


class LineDecoder:
    """Reassembles '\\n'-delimited lines from an arbitrary stream of byte
    chunks off the serial port, classifying each complete line as an F64
    frame, a plain debug line, or a decode error. Mirrors transport.ts's
    #feed()/#handleLine() (accumulate, split on newline, strip a trailing
    '\\r', decode or pass through) -- same shape as framing.py's own
    FrameDecoder (accumulate, extract complete units, leave a partial one
    buffered), just operating on lines instead of length-prefixed frames.
    push() never raises and never blocks: a partial line just stays
    buffered until more bytes arrive, and a bad base64 payload becomes an
    error result (that one line is dropped; the buffer is NOT reset --
    unlike framing.py's FrameDecoder, a bad line doesn't desynchronize the
    next one, since line boundaries came from '\\n', not from a length
    header this line's own corruption could have lied about)."""

    def __init__(self) -> None:
        self._buffer = b""

    def push(self, chunk: bytes) -> list[LineEvent]:
        self._buffer += chunk
        events: list[LineEvent] = []

        while True:
            newline_index = self._buffer.find(b"\n")
            if newline_index == -1:
                break  # no complete line yet -- wait for more bytes
            line = self._buffer[:newline_index]
            self._buffer = self._buffer[newline_index + 1 :]
            if line.endswith(b"\r"):
                line = line[:-1]
            events.append(self._decode_line(line))

        return events

    def _decode_line(self, line: bytes) -> LineEvent:
        if not line.startswith(F64_PREFIX.encode("ascii")):
            # Not every device print() line is valid UTF-8 in principle,
            # but MicroPython's own print() only ever emits text -- decoded
            # leniently (never fatal) rather than assumed to always succeed,
            # matching transport.ts's TextDecoder(..., {fatal: false}).
            text = line.decode("utf-8", errors="replace")
            return LineEvent(debug_text=text)
        try:
            frame = base64.b64decode(line[len(F64_PREFIX) :], validate=True)
        except (binascii.Error, ValueError) as exc:
            return LineEvent(error=LineFramingError(f"malformed base64 in F64 line, dropped: {exc}"))
        return LineEvent(frame=frame)

    @property
    def pending_byte_count(self) -> int:
        """Bytes buffered but not yet part of a complete line. Diagnostic/test use."""
        return len(self._buffer)

    def reset(self) -> None:
        """Drop any buffered, not-yet-complete bytes -- same role as
        framing.py's FrameDecoder.reset(), called on a fresh connect so a
        previous session's partial line never bleeds into a new one."""
        self._buffer = b""
