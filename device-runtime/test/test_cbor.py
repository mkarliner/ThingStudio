# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_cbor.py
#
# Off-device tests for cbor.py, run against the headless MicroPython
# unix-port build (docs/working-notes/validation/mvp-validation-plan.md's
# "off-device first" convention) -- see device-runtime/test/README.md for
# the build recipe used. Also runs fine under CPython3 for a fast local
# check, but the unix-port run is the one that actually matters (real
# MicroPython int/float/bytes semantics, not CPython's).
#
# Round-trips every value shape messages.py's message bodies actually use,
# plus the adversarial cases the CBOR layer itself is responsible for
# catching cleanly (truncated data, garbage, unsupported major types) --
# same "never a hang or a crash, always a clean error" bar as
# editor/src/protocol/codec.ts's own adversarial coverage.

import minitest

minitest.add_src_to_path()

import cbor
from errors import CBORDecodeError


def _roundtrip(value):
    encoded = cbor.encode(value)
    decoded = cbor.decode(encoded)
    assert decoded == value, "roundtrip mismatch: %r != %r" % (decoded, value)
    return encoded


def test_roundtrip_bool():
    _roundtrip(True)
    _roundtrip(False)


def test_roundtrip_uint():
    for v in (0, 1, 23, 24, 255, 256, 65535, 65536, 1000000):
        _roundtrip(v)


def test_roundtrip_negint():
    for v in (-1, -24, -25, -256, -257, -65536, -1000000):
        _roundtrip(v)


def test_roundtrip_float():
    for v in (0.0, 1.5, -3.25, 3.14159265, 1e10, -1e-10):
        encoded = cbor.encode(v)
        decoded = cbor.decode(encoded)
        assert abs(decoded - v) < 1e-9, "float roundtrip mismatch: %r != %r" % (decoded, v)


def test_roundtrip_string():
    for v in ("", "hello", "unicode: éè", "x" * 300):
        _roundtrip(v)


def test_roundtrip_bytes():
    for v in (b"", b"\x00\x01\x02", b"x" * 300):
        _roundtrip(v)


def test_roundtrip_map():
    _roundtrip({})
    _roundtrip({"a": 1, "b": "two", "c": True, "d": b"bytes", "e": 1.5})
    _roundtrip({"nested": {"major": 1, "minor": 2, "patch": 3}})


def test_minimal_encoding_matches_head_size():
    # 0 needs 1 byte total (major+value packed in one byte); 24 needs 2
    # bytes (head byte 0x18 + 1-byte length) -- confirms _encode_head picks
    # the shortest valid form, same canonical-encoding property cborg's
    # encoder guarantees on the JS side.
    assert len(cbor.encode(0)) == 1
    assert len(cbor.encode(23)) == 1
    assert len(cbor.encode(24)) == 2
    assert len(cbor.encode(255)) == 2
    assert len(cbor.encode(256)) == 3


def test_decode_rejects_truncated_head():
    try:
        cbor.decode(b"")
        assert False, "expected CBORDecodeError on empty input"
    except CBORDecodeError:
        pass


def test_decode_rejects_truncated_string_body():
    # Head says "8-byte text string" but only 2 bytes follow.
    head = bytes([0x60 | 8])  # major 3 (text), length 8
    try:
        cbor.decode(head + b"ab")
        assert False, "expected CBORDecodeError on truncated string body"
    except CBORDecodeError:
        pass


def test_decode_rejects_truncated_map_value():
    # A map claiming 1 entry, with a valid key but no value bytes at all.
    data = bytes([0xA1]) + cbor.encode("k")  # major 5 (map), 1 entry; key "k"; value missing
    try:
        cbor.decode(data)
        assert False, "expected CBORDecodeError on truncated map value"
    except CBORDecodeError:
        pass


def test_decode_rejects_trailing_garbage():
    data = cbor.encode({"a": 1}) + b"\xff\xff\xff"
    try:
        cbor.decode(data)
        assert False, "expected CBORDecodeError on trailing bytes"
    except CBORDecodeError:
        pass


def test_decode_rejects_unsupported_major_type_array():
    # Major type 4 (array), 0 elements -- valid CBOR, but this protocol
    # never uses arrays and shouldn't silently accept one.
    try:
        cbor.decode(bytes([0x80]))
        assert False, "expected CBORDecodeError on array major type"
    except CBORDecodeError:
        pass


def test_decode_rejects_unsupported_major_type_tag():
    # Major type 6 (tag) wrapping a uint -- also never used by this protocol.
    try:
        cbor.decode(bytes([0xC0, 0x00]))
        assert False, "expected CBORDecodeError on tag major type"
    except CBORDecodeError:
        pass


def test_decode_rejects_indefinite_length():
    # Major type 3 (text string) with additional-info 31 (indefinite) --
    # not supported, must be rejected cleanly, not misparsed.
    try:
        cbor.decode(bytes([0x7F]))
        assert False, "expected CBORDecodeError on indefinite-length item"
    except CBORDecodeError:
        pass


def test_decode_rejects_non_string_map_key():
    # Major type 5 (map), 1 entry, key is uint 1 (not a text string) --
    # this protocol's message shapes never use non-string keys.
    data = bytes([0xA1]) + cbor.encode(1) + cbor.encode("v")
    try:
        cbor.decode(data)
        assert False, "expected CBORDecodeError on non-string map key"
    except CBORDecodeError:
        pass


def test_decode_random_garbage_never_crashes():
    # 50 pseudo-random byte strings, same soak-test spirit as the
    # fault-isolation plan's 50-frame test -- every one must either decode
    # to *something* or raise CBORDecodeError, never anything else.
    seed = 12345
    for i in range(50):
        seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
        length = seed % 40
        data = bytes([(seed >> (j % 24)) & 0xFF for j in range(length)])
        try:
            cbor.decode(data)
        except CBORDecodeError:
            pass  # expected outcome for most garbage inputs


def test_encode_rejects_unsupported_type():
    try:
        cbor.encode([1, 2, 3])  # lists/arrays are not a supported value type
        assert False, "expected TypeError on encoding a list"
    except TypeError:
        pass


minitest.run(
    [
        test_roundtrip_bool,
        test_roundtrip_uint,
        test_roundtrip_negint,
        test_roundtrip_float,
        test_roundtrip_string,
        test_roundtrip_bytes,
        test_roundtrip_map,
        test_minimal_encoding_matches_head_size,
        test_decode_rejects_truncated_head,
        test_decode_rejects_truncated_string_body,
        test_decode_rejects_truncated_map_value,
        test_decode_rejects_trailing_garbage,
        test_decode_rejects_unsupported_major_type_array,
        test_decode_rejects_unsupported_major_type_tag,
        test_decode_rejects_indefinite_length,
        test_decode_rejects_non_string_map_key,
        test_decode_random_garbage_never_crashes,
        test_encode_rejects_unsupported_type,
    ]
)
