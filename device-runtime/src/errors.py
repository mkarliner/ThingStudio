# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/errors.py
#
# Error types for the device-side §13 wire protocol stack -- the MicroPython
# mirror of editor/src/protocol/errors.ts. Same split, same reason: cbor.py,
# framing.py, messages.py, and protocol.py all need to construct and catch
# these without a circular import between them.
#
# Same "recoverable-by-design, not fatal" contract as the JS side (see
# docs/working-notes/validation/mvp-validation-plan.md, "Real wire protocol
# (§13)": "every case should degrade to a logged, recoverable error, never a
# hang or a crash") -- these are caught per-frame/per-message by
# listener.py's dispatch loop, never allowed to propagate and kill the
# listener task. That loop-level guarantee is the actual fault-isolation
# half 2 requirement; these classes just make "was this adversarial input,
# or a real bug" distinguishable at the catch site, same as the JS side.


class CBORDecodeError(Exception):
    """Malformed or unsupported CBOR bytes (cbor.py). Mirrors cborg's decode
    failure path on the JS side -- never lets a raw IndexError/struct.error/
    etc. escape from cbor.decode()."""


class FramingError(Exception):
    """A malformed frame: bad length header, or a declared length that
    can't be trusted (framing.py). Mirrors editor/src/protocol/errors.ts's
    FramingError exactly."""


class MessageDecodeError(Exception):
    """A frame that parsed fine but whose body is bad CBOR, or valid CBOR
    with the wrong shape for its declared message type (messages.py).
    Mirrors editor/src/protocol/errors.ts's MessageDecodeError exactly."""
