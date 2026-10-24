# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_transfer.py
#
# transfer.py: the piece-stream state machine (interfaces/protocol/SPEC.md §7.2), one test per row of the
# spec's table, under the real MicroPython unix port. The exchange vectors (test_exchanges.py) check the same
# rules through the listener; these pin the table itself.

import os

import minitest

minitest.add_src_to_path()

import transfer  # noqa: E402

_PATH = "/tmp/ts_transfer_test.tmp"


def _fresh():
    try:
        os.remove(_PATH)
    except OSError:
        pass
    return transfer.Stream(_PATH)


def _file():
    with open(_PATH, "rb") as f:
        return f.read()


def test_offset_0_from_idle_starts_receiving():
    s = _fresh()
    assert s.put(0, 6, b"abc") is None
    assert s.state == transfer.RECEIVING and s.stored == 3 and s.total == 6
    assert _file() == b"abc"


def test_next_piece_appends():
    s = _fresh()
    s.put(0, 6, b"abc")
    assert s.put(3, 6, b"def") is None
    assert s.stored == 6 and s.complete(6) and _file() == b"abcdef"


def test_resend_of_a_stored_piece_is_ok_and_changes_nothing():
    # The rule the audit's finding 1 broke: a lost ack makes the editor resend a piece already stored.
    s = _fresh()
    s.put(0, 6, b"abc")
    s.put(3, 6, b"def")
    assert s.put(3, 6, b"def") is None
    assert s.put(0, 6, b"abc") is None  # offset 0 resent: starts over, which also stores the same bytes
    assert s.stored == 3 and _file() == b"abc"
    assert s.put(3, 6, b"def") is None and s.complete(6) and _file() == b"abcdef"


def test_resend_of_an_earlier_piece_keeps_stored():
    s = _fresh()
    s.put(0, 9, b"abc")
    s.put(3, 9, b"def")
    assert s.put(3, 9, b"def") is None
    assert s.stored == 6
    assert s.put(6, 9, b"ghi") is None and s.complete(9) and _file() == b"abcdefghi"


def test_offset_0_always_starts_over():
    # Finding 1b: after an abandoned transfer, the next deploy's first piece must be accepted.
    s = _fresh()
    s.put(0, 9, b"abc")
    s.put(3, 9, b"def")
    assert s.put(0, 4, b"wxyz") is None
    assert s.stored == 4 and s.total == 4 and s.complete(4) and _file() == b"wxyz"


def test_gap_is_refused_and_state_kept():
    s = _fresh()
    s.put(0, 9, b"abc")
    code, error = s.put(6, 9, b"ghi")
    assert code == "BadPiece" and "expected 3" in error, error
    assert s.state == transfer.RECEIVING and s.stored == 3
    assert s.put(3, 9, b"def") is None  # the missing piece still fits in


def test_different_total_is_refused():
    s = _fresh()
    s.put(0, 9, b"abc")
    code, _ = s.put(3, 12, b"def")
    assert code == "BadPiece" and s.stored == 3 and s.total == 9


def test_piece_past_the_end_is_refused_in_any_state():
    s = _fresh()
    assert s.put(0, 2, b"abc")[0] == "BadPiece"
    assert s.state == transfer.IDLE
    s.put(0, 4, b"ab")
    assert s.put(2, 4, b"cde")[0] == "BadPiece"
    assert s.stored == 2


def test_nonzero_offset_while_idle_is_refused():
    s = _fresh()
    code, error = s.put(3, 6, b"def")
    assert code == "BadPiece" and "start at 0" in error, error
    assert s.state == transfer.IDLE


def test_failed_repeats_its_error_until_offset_0():
    s = _fresh()
    s.put(0, 6, b"abc")
    s.fail("NoSpace", "flash full")
    assert s.state == transfer.FAILED
    assert s.put(3, 6, b"def") == ("NoSpace", "flash full")
    assert s.put(0, 6, b"abc") is None and s.state == transfer.RECEIVING


def test_write_failure_moves_to_failed():
    s = transfer.Stream("/nonexistent-dir-for-ts-test/x.tmp")
    code, error = s.put(0, 3, b"abc")
    assert code == "WriteFailed" and s.state == transfer.FAILED, (code, error)


def test_discard_and_finish_return_to_idle():
    s = _fresh()
    s.put(0, 6, b"abc")
    s.discard()
    assert s.state == transfer.IDLE and s.stored == 0
    try:
        os.stat(_PATH)
        assert False, "discard() should remove the temporary file"
    except OSError:
        pass
    s.put(0, 3, b"abc")
    s.finish()
    assert s.state == transfer.IDLE and s.stored_offset() == 0


def test_complete_needs_every_byte_and_the_same_total():
    s = _fresh()
    assert not s.complete(0)
    s.put(0, 6, b"abc")
    assert not s.complete(6) and not s.complete(3)
    assert "3 of 6" in s.describe(6)


def test_empty_file_is_one_empty_piece():
    s = _fresh()
    assert s.put(0, 0, b"") is None and s.complete(0)


def test_stored_offset_reports_progress_only_while_receiving():
    s = _fresh()
    assert s.stored_offset() == 0
    s.put(0, 6, b"abc")
    assert s.stored_offset() == 3
    s.fail("WriteFailed", "x")
    assert s.stored_offset() == 0


minitest.run(
    [
        test_offset_0_from_idle_starts_receiving,
        test_next_piece_appends,
        test_resend_of_a_stored_piece_is_ok_and_changes_nothing,
        test_resend_of_an_earlier_piece_keeps_stored,
        test_offset_0_always_starts_over,
        test_gap_is_refused_and_state_kept,
        test_different_total_is_refused,
        test_piece_past_the_end_is_refused_in_any_state,
        test_nonzero_offset_while_idle_is_refused,
        test_failed_repeats_its_error_until_offset_0,
        test_write_failure_moves_to_failed,
        test_discard_and_finish_return_to_idle,
        test_complete_needs_every_byte_and_the_same_total,
        test_empty_file_is_one_empty_piece,
        test_stored_offset_reports_progress_only_while_receiving,
    ]
)
