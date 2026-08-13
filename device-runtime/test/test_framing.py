# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_framing.py
#
# Off-device tests for framing.py, run against the headless MicroPython
# unix-port build -- ports every scenario in
# editor/test/framing.adversarial.test.ts to the Python side, per
# fault-isolation-briefing.md's own instruction ("reuse/extend the JS-side
# adversarial framing tests' *scenarios* ... as the source of cases to
# port to the Python side's own off-device tests"). Same cases, same
# ordering, so a diff against the .ts file is easy to eyeball.

import minitest

minitest.add_src_to_path()

import framing
from errors import FramingError


def _is_frame(r):
    return "frame" in r


def _is_error(r):
    return "error" in r


def test_encode_frame_layout():
    payload = bytes([10, 20, 30])
    frame = framing.encode_frame(7, payload)
    assert len(frame) == 2 + 1 + len(payload)
    assert frame[0] == 0  # length 4, big-endian high byte
    assert frame[1] == 4  # length 4, big-endian low byte
    assert frame[2] == 7  # type byte
    assert frame[3:] == payload


def test_encode_frame_rejects_bad_type_byte():
    for bad in (256, -1):
        try:
            framing.encode_frame(bad, b"")
            assert False, "expected FramingError for type byte %r" % (bad,)
        except FramingError:
            pass


def test_encode_frame_rejects_oversized_payload():
    too_big = bytes(framing.MAX_FRAME_PAYLOAD_LENGTH)  # +1 for the type byte pushes it over
    try:
        framing.encode_frame(1, too_big)
        assert False, "expected FramingError for oversized payload"
    except FramingError:
        pass


def test_encode_frame_accepts_payload_at_ceiling():
    at_ceiling = bytes(framing.MAX_FRAME_PAYLOAD_LENGTH - 1)
    framing.encode_frame(1, at_ceiling)  # must not raise


def test_decode_single_frame_one_push():
    decoder = framing.FrameDecoder()
    frame = framing.encode_frame(5, bytes([1, 2, 3]))
    results = decoder.push(frame)
    assert len(results) == 1
    assert _is_frame(results[0])
    assert results[0]["frame"]["type"] == 5
    assert results[0]["frame"]["payload"] == bytes([1, 2, 3])
    assert decoder.pending_byte_count == 0


def test_multiple_frames_in_one_read():
    decoder = framing.FrameDecoder()
    f1 = framing.encode_frame(1, bytes([1]))
    f2 = framing.encode_frame(2, bytes([2, 2]))
    f3 = framing.encode_frame(3, b"")
    results = decoder.push(f1 + f2 + f3)
    assert len(results) == 3
    assert all(_is_frame(r) for r in results)
    assert [r["frame"]["type"] for r in results] == [1, 2, 3]
    assert decoder.pending_byte_count == 0


def test_frame_split_byte_by_byte():
    decoder = framing.FrameDecoder()
    frame = framing.encode_frame(9, bytes([1, 2, 3, 4, 5]))
    results = []
    for i in range(len(frame)):
        r = decoder.push(frame[i : i + 1])
        results += r
        if i < len(frame) - 1:
            assert len(r) == 0, "no premature/partial frame at byte %d" % i
    assert len(results) == 1
    assert _is_frame(results[0])
    assert results[0]["frame"]["type"] == 9
    assert results[0]["frame"]["payload"] == bytes([1, 2, 3, 4, 5])


def test_truncated_frame_waits():
    decoder = framing.FrameDecoder()
    frame = framing.encode_frame(1, bytes([1, 2, 3, 4, 5]))
    truncated = frame[: len(frame) - 2]
    results = decoder.push(truncated)
    assert len(results) == 0
    assert decoder.pending_byte_count == len(truncated)

    results2 = decoder.push(frame[len(frame) - 2 :])
    assert len(results2) == 1
    assert _is_frame(results2[0])


def test_truncated_length_header_waits():
    decoder = framing.FrameDecoder()
    frame = framing.encode_frame(1, bytes([42]))
    results = decoder.push(frame[:1])
    assert len(results) == 0
    assert decoder.pending_byte_count == 1


def test_empty_push_is_noop():
    decoder = framing.FrameDecoder()
    assert decoder.push(b"") == []


def test_plausible_but_incomplete_length_header_waits_not_errors():
    decoder = framing.FrameDecoder()
    garbage_header = bytes([0x12, 0x34, 0xDE, 0xAD, 0xBE, 0xEF])  # declares length=0x1234
    results = decoder.push(garbage_header)
    assert len(results) == 0
    assert decoder.pending_byte_count == len(garbage_header)


def test_length_shorter_than_type_field_rejected_and_buffer_dropped():
    decoder = framing.FrameDecoder()
    bogus = bytes([0x00, 0x00, 0xFF, 0xFF, 0xFF])  # length 0: can't hold even the type byte
    results = decoder.push(bogus)
    assert len(results) == 1
    assert _is_error(results[0])
    assert isinstance(results[0]["error"], FramingError)
    assert decoder.pending_byte_count == 0

    good_frame = framing.encode_frame(1, bytes([1, 2, 3]))
    results2 = decoder.push(good_frame)
    assert len(results2) == 1
    assert _is_frame(results2[0])


def test_length_at_ceiling_does_not_throw_or_hang():
    decoder = framing.FrameDecoder()
    header = bytes([0xFF, 0xFF])  # length = 65535
    results = decoder.push(header)
    assert len(results) == 0
    assert decoder.pending_byte_count == 2
    decoder.reset()
    assert decoder.pending_byte_count == 0


def test_50_malformed_frames_soak():
    decoder = framing.FrameDecoder()
    for _ in range(50):
        bogus = bytes([0x00, 0x00])
        results = decoder.push(bogus)
        assert len(results) == 1
        assert _is_error(results[0])
    good_frame = framing.encode_frame(3, bytes([9, 9]))
    results = decoder.push(good_frame)
    assert len(results) == 1
    assert _is_frame(results[0])


def test_interleaved_bad_frame_isolates_damage():
    decoder = framing.FrameDecoder()
    good1 = framing.encode_frame(1, bytes([1]))
    bad_length_header = bytes([0x00, 0x00])
    good2 = framing.encode_frame(2, bytes([2]))

    results1 = decoder.push(good1 + bad_length_header)
    frames1 = [r["frame"]["type"] for r in results1 if _is_frame(r)]
    assert frames1 == [1]
    assert any(_is_error(r) for r in results1)

    results2 = decoder.push(good2)
    assert len(results2) == 1
    assert _is_frame(results2[0])
    assert results2[0]["frame"]["type"] == 2


def test_garbage_payload_still_frames_correctly():
    decoder = framing.FrameDecoder()
    frame = framing.encode_frame(1, bytes([0xFF, 0xFF, 0xFF, 0xFF]))  # not valid CBOR, but well-formed framing
    results = decoder.push(frame)
    assert len(results) == 1
    assert _is_frame(results[0])


def test_reset_drops_buffer_and_recovers():
    decoder = framing.FrameDecoder()
    decoder.push(bytes([0x00, 0x05, 1, 2]))  # partial frame, waiting
    assert decoder.pending_byte_count > 0
    decoder.reset()
    assert decoder.pending_byte_count == 0

    frame = framing.encode_frame(1, bytes([7]))
    results = decoder.push(frame)
    assert len(results) == 1
    assert _is_frame(results[0])


def test_frame_length_header_bytes_constant():
    assert framing.FRAME_LENGTH_HEADER_BYTES == 2


minitest.run(
    [
        test_encode_frame_layout,
        test_encode_frame_rejects_bad_type_byte,
        test_encode_frame_rejects_oversized_payload,
        test_encode_frame_accepts_payload_at_ceiling,
        test_decode_single_frame_one_push,
        test_multiple_frames_in_one_read,
        test_frame_split_byte_by_byte,
        test_truncated_frame_waits,
        test_truncated_length_header_waits,
        test_empty_push_is_noop,
        test_plausible_but_incomplete_length_header_waits_not_errors,
        test_length_shorter_than_type_field_rejected_and_buffer_dropped,
        test_length_at_ceiling_does_not_throw_or_hang,
        test_50_malformed_frames_soak,
        test_interleaved_bad_frame_isolates_damage,
        test_garbage_payload_still_frames_correctly,
        test_reset_drops_buffer_and_recovers,
        test_frame_length_header_bytes_constant,
    ]
)
