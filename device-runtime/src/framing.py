# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/framing.py
#
# §13's framing, device side -- the MicroPython mirror of
# editor/src/protocol/framing.ts. Same two byte-layout decisions that
# file's header comment calls out as not fixed by the design doc, and this
# file MUST match them exactly since framing.ts is the only source of
# truth right now (per messages.py's own header note):
#   - 2-byte length is big-endian.
#   - It counts the type byte plus CBOR body together (length = 1 + body),
#     so 0xffff (65535) is the hard ceiling on type+body combined.
#
# This module is deliberately unaware of message semantics -- same split
# as the JS side, and same reason: it only knows "length, type byte, opaque
# payload bytes."

try:
    import ustruct as struct
except ImportError:
    import struct  # CPython fallback for this module's off-device tests

from errors import FramingError

FRAME_LENGTH_HEADER_BYTES = 2
FRAME_TYPE_BYTES = 1
MAX_FRAME_PAYLOAD_LENGTH = 0xFFFF  # hard ceiling on (type byte + CBOR body) combined


def encode_frame(msg_type, payload):
    """Encode one complete frame: 2-byte big-endian length + 1-byte type +
    payload. `payload` must be bytes; `msg_type` an int 0-255."""
    if not isinstance(msg_type, int) or msg_type < 0 or msg_type > 0xFF:
        raise FramingError("message type byte out of range (must be 0-255): %r" % (msg_type,))
    frame_length = FRAME_TYPE_BYTES + len(payload)
    if frame_length > MAX_FRAME_PAYLOAD_LENGTH:
        raise FramingError(
            "frame too large: type+body is %d bytes, exceeds the 2-byte length header's %d-byte ceiling"
            % (frame_length, MAX_FRAME_PAYLOAD_LENGTH)
        )
    return struct.pack(">H", frame_length) + bytes([msg_type]) + bytes(payload)


class FrameDecoder:
    """Reassembles frames from an arbitrary stream of byte chunks -- mirrors
    framing.ts's FrameDecoder exactly, including its recovery behavior:
    push() never raises and never blocks (a truncated frame just leaves
    bytes buffered; a bad frame becomes an error entry in the returned
    list, not an exception), and an untrustworthy length header drops the
    whole buffer rather than guessing where the next frame starts (see
    framing.ts's own comment on why a length-prefixed protocol with no
    resync marker can't always do better than that)."""

    def __init__(self):
        self._buffer = b""

    def push(self, chunk):
        self._buffer += bytes(chunk)
        results = []

        while True:
            if len(self._buffer) < FRAME_LENGTH_HEADER_BYTES:
                break  # truncated: wait for more bytes

            (frame_length,) = struct.unpack(">H", self._buffer[0:FRAME_LENGTH_HEADER_BYTES])

            if frame_length < FRAME_TYPE_BYTES:
                results.append(
                    {
                        "error": FramingError(
                            "declared frame length %d is shorter than the 1-byte type field -- "
                            "length header is untrustworthy, dropping buffered bytes" % (frame_length,)
                        )
                    }
                )
                self.reset()
                break

            total_needed = FRAME_LENGTH_HEADER_BYTES + frame_length
            if len(self._buffer) < total_needed:
                break  # truncated: wait for more bytes

            msg_type = self._buffer[FRAME_LENGTH_HEADER_BYTES]
            payload = self._buffer[FRAME_LENGTH_HEADER_BYTES + FRAME_TYPE_BYTES : total_needed]
            results.append({"frame": {"type": msg_type, "payload": payload}})
            self._buffer = self._buffer[total_needed:]

        return results

    @property
    def pending_byte_count(self):
        return len(self._buffer)

    def reset(self):
        self._buffer = b""
