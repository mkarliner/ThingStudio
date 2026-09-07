# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/framing.py
#
# Python port of editor/src/protocol/framing.ts's FrameDecoder, kept
# behaviorally identical on purpose: the backend needs this for exactly
# one reason -- pyserial gives it a raw, boundary-less byte stream off
# the wire, but the WebSocket side needs discrete messages (one relayed
# WS binary frame per protocol frame), so something has to reconstruct
# §13's frame boundaries from the stream. The backend does NOT decode
# CBOR (codec.ts's job, staying client-side) -- it only reads the 2-byte
# length header far enough to know where one frame ends and the next
# begins, then forwards the *raw* bytes for that frame verbatim. See
# docs/working-notes/backend-editor-auth-and-protocol.md §2.
#
# Byte layout (must match framing.ts exactly -- both sides of one wire
# protocol): 2-byte big-endian length header, counting the 1-byte type
# field plus the CBOR body together (not itself), followed by the type
# byte and the payload.

from __future__ import annotations

from dataclasses import dataclass

FRAME_LENGTH_HEADER_BYTES = 2
FRAME_TYPE_BYTES = 1
# Hard ceiling on (type byte + CBOR body) combined -- whatever fits in the 2-byte length header.
MAX_FRAME_PAYLOAD_LENGTH = 0xFFFF


class FramingError(Exception):
    """A length header that can't be trusted -- see FrameDecoder.push()."""


@dataclass(frozen=True)
class DecodedFrame:
    type: int
    payload: bytes
    # The exact bytes this frame was decoded from (length header + type + payload),
    # kept so the relay can forward a frame verbatim without re-encoding it.
    raw: bytes


@dataclass(frozen=True)
class FrameResult:
    frame: DecodedFrame | None = None
    error: FramingError | None = None


def encode_frame(type_: int, payload: bytes) -> bytes:
    """Encode one complete frame: 2-byte big-endian length + 1-byte type + payload.

    Used by the control-plane side of this backend (nothing in the relay path calls
    this -- relayed frames are forwarded via DecodedFrame.raw, not re-encoded).
    """
    if not (0 <= type_ <= 0xFF):
        raise FramingError(f"message type byte out of range (must be 0-255): {type_}")

    frame_length = FRAME_TYPE_BYTES + len(payload)
    if frame_length > MAX_FRAME_PAYLOAD_LENGTH:
        raise FramingError(
            f"frame too large: type+body is {frame_length} bytes, exceeds the 2-byte "
            f"length header's {MAX_FRAME_PAYLOAD_LENGTH}-byte ceiling"
        )

    return frame_length.to_bytes(FRAME_LENGTH_HEADER_BYTES, "big") + bytes([type_]) + payload


class FrameDecoder:
    """Reassembles frames from an arbitrary stream of byte chunks.

    Mirrors framing.ts's FrameDecoder: handles one frame split across multiple
    push() calls and multiple frames arriving in a single push() call. push()
    never raises and never blocks -- a truncated frame just leaves bytes
    buffered until more arrive, and a bad length header becomes an error
    result (and drops the buffer, since there's no resync marker to recover
    a corrupted length header) rather than an exception.
    """

    def __init__(self) -> None:
        self._buffer = b""

    def push(self, chunk: bytes) -> list[FrameResult]:
        self._buffer += chunk
        results: list[FrameResult] = []

        while True:
            if len(self._buffer) < FRAME_LENGTH_HEADER_BYTES:
                break  # truncated: wait for more bytes

            frame_length = int.from_bytes(self._buffer[:FRAME_LENGTH_HEADER_BYTES], "big")

            if frame_length < FRAME_TYPE_BYTES:
                results.append(
                    FrameResult(
                        error=FramingError(
                            f"declared frame length {frame_length} is shorter than the 1-byte "
                            "type field -- length header is untrustworthy, dropping buffered bytes"
                        )
                    )
                )
                self.reset()
                break

            total_needed = FRAME_LENGTH_HEADER_BYTES + frame_length
            if len(self._buffer) < total_needed:
                break  # truncated: wait for more bytes

            type_ = self._buffer[FRAME_LENGTH_HEADER_BYTES]
            payload = self._buffer[FRAME_LENGTH_HEADER_BYTES + FRAME_TYPE_BYTES : total_needed]
            raw = self._buffer[:total_needed]
            results.append(FrameResult(frame=DecodedFrame(type=type_, payload=payload, raw=raw)))
            self._buffer = self._buffer[total_needed:]

        return results

    @property
    def pending_byte_count(self) -> int:
        """Bytes buffered but not yet part of a complete frame. Diagnostic/test use."""
        return len(self._buffer)

    def reset(self) -> None:
        """Drop any buffered, not-yet-complete bytes.

        Exposed for a caller to invoke after its own time-bound (e.g. "no complete
        frame in N ms") -- same "every blocking read must be time-bounded" principle
        the device-side listener follows (design doc §5), just caller-driven here
        since this class has no clock of its own.
        """
        self._buffer = b""
