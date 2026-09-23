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
    ENTER_STEP,
    RawReplError,
    RawReplTimeouts,
    classify_reply,
    read_available,
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
    """One exec_raw()'s worth of device reply: OK echo, stdout, a marker, stderr, a marker, then
    the fresh raw-REPL prompt a real device always sends next."""
    return b"OK" + stdout + b"\x04" + stderr + b"\x04>"


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

    # Writes are split into pieces (raw_repl._write), so reassemble whole execs: each one's code
    # ends at its Ctrl-D.
    execs = b"".join(port.written).split(b"\x04")[:-1]
    assert execs[0].decode() == "f=open('runtime.py','wb')"

    # Each chunk write is "import ubinascii\nf.write(ubinascii.a2b_base64(b'<...>'))" -- decode
    # the base64 literal back out and confirm it round-trips to the real bytes, not just that
    # *some* base64 call was made.
    chunk_writes = [e for e in execs if b"a2b_base64" in e]
    assert len(chunk_writes) == 2
    decoded = b""
    for call in chunk_writes:
        literal_start = call.index(b"b'") + 2
        literal_end = call.rindex(b"'")
        decoded += base64.b64decode(call[literal_start:literal_end])
    assert decoded == data

    assert execs[-1] == b"f.close()"
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


def test_enter_raw_repl_timeout_keeps_everything_seen_for_diagnosis() -> None:
    port = _FakePort([b"ESP-ROM:esp32s2-rc4-20191025\r\nwaiting for download\r\n"])
    with pytest.raises(RawReplError) as info:
        enter_raw_repl(port, _FAST)
    assert info.value.step == ENTER_STEP
    assert b"waiting for download" in info.value.seen


@pytest.mark.parametrize(
    ("seen", "expected"),
    [
        (b"", "silent"),
        (b"\r\n  \r\n", "silent"),
        (b"\r\nMicroPython v1.24.1 on 2024-11-29; ESP32S2 module with ESP32S2\r\n>>> ", "micropython"),
        (b'Traceback (most recent call last):\r\n  File "<stdin>", line 1\r\nSyntaxError: invalid syntax\r\n', "micropython"),
        (b"\r\nAdafruit CircuitPython 9.1.4 on 2024-09-17; ...\r\n>>> ", "circuitpython"),
        (b"ESP-ROM:esp32s2-rc4-20191025\r\nwaiting for download\r\n", "esp_rom"),
        (b"ets Jun  8 2016 00:22:57\r\n\r\nrst:0x1 (POWERON_RESET)", "esp_rom"),
        (b"Hello from Arduino loop 42\r\n", "other"),
    ],
)
def test_classify_reply(seen: bytes, expected: str) -> None:
    assert classify_reply(seen) == expected


class _StuckPort(_FakePort):
    """write() raises the way pyserial does when write_timeout expires on a board that stopped reading."""

    def __init__(self, fail_after: int) -> None:
        super().__init__()
        self._fail_after = fail_after

    def write(self, data: bytes) -> int | None:
        if len(self.written) >= self._fail_after:
            raise TimeoutError("Write timeout")
        return super().write(data)


def test_a_stuck_write_becomes_an_attributed_error_not_a_hang() -> None:
    port = _StuckPort(fail_after=3)  # enter_raw_repl's three writes succeed, the first exec's doesn't
    port._script = [_BANNER]
    with pytest.raises(RawReplError) as info:
        install_runtime(port, [("runtime.py", b"x = 1\n")], _FAST)
    assert "pushing runtime.py" in str(info.value)
    assert "stopped accepting data" in str(info.value)


def test_long_pastes_are_split_into_pieces() -> None:
    code = b"a" * 600
    port = _FakePort([_ok_response()])
    exec_raw(port, code, "big", timeout=0.2)
    assert [len(w) for w in port.written] == [256, 256, 88, 1]  # three pieces, then Ctrl-D
    assert b"".join(port.written[:3]) == code


def test_install_reports_progress_per_file() -> None:
    files = [("a.py", b"1"), ("b.py", b"2")]
    # enter, then per file: open, one chunk, close
    port = _FakePort([_BANNER] + [_ok_response()] * 6)
    seen: list[tuple[int, int, str]] = []
    install_runtime(port, files, _FAST, on_progress=lambda i, n, name: seen.append((i, n, name)))
    assert seen == [(1, 2, "a.py"), (2, 2, "b.py")]


def test_read_available_does_not_ask_for_more_than_is_waiting() -> None:
    class _Port(_FakePort):
        def __init__(self, waiting: int) -> None:
            super().__init__([b"OK\x04\x04"])
            self.in_waiting = waiting
            self.sizes: list[int] = []

        def read(self, size: int = 1) -> bytes:
            self.sizes.append(size)
            return super().read(size)

    idle = _Port(0)
    read_available(idle, 256)
    assert idle.sizes == [1]  # nothing buffered: wait for one byte, not 256
    busy = _Port(4)
    read_available(busy, 256)
    assert busy.sizes == [4]
    flood = _Port(10_000)
    read_available(flood, 256)
    assert flood.sizes == [256]


def test_a_lost_connection_mid_read_is_attributed_to_the_step() -> None:
    class _Gone(_FakePort):
        def read(self, size: int = 1) -> bytes:
            raise OSError(6, "Device not configured")

    with pytest.raises(RawReplError) as info:
        exec_raw(_Gone(), b"x=1", "pushing runtime.py (chunk 3 of 9)", timeout=0.2)
    assert "pushing runtime.py (chunk 3 of 9)" in str(info.value)
    assert "lost the connection" in str(info.value)


def test_the_prompt_after_each_exec_is_consumed_even_when_it_arrives_separately() -> None:
    """Real ESP32-S2 case, 2026-09-23: the trailing '>' arrived in its own read and was left behind
    for the next exec, failing it with "unexpected bytes before OK echo: b'>OK'"."""
    port = _FakePort([b"OK", b"\x04", b"\x04", b">", b"OK", b"\x04", b"\x04", b">"])
    exec_raw(port, b"a=1", "first", timeout=0.5)
    exec_raw(port, b"b=2", "second", timeout=0.5)  # must not see a stray '>' first
