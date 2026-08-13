# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/protocol.py
#
# Ties framing.py and messages.py together -- the MicroPython mirror of
# editor/src/protocol/protocol.ts. Same shape: push in raw bytes, get back
# decoded messages or recoverable per-frame/per-message errors, never a
# raised exception for adversarial input (an unexpected, non-protocol
# error is deliberately NOT swallowed here either -- see push()'s
# docstring -- that's transport.py/listener.py's outer catch-all's job,
# same division of responsibility as the JS side's caller).

import framing
import messages
from errors import FramingError, MessageDecodeError


def encode_message(message):
    """Encode a typed message dict into one complete on-wire frame."""
    return framing.encode_frame(messages.message_type_id(message), messages.encode_message_body(message))


class ProtocolStreamDecoder:
    """Stateful stream decoder: feed it raw bytes as they arrive, get back
    zero or more results per call, in arrival order. Each result is either
    {"message": <dict>} or {"error": <FramingError | MessageDecodeError>}.
    A bad frame or a bad message body never raises out of push() and never
    stalls decoding of whatever comes after it."""

    def __init__(self):
        self._frames = framing.FrameDecoder()

    def push(self, chunk):
        results = []
        for entry in self._frames.push(chunk):
            if "error" in entry:
                results.append({"error": entry["error"]})
                continue
            frame = entry["frame"]
            try:
                msg = messages.decode_message_body(frame["type"], frame["payload"])
                results.append({"message": msg})
            except MessageDecodeError as e:
                results.append({"error": e})
            # Anything else (a real bug, not adversarial input) is
            # deliberately allowed to propagate out of push() here, same as
            # protocol.ts's ProtocolStreamDecoder -- the caller (listener.py)
            # still has its own outer try/except so the listener task can't
            # die either way, but it logs this case distinctly from a
            # malformed-input error.
        return results

    def reset(self):
        self._frames.reset()

    @property
    def pending_byte_count(self):
        return self._frames.pending_byte_count


__all__ = ["encode_message", "ProtocolStreamDecoder", "FramingError", "MessageDecodeError"]
