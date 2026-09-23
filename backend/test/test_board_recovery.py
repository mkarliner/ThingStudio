# SPDX-License-Identifier: Apache-2.0
# backend/test/test_board_recovery.py -- "Remove flow from board" (board_recovery.py), fake ports.

from __future__ import annotations

import pytest

from thingstudio_backend import board_recovery
from thingstudio_backend.raw_repl import RawReplError

_BANNER = b"raw REPL; CTRL-B to exit\r\n>"
_OK_REMOVED = b"OK" + b"THINGSTUDIO_FLOW_REMOVED\r\n" + b"\x04" + b"\x04>"


class _Port:
    """Scripted port: read() pops the next chunk (b"" = nothing this poll); a chunk that is an
    Exception is raised instead, like pyserial when the device disappears."""

    def __init__(self, script):
        self.script = list(script)
        self.written: list[bytes] = []
        self.closed = False

    def write(self, data):
        self.written.append(data)
        return len(data)

    def read(self, size=1):
        if not self.script:
            return b""
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        self.closed = True


def _opener(*ports):
    """Returns an open_port() that hands out the given ports in order; None entries raise, like a
    port that hasn't come back after a reset yet."""
    queue = list(ports)
    opened = []

    def open_port():
        p = queue.pop(0)
        if p is None:
            raise OSError(2, "No such file or directory")
        opened.append(p)
        return p

    return open_port, opened


def test_removes_the_flow_from_a_board_already_at_the_prompt():
    port = _Port([b"\r\n>>> ", _BANNER, _OK_REMOVED])
    open_port, _ = _opener(port)
    board_recovery.remove_flow(open_port, timeout_s=2, on_status=lambda _t: None)
    sent = b"".join(port.written)
    assert b"os.remove" in sent and b"/_flow.mpy" in sent and b"/_boot_count" in sent
    assert b"machine.reset()" in sent
    assert port.closed


def test_keeps_interrupting_until_a_boot_window_and_asks_for_a_reset():
    port = _Port([b"", b"LISTENER_READY\r\n", b"", b"KeyboardInterrupt\r\n>>> ", _BANNER, _OK_REMOVED])
    open_port, _ = _opener(port)
    status: list[str] = []
    board_recovery.remove_flow(open_port, timeout_s=2, on_status=status.append)
    assert sum(1 for w in port.written if w == b"\x03") >= 4  # kept sending Ctrl-C
    assert any("reset button" in s for s in status)


def test_reopens_a_port_that_vanished_across_the_reset():
    gone = _Port([b"", OSError(6, "Device not configured")])
    back = _Port([b"KeyboardInterrupt\r\n>>> ", _BANNER, _OK_REMOVED])
    open_port, opened = _opener(gone, None, back)
    board_recovery.remove_flow(open_port, timeout_s=3, on_status=lambda _t: None)
    assert opened == [gone, back]
    assert gone.closed and back.closed


def test_gives_up_with_an_attributed_error():
    port = _Port([])  # never answers
    open_port, _ = _opener(port)
    with pytest.raises(RawReplError) as info:
        board_recovery.remove_flow(open_port, timeout_s=0.3, on_status=lambda _t: None)
    assert info.value.step == board_recovery.CATCH_STEP
    assert "press its reset button" in str(info.value)
    assert port.closed
