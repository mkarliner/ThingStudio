# SPDX-License-Identifier: Apache-2.0
# backend/test/test_line_framing.py
#
# Covers the real serial-wire encoding (line_framing.py) added 2026-09-07
# to fix ws_relay.py's original wrong assumption that raw §13 binary frames
# ride the serial wire directly -- see line_framing.py's own header and
# docs/working-notes/learnings/backend-serial-wire-format.md. Same
# adversarial bar test_framing.py already holds FrameDecoder to (split
# reads, multiple units in one read, corrupted input never hangs or
# crashes), applied here to line-based reassembly instead of length-header
# reassembly.

import base64

from thingstudio_backend.line_framing import F64_PREFIX, LineDecoder, encode_f64_line


class TestEncodeF64Line:
    def test_round_trips_through_base64(self) -> None:
        frame = bytes([0, 4, 7, 9, 9, 9])
        line = encode_f64_line(frame)
        assert line.startswith(F64_PREFIX.encode("ascii"))
        assert line.endswith(b"\n")
        payload = line[len(F64_PREFIX) : -1]
        assert base64.b64decode(payload) == frame

    def test_empty_frame(self) -> None:
        line = encode_f64_line(b"")
        assert line == b"F64:\n"


class TestLineDecoder:
    def test_one_complete_f64_line_in_one_push(self) -> None:
        frame = bytes([1, 2, 3])
        decoder = LineDecoder()
        events = decoder.push(encode_f64_line(frame))
        assert len(events) == 1
        assert events[0].frame == frame
        assert events[0].debug_text is None
        assert events[0].error is None

    def test_f64_line_split_across_multiple_pushes(self) -> None:
        frame = bytes(range(20))
        line = encode_f64_line(frame)
        decoder = LineDecoder()
        events: list = []
        for b in line:
            events.extend(decoder.push(bytes([b])))
        assert len(events) == 1
        assert events[0].frame == frame

    def test_multiple_lines_in_one_push(self) -> None:
        frame_a = bytes([9])
        frame_b = bytes([8, 8])
        decoder = LineDecoder()
        events = decoder.push(encode_f64_line(frame_a) + encode_f64_line(frame_b))
        assert [e.frame for e in events] == [frame_a, frame_b]

    def test_crlf_line_ending_stripped(self) -> None:
        frame = bytes([5, 5])
        decoder = LineDecoder()
        line = encode_f64_line(frame).rstrip(b"\n") + b"\r\n"
        events = decoder.push(line)
        assert len(events) == 1
        assert events[0].frame == frame

    def test_non_f64_line_is_a_debug_event(self) -> None:
        decoder = LineDecoder()
        events = decoder.push(b"LISTENER_READY\n")
        assert len(events) == 1
        assert events[0].debug_text == "LISTENER_READY"
        assert events[0].frame is None
        assert events[0].error is None

    def test_debug_line_with_crlf(self) -> None:
        decoder = LineDecoder()
        events = decoder.push(b"NODE_ERROR: something broke\r\n")
        assert events[0].debug_text == "NODE_ERROR: something broke"

    def test_malformed_base64_reports_error_and_does_not_desync_next_line(self) -> None:
        decoder = LineDecoder()
        good_frame = bytes([1, 1, 1])
        events = decoder.push(b"F64:not-valid-base64!!!\n" + encode_f64_line(good_frame))
        assert len(events) == 2
        assert events[0].error is not None
        assert events[0].frame is None
        assert events[1].frame == good_frame

    def test_partial_line_stays_buffered_until_newline_arrives(self) -> None:
        decoder = LineDecoder()
        events = decoder.push(b"F64:partial-no-newline-yet")
        assert events == []
        assert decoder.pending_byte_count > 0

    def test_reset_drops_buffered_partial_line(self) -> None:
        decoder = LineDecoder()
        decoder.push(b"F64:partial")
        decoder.reset()
        assert decoder.pending_byte_count == 0

    def test_non_utf8_debug_bytes_do_not_raise(self) -> None:
        # MicroPython's print() only ever emits text in practice, but this
        # must degrade gracefully rather than crash the relay if a stray
        # non-UTF8 byte ever shows up on a non-F64 line -- same
        # never-fatal posture transport.ts's TextDecoder(fatal: false) has
        # on the browser-direct side.
        decoder = LineDecoder()
        events = decoder.push(b"\xff\xfe garbled\n")
        assert len(events) == 1
        assert events[0].debug_text is not None
        assert events[0].error is None
