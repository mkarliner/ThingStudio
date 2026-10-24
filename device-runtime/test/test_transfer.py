# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_transfer.py
#
# statemachine.py running the `board.stream` machine from interfaces/protocol/states.json (SPEC §7.2), and
# statemachine.py itself, under the real MicroPython unix port: each legal move, each illegal one (which must be
# announced, exactly once), and a table that names something this side doesn't implement. The exchange vectors
# (test_exchanges.py) check the same rules through the listener.

import os

import minitest

minitest.add_src_to_path()

import statemachine  # noqa: E402

_PATH = "/tmp/ts_transfer_test.tmp"
_alerts = []
statemachine.alert = _alerts.append


def _fresh(before_start=None):
    try:
        os.remove(_PATH)
    except OSError:
        pass
    del _alerts[:]
    return statemachine.Stream(_PATH, "flow", before_start)


def _file():
    with open(_PATH, "rb") as f:
        return f.read()


def _exists():
    try:
        os.stat(_PATH)
        return True
    except OSError:
        return False


# --- legal moves: no alert ---

def test_offset_0_from_idle_starts_receiving():
    s = _fresh()
    assert s.put(0, 6, b"abc") is None
    assert s.state == "receiving" and s.stored == 3 and s.total == 6
    assert _file() == b"abc" and _alerts == []


def test_next_piece_then_commit():
    s = _fresh()
    s.put(0, 6, b"abc")
    assert s.put(3, 6, b"def") is None
    assert s.commit(6) is None
    assert s.state == "idle" and _file() == b"abcdef", "a commit leaves the file for its owner"
    assert _alerts == []


def test_any_piece_may_be_sent_again():
    # Audit finding 1: a lost ack makes the editor resend a piece already stored.
    s = _fresh()
    s.put(0, 9, b"abc")
    s.put(3, 9, b"def")
    assert s.put(3, 9, b"def") is None and s.stored == 6
    assert s.put(6, 9, b"ghi") is None and s.commit(9) is None
    assert _file() == b"abcdefghi" and _alerts == []


def test_offset_0_always_starts_over():
    s = _fresh()
    s.put(0, 9, b"abc")
    assert s.put(0, 4, b"wxyz") is None
    assert s.stored == 4 and s.total == 4 and _file() == b"wxyz" and _alerts == []


def test_write_failure_moves_to_failed_and_repeats_until_offset_0():
    s = statemachine.Stream("/nonexistent-dir-for-ts-test/x.tmp", "flow")
    del _alerts[:]
    code, _ = s.put(0, 6, b"abc")
    assert code == "WriteFailed" and s.state == "failed"
    assert s.put(3, 6, b"def")[0] == "WriteFailed", "a later piece gets the recorded failure"
    assert _alerts == [], "a failed write is not a protocol violation"


def test_before_start_failure_is_recorded():
    def no_room(total):
        raise statemachine.Failure("NoSpace", "no space: needs %d" % (total,))

    s = _fresh(no_room)
    assert s.put(0, 6, b"abc") == ("NoSpace", "no space: needs 6")
    assert s.state == "failed" and not _exists()


def test_abandon_removes_the_file():
    s = _fresh()
    s.put(0, 6, b"abc")
    s.abandon()
    assert s.state == "idle" and not _exists() and _alerts == []


def test_stored_offset_reports_progress_only_while_receiving():
    s = _fresh()
    assert s.stored == 0
    s.put(0, 6, b"abc")
    assert s.stored == 3


# --- illegal moves: announced once, answered as the table says ---

def _one_alert(event):
    assert len(_alerts) == 1 and _alerts[0].startswith("PROTOCOL_ILLEGAL board.stream(flow) ") and (" %s:" % event) in _alerts[0], _alerts


def test_gap_is_illegal_and_keeps_the_state():
    s = _fresh()
    s.put(0, 9, b"abc")
    code, _ = s.put(6, 9, b"ghi")
    assert code == "BadPiece" and s.state == "receiving" and s.stored == 3
    _one_alert("piece")
    assert s.put(3, 9, b"def") is None  # the missing piece still fits in


def test_different_total_is_illegal():
    s = _fresh()
    s.put(0, 9, b"abc")
    assert s.put(3, 12, b"def")[0] == "BadPiece" and s.total == 9
    _one_alert("piece")


def test_piece_past_the_end_is_illegal():
    s = _fresh()
    assert s.put(0, 2, b"abc")[0] == "BadPiece" and s.state == "idle"
    _one_alert("piece")


def test_nonzero_offset_while_idle_is_illegal():
    s = _fresh()
    assert s.put(3, 6, b"def")[0] == "BadPiece" and s.state == "idle"
    _one_alert("piece")


def test_incomplete_commit_is_illegal_and_ends_the_stream():
    s = _fresh()
    s.put(0, 6, b"abc")
    code, why = s.commit(6)
    assert code == "Incomplete" and "3 of 6" in why, why
    assert s.state == "idle" and not _exists()
    _one_alert("commit")


def test_commit_with_nothing_under_way_is_illegal():
    s = _fresh()
    assert s.commit(4)[0] == "Incomplete"
    _one_alert("commit")


def test_a_table_this_side_cant_run_is_refused():
    try:
        statemachine.check("board.stream", ("startsOver",), ())
        assert False, "a table naming unimplemented guards and actions must be refused"
    except ValueError as e:
        assert "continues" in str(e), e


minitest.run(
    [
        test_offset_0_from_idle_starts_receiving,
        test_next_piece_then_commit,
        test_any_piece_may_be_sent_again,
        test_offset_0_always_starts_over,
        test_write_failure_moves_to_failed_and_repeats_until_offset_0,
        test_before_start_failure_is_recorded,
        test_abandon_removes_the_file,
        test_stored_offset_reports_progress_only_while_receiving,
        test_gap_is_illegal_and_keeps_the_state,
        test_different_total_is_illegal,
        test_piece_past_the_end_is_illegal,
        test_nonzero_offset_while_idle_is_illegal,
        test_incomplete_commit_is_illegal_and_ends_the_stream,
        test_commit_with_nothing_under_way_is_illegal,
        test_a_table_this_side_cant_run_is_refused,
    ]
)
