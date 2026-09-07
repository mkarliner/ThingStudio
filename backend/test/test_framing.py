# SPDX-License-Identifier: Apache-2.0
# backend/test/test_framing.py
#
# Python port of editor/test/framing.adversarial.test.ts's cases, run against
# framing.py's FrameDecoder -- same adversarial bar (truncated frames,
# oversized/corrupted length headers, garbage bytes, one frame split across
# multiple reads, multiple frames in one read: every case should degrade to a
# recoverable result, never a hang or a crash), since this backend implements
# the identical byte-level framing scheme and needs the same guarantees.

from thingstudio_backend.framing import (
    FRAME_LENGTH_HEADER_BYTES,
    MAX_FRAME_PAYLOAD_LENGTH,
    FrameDecoder,
    FramingError,
    encode_frame,
)


class TestEncodeFrame:
    def test_encodes_length_type_payload(self) -> None:
        payload = bytes([10, 20, 30])
        frame = encode_frame(7, payload)
        assert len(frame) == 2 + 1 + len(payload)
        assert frame[0] == 0  # length 4, big-endian high byte
        assert frame[1] == 4  # length 4, big-endian low byte
        assert frame[2] == 7  # type byte
        assert list(frame[3:]) == [10, 20, 30]

    def test_rejects_type_out_of_range(self) -> None:
        for bad_type in (256, -1):
            try:
                encode_frame(bad_type, b"")
            except FramingError:
                pass
            else:
                raise AssertionError(f"expected FramingError for type {bad_type}")

    def test_rejects_oversized_payload(self) -> None:
        too_big = bytes(MAX_FRAME_PAYLOAD_LENGTH)  # +1 for the type byte pushes it over
        try:
            encode_frame(1, too_big)
        except FramingError:
            pass
        else:
            raise AssertionError("expected FramingError")

    def test_accepts_payload_at_ceiling(self) -> None:
        at_ceiling = bytes(MAX_FRAME_PAYLOAD_LENGTH - 1)
        encode_frame(1, at_ceiling)  # should not raise


class TestFrameDecoderRoundTrip:
    def test_single_complete_frame_in_one_push(self) -> None:
        decoder = FrameDecoder()
        frame = encode_frame(5, bytes([1, 2, 3]))
        results = decoder.push(frame)
        assert len(results) == 1
        assert results[0].frame is not None
        assert results[0].frame.type == 5
        assert results[0].frame.payload == bytes([1, 2, 3])
        assert results[0].frame.raw == frame
        assert decoder.pending_byte_count == 0

    def test_multiple_frames_in_one_read_extracted_in_order(self) -> None:
        decoder = FrameDecoder()
        f1 = encode_frame(1, bytes([1]))
        f2 = encode_frame(2, bytes([2, 2]))
        f3 = encode_frame(3, b"")
        combined = f1 + f2 + f3

        results = decoder.push(combined)
        assert len(results) == 3
        assert all(r.frame is not None for r in results)
        assert [r.frame.type for r in results] == [1, 2, 3]
        assert decoder.pending_byte_count == 0

    def test_one_frame_split_across_multiple_reads(self) -> None:
        decoder = FrameDecoder()
        frame = encode_frame(9, bytes([1, 2, 3, 4, 5]))

        results: list = []
        for i in range(len(frame)):
            chunk = frame[i : i + 1]
            r = decoder.push(chunk)
            results.extend(r)
            if i < len(frame) - 1:
                assert r == []  # nothing complete yet -- no premature/partial frame

        assert len(results) == 1
        assert results[0].frame.type == 9
        assert results[0].frame.payload == bytes([1, 2, 3, 4, 5])

    def test_truncated_frame_waits_for_more_bytes(self) -> None:
        decoder = FrameDecoder()
        frame = encode_frame(1, bytes([1, 2, 3, 4, 5]))
        truncated = frame[:-2]

        results = decoder.push(truncated)
        assert results == []
        assert decoder.pending_byte_count == len(truncated)

        results2 = decoder.push(frame[-2:])
        assert len(results2) == 1
        assert results2[0].frame is not None

    def test_truncated_length_header_waits(self) -> None:
        decoder = FrameDecoder()
        frame = encode_frame(1, bytes([42]))
        results = decoder.push(frame[:1])
        assert results == []
        assert decoder.pending_byte_count == 1

    def test_empty_push_is_a_noop(self) -> None:
        decoder = FrameDecoder()
        assert decoder.push(b"") == []


class TestFrameDecoderAdversarial:
    def test_plausible_but_incomplete_length_does_not_crash(self) -> None:
        decoder = FrameDecoder()
        # Interpreted as length=0x1234 (a huge, "plausible" 2-byte value), then
        # waits for that many bytes -- legitimate behavior for a byte-counting
        # protocol with no resync marker (see framing.py's module docstring).
        garbage_header = bytes([0x12, 0x34, 0xDE, 0xAD, 0xBE, 0xEF])
        results = decoder.push(garbage_header)
        assert results == []  # waiting, not erroring
        assert decoder.pending_byte_count == len(garbage_header)

    def test_length_shorter_than_type_field_is_rejected_and_buffer_dropped(self) -> None:
        decoder = FrameDecoder()
        bogus = bytes([0x00, 0x00, 0xFF, 0xFF, 0xFF])  # length=0 can't even hold the type byte
        results = decoder.push(bogus)
        assert len(results) == 1
        assert results[0].error is not None
        assert isinstance(results[0].error, FramingError)
        assert decoder.pending_byte_count == 0  # buffer dropped, not stuck forever

        # The decoder still works normally afterward -- one bad frame doesn't wedge it.
        good_frame = encode_frame(1, bytes([1, 2, 3]))
        results2 = decoder.push(good_frame)
        assert len(results2) == 1
        assert results2[0].frame is not None

    def test_reset_drops_buffered_bytes(self) -> None:
        decoder = FrameDecoder()
        decoder.push(bytes([0x00, 0x05, 1, 2]))  # a truncated, still-plausible frame
        assert decoder.pending_byte_count > 0
        decoder.reset()
        assert decoder.pending_byte_count == 0

    def test_frame_length_header_bytes_constant(self) -> None:
        assert FRAME_LENGTH_HEADER_BYTES == 2
