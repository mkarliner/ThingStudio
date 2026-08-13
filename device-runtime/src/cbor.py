# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/cbor.py
#
# A minimal CBOR encoder/decoder, hand-rolled rather than pulled in as a
# dependency -- decision worth flagging explicitly rather than assumed.
# There's no MicroPython-maintained CBOR package the way `cborg` is a real
# npm package for the editor side (docs/third-party-licenses.md), and
# CLAUDE.md's "prefer fewer dependencies... a small native implementation
# over pulling in a small utility package, where reasonable" applies
# directly: this protocol only ever needs to encode/decode 8 fixed message
# shapes (messages.py), none of which use CBOR arrays, tags, indefinite-
# length items, or anything else outside a small, well-understood subset
# (maps, unsigned/negative integers, text strings, byte strings, bools,
# IEEE-754 doubles). A full general-purpose CBOR implementation would carry
# code this protocol never exercises. Not an npm/Node package, so this
# doesn't trigger CLAUDE.md's install-flag rule -- flagged here instead,
# same spirit.
#
# Mirrors editor/src/protocol/codec.ts's use of `cborg` in one specific way
# worth calling out: encoding is always minimal/canonical (shortest valid
# length encoding for every head), matching cborg's own encoder output and
# the DECODE_OPTIONS strict-decode bar that side enforces. Decoding here is
# deliberately *not* as strict as cborg's DECODE_OPTIONS (which rejects
# non-minimal integer/length encodings, since the editor is decoding
# untrusted-until-verified device output over the same adversarial-input
# bar) -- this device only ever decodes messages the editor's own strict
# encoder produced, so rejecting non-minimal encodings here would be
# enforcing a guarantee against a sender that already provides it, not a
# real safety boundary. What *is* enforced here, same bar as the JS side:
# every decode is bounds-checked against the actual buffer length before
# any slice/read, so truncated or garbage bytes raise CBORDecodeError
# rather than silently returning wrong data (Python slicing past the end of
# a buffer does NOT raise -- it silently truncates -- so every length read
# here is checked explicitly rather than trusted to fail loudly on its
# own).
#
# Major types actually used (RFC 8949 §3.1): 0 (unsigned int), 1 (negative
# int), 2 (byte string), 3 (text string), 5 (map), 7 (bool/float). Major
# types 4 (array) and 6 (tag) are never emitted by this protocol and are
# rejected on decode as unsupported, not silently misparsed.

from errors import CBORDecodeError

try:
    import ustruct as struct
except ImportError:
    import struct  # CPython fallback, used by this module's own off-device tests


_MAJOR_UINT = 0
_MAJOR_NEGINT = 1
_MAJOR_BYTES = 2
_MAJOR_TEXT = 3
_MAJOR_MAP = 5
_MAJOR_SIMPLE = 7

_SIMPLE_FALSE = 20
_SIMPLE_TRUE = 21
_SIMPLE_DOUBLE = 27


# --- encode --------------------------------------------------------------


def _encode_head(major, length):
    """One CBOR "head": major type + length/value, using the shortest valid
    encoding for `length` (RFC 8949's own minimal-encoding rule -- this is
    what makes this encoder's output byte-identical in shape to cborg's
    canonical encoding, even though nothing here re-implements cborg)."""
    prefix = major << 5
    if length < 24:
        return bytes([prefix | length])
    if length < 256:
        return bytes([prefix | 24, length])
    if length < 65536:
        return bytes([prefix | 25]) + struct.pack(">H", length)
    if length < 4294967296:
        return bytes([prefix | 26]) + struct.pack(">I", length)
    return bytes([prefix | 27]) + struct.pack(">Q", length)


def encode(value):
    """Encode one Python value to CBOR bytes. Supports exactly what this
    protocol's message shapes need: dict (map, string keys only), bool,
    int, float, str, bytes/bytearray. Anything else raises TypeError --
    a bug in the caller, not adversarial input, so this deliberately isn't
    a CBORDecodeError."""
    if isinstance(value, bool):  # must precede the int check -- bool is a
        # subclass of int in Python/MicroPython
        return _encode_head(_MAJOR_SIMPLE, _SIMPLE_TRUE if value else _SIMPLE_FALSE)
    if isinstance(value, int):
        if value >= 0:
            return _encode_head(_MAJOR_UINT, value)
        return _encode_head(_MAJOR_NEGINT, -1 - value)
    if isinstance(value, float):
        return _encode_head(_MAJOR_SIMPLE, _SIMPLE_DOUBLE) + struct.pack(">d", value)
    if isinstance(value, str):
        data = value.encode("utf-8")
        return _encode_head(_MAJOR_TEXT, len(data)) + data
    if isinstance(value, (bytes, bytearray)):
        data = bytes(value)
        return _encode_head(_MAJOR_BYTES, len(data)) + data
    if isinstance(value, dict):
        out = _encode_head(_MAJOR_MAP, len(value))
        for k, v in value.items():
            if not isinstance(k, str):
                raise TypeError("cbor.encode: map keys must be strings, got %r" % (type(k),))
            out += encode(k)
            out += encode(v)
        return out
    raise TypeError("cbor.encode: unsupported value type %r" % (type(value),))


# --- decode ----------------------------------------------------------------


def _need(data, offset, n, what):
    if offset + n > len(data):
        raise CBORDecodeError("truncated CBOR while reading %s (need %d bytes at offset %d, have %d)" % (what, n, offset, len(data)))


def _decode_head(data, offset):
    """Returns (major, length_or_value, new_offset). Raises CBORDecodeError
    on truncation or an unsupported additional-info value (indefinite
    length, reserved values) -- never lets a bad head silently produce a
    wrong length."""
    _need(data, offset, 1, "a CBOR head byte")
    first = data[offset]
    major = first >> 5
    info = first & 0x1F
    offset += 1
    if info < 24:
        return major, info, offset
    if info == 24:
        _need(data, offset, 1, "a 1-byte length")
        return major, data[offset], offset + 1
    if info == 25:
        _need(data, offset, 2, "a 2-byte length")
        (n,) = struct.unpack(">H", data[offset : offset + 2])
        return major, n, offset + 2
    if info == 26:
        _need(data, offset, 4, "a 4-byte length")
        (n,) = struct.unpack(">I", data[offset : offset + 4])
        return major, n, offset + 4
    if info == 27:
        _need(data, offset, 8, "an 8-byte length")
        (n,) = struct.unpack(">Q", data[offset : offset + 8])
        return major, n, offset + 8
    # 28-30 reserved, 31 indefinite-length -- this protocol never emits or
    # accepts either; reject cleanly rather than misparse.
    raise CBORDecodeError("unsupported CBOR additional-info value %d (indefinite-length/reserved items not supported)" % (info,))


def _decode_value(data, offset):
    major, length, offset = _decode_head(data, offset)

    if major == _MAJOR_UINT:
        return length, offset

    if major == _MAJOR_NEGINT:
        return -1 - length, offset

    if major == _MAJOR_BYTES:
        _need(data, offset, length, "a byte string body")
        return bytes(data[offset : offset + length]), offset + length

    if major == _MAJOR_TEXT:
        _need(data, offset, length, "a text string body")
        raw = data[offset : offset + length]
        try:
            return raw.decode("utf-8"), offset + length
        except Exception as e:  # noqa: BLE001 -- any decode failure is adversarial input, not a bug
            raise CBORDecodeError("invalid UTF-8 in CBOR text string: %r" % (e,))

    if major == _MAJOR_MAP:
        result = {}
        for _ in range(length):
            key, offset = _decode_value(data, offset)
            if not isinstance(key, str):
                raise CBORDecodeError("CBOR map key must be a text string, got %r" % (type(key),))
            val, offset = _decode_value(data, offset)
            result[key] = val
        return result, offset

    if major == _MAJOR_SIMPLE:
        if length == _SIMPLE_FALSE:
            return False, offset
        if length == _SIMPLE_TRUE:
            return True, offset
        if length == _SIMPLE_DOUBLE:
            _need(data, offset, 8, "a double-precision float body")
            (v,) = struct.unpack(">d", data[offset : offset + 8])
            return v, offset + 8
        # null (22), undefined (23), half/single float (25/26), other
        # simple values (24, 28-30) -- none of this protocol's message
        # shapes ever use them (messages.py's optional fields are omitted
        # from the map entirely, never encoded as CBOR null/undefined).
        raise CBORDecodeError("unsupported CBOR simple/float value (major 7, additional info %d)" % (length,))

    # major 4 (array) and 6 (tag) -- never used by this protocol.
    raise CBORDecodeError("unsupported CBOR major type %d -- this protocol only uses maps, ints, strings, bytes, and bool/double" % (major,))


def decode(data):
    """Decode CBOR bytes to one Python value. Requires the buffer to be
    exactly one top-level value with no trailing bytes -- matches how
    codec.ts's decodeMessageBody uses cborg (whole message body, one CBOR
    value, no framing bytes mixed in). Raises CBORDecodeError, never lets
    a raw exception escape, on anything malformed."""
    if not isinstance(data, (bytes, bytearray)):
        raise CBORDecodeError("cbor.decode expects bytes, got %r" % (type(data),))
    try:
        value, offset = _decode_value(bytes(data), 0)
    except CBORDecodeError:
        raise
    except Exception as e:  # noqa: BLE001 -- convert anything unexpected (IndexError, struct.error, ...) rather than let it escape
        raise CBORDecodeError("malformed CBOR: %r" % (e,))
    if offset != len(data):
        raise CBORDecodeError("trailing bytes after decoded CBOR value (%d unread of %d)" % (len(data) - offset, len(data)))
    return value
