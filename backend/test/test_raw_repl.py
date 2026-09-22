# SPDX-License-Identifier: Apache-2.0
# backend/test/test_raw_repl.py
#
# Unit tests for raw_repl.py against a fake serial port -- no real hardware needed for this
# layer's own protocol logic (framing, timeouts, fault attribution), same "fake the narrow
# surface actually used" approach test_serial_relay.py's _FakeSerial already established.
# Real device behavior (actual raw-REPL timing/quirks across boards) still needs a real-
# hardware pass -- see this module's own header and
# docs/working-notes/outstanding-items/deploy-runtime-from-editor.md.

from __future__ import annotations

import base64

import pytest

from thingstudio_backend.raw_repl import (
    RawReplError,
    RawReplTimeouts,
    enter_raw_repl,
    exec_raw,
    hard_reset,
    install_runtime,
    write_file_chunked,
)

_BANNER = b"raw REPL; CTRL-B to exit\r\n>"
_FAST = RawReplTimeouts(enter=0.2, exec_default=0.2)


class _FakePort:
    """Stands in for a real serial.Serial -- read() pops pre-scripted response chunks in order
    regardless of the requested size (tests control chunking explicitly where it matters, e.g.
    test_enter_raw_repl_accumulates_across_reads), write() just records everything sent."""

    def __init__(self, script: list[bytes] | None = None) -> None:
        self.written: list[bytes] = []
        self._script: list[bytes] = list(script or [])

    def write(self, data: bytes) -> int | None:
        self.written.append(data)
        return len(data)

    def read(self, size: int = 1) -> bytes:
        if self._script:
            return self._script.pop(0)
        return b""


def _ok_response(stdout: bytes = b"", stderr: bytes = b"") -> bytes:
    """One exec_raw()'s worth of device reply: OK echo, stdout, a marker, stderr, a marker."""
    return b"OK" + stdout + b"\x04" + stderr + b"\x04"


def test_enter_raw_repl_success() -> None:
    port = _FakePort([b"\r\n" + _BANNER])
    enter_raw_repl(port, _FAST)
    assert port.written == [b"\x03", b"\x03", b"\x01"]


def test_enter_raw_repl_accumulates_across_reads() -> None:
    # The banner split across two separate read() calls -- confirms _read_until actually
    # accumulates rather than only checking the first chunk it gets.
    port = _FakePort([b"\r\nraw REPL; ", b"CTRL-B to exit\r\n>"])
    enter_raw_repl(port, _FAST)  # doesn't raise


def test_enter_raw_repl_timeout_names_the_step_and_what_was_seen() -> None:
    port = _FakePort([b"garbage, no banner ever arrives"])
    with pytest.raises(RawReplError) as exc_info:
        enter_raw_repl(port, _FAST)
    assert exc_info.value.step == "entering raw REPL"
    assert "garbage" in str(exc_info.value)


def test_exec_raw_returns_stdout_and_consumes_empty_stderr() -> None:
    port = _FakePort([_ok_response(stdout=b"hello")])
    out = exec_raw(port, b"print('hello')", "a test step", timeout=_FAST.exec_default)
    assert out == b"hello"


def test_exec_raw_raises_on_nonempty_stderr() -> None:
    port = _FakePort([_ok_response(stderr=b"Traceback: NameError")])
    with pytest.raises(RawReplError) as exc_info:
        exec_raw(port, b"undefined_name", "a test step", timeout=_FAST.exec_default)
    assert exc_info.value.step == "a test step"
    assert "NameError" in str(exc_info.value)


def test_exec_raw_raises_if_ok_echo_never_arrives() -> None:
    port = _FakePort([b"not the OK we expected"])
    with pytest.raises(RawReplError):
        exec_raw(port, b"1+1", "a test step", timeout=_FAST.exec_default)


def test_write_file_chunked_round_trips_data_through_base64_execs() -> None:
    data = bytes(range(256)) * 2  # 512 bytes -- forces 2 chunks at the default 256-byte size
    port = _FakePort([_ok_response(), _ok_response(), _ok_response(), _ok_response()])  # open, chunk1, chunk2, close
    write_file_chunked(port, "runtime.py", data, "pushing runtime.py")

    open_call = port.written[0].decode()
    assert open_call == "f=open('runtime.py','wb')"

    # Each chunk write is "import ubinascii\nf.write(ubinascii.a2b_base64(b'<...>'))" -- decode
    # the base64 literal back out and confirm it round-trips to the real bytes, not just that
    # *some* base64 call was made.
    chunk_writes = [w for w in port.written if b"a2b_base64" in w]
    assert len(chunk_writes) == 2
    decoded = b""
    for call in chunk_writes:
        literal_start = call.index(b"b'") + 2
        literal_end = call.rindex(b"'")
        decoded += base64.b64decode(call[literal_start:literal_end])
    assert decoded == data

    # exec_raw() sends code and its trailing Ctrl-D as two separate write() calls, so the code
    # itself is second-to-last, not last.
    assert port.written[-2] == b"f.close()"
    assert port.written[-1] == b"\x04"


def test_hard_reset_writes_reset_code_and_ctrl_d_without_reading() -> None:
    port = _FakePort()
    hard_reset(port)
    assert port.written == [b"import machine\nmachine.reset()", b"\x04"]


def test_install_runtime_pushes_every_file_in_order_then_resets() -> None:
    files = [("errors.py", b"errors source"), ("runtime.py", b"runtime source"), ("main.py", b"listener source")]
    # Banner for enter_raw_repl, then 3 execs per file (open/chunk/close -- each file here fits
    # in one chunk).
    port = _FakePort([b"\r\n" + _BANNER] + [_ok_response() for _ in range(3 * len(files))])

    install_runtime(port, files, _FAST)

    opens_in_order = [w.decode() for w in port.written if w.decode(errors="replace").startswith("f=open(")]
    assert opens_in_order == ["f=open('errors.py','wb')", "f=open('runtime.py','wb')", "f=open('main.py','wb')"]
    # hard_reset is the last thing sent.
    assert port.written[-2:] == [b"import machine\nmachine.reset()", b"\x04"]


def test_install_runtime_raises_and_stops_on_a_mid_push_failure() -> None:
    files = [("errors.py", b"errors source"), ("runtime.py", b"runtime source")]
    # Banner, then the first file's open+chunk+close (3 responses), then a response that isn't
    # OK -- the second file's push should fail, and the reset code (the next write after that
    # point) should never be sent.
    port = _FakePort([b"\r\n" + _BANNER, _ok_response(), _ok_response(), _ok_response(), b"NOT OK"])

    with pytest.raises(RawReplError):
        install_runtime(port, files, _FAST)

    assert not any(b"machine.reset" in w for w in port.written)
