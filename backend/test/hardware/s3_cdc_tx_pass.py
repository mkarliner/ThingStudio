#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# backend/test/hardware/s3_cdc_tx_pass.py
#
# Manual real-hardware pass: do large board->host writes over an ESP32-S3's native USB (TinyUSB CDC)
# arrive intact? Written 2026-11-07 for the Freenove FNK0104S (stock ESP32_GENERIC_S3 MicroPython),
# where large messages from the board were arriving mangled.
#
# What the MicroPython source says can go wrong (shared/tinyusb/mp_usbd_cdc.c, mp_usbd_cdc_tx_strn):
#   case 1 -- if TinyUSB thinks DTR is NOT asserted, the whole write goes into the 256-byte TX FIFO in
#             one go with overwrite on: only the last ~256 bytes survive (START of the line lost).
#             Same symptom as upstream micropython#18029 (S3, `print("0123"*64)`).
#   case 2 -- if DTR is asserted but the host stops draining for 500 ms (MICROPY_HW_USB_CDC_TX_TIMEOUT),
#             the rest of the write is dropped (END or MIDDLE lost); the short count is returned.
#
# For each board state below it writes known-pattern lines of several sizes two ways:
#   whole   -- one sys.stdout.write(line), exactly what listener.py's _send_message() does today
#   chunked -- sys.stdout.buffer.write() in 64-byte pieces, retrying short writes, 1 ms between pieces
#              (the candidate fix: no single write can overrun the FIFO)
# and reports whether each came back intact, lost its start / middle / end, or came back garbled.
#
# Board states: as found; after the port is closed and reopened; after a soft reset (Ctrl-D, listener
# restarts -- the S3's CDC state is suspected of going stale here); with DTR held low (deliberately
# provokes case 1, to confirm the mechanism); after a hard reset (machine.reset(), re-enumerates).
#
# Gets to the prompt the way the editor does: a STOP_TO_PROMPT protocol line first (the listener switches
# Ctrl-C off -- kbd_intr(-1) -- so Ctrl-C alone gets nothing back), then the backend's own raw-REPL client
# (raw_repl.py). Leaves the board soft-reset at the end, so the listener is running again.
#
# Not part of pytest (no test_ prefix); needs a real board. Run in a real Terminal, NOT the agent
# sandbox (it has no USB access), with the editor/backend disconnected from the board first (the port
# is exclusive):
#
#     cd <repo root>                                      # the venv is the repo-root .venv that `make` builds
#     .venv/bin/python backend/test/hardware/s3_cdc_tx_pass.py            # pick the port from a list
#     .venv/bin/python backend/test/hardware/s3_cdc_tx_pass.py /dev/cu.usbmodem1101
#
# Takes about a minute. Paste the FULL RESULTS block it prints back to Claude.

from __future__ import annotations

import base64
import difflib
import json
import os
import sys
import time
from pathlib import Path

import serial
from serial.tools import list_ports

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from thingstudio_backend.raw_repl import RawReplError, RawReplTimeouts, enter_raw_repl, exec_raw  # noqa: E402

BAUD = 115200
SIZES = [200, 300, 1024, 4096]
BURST_LINES, BURST_SIZE = 8, 1024
EXEC_TIMEOUT = 20.0  # generous: a case-2 drop costs 500 ms per stall
ENTER = RawReplTimeouts(enter=10.0)  # a running GUI flow can take a moment to notice Ctrl-C
TRAILER = b"\x1eR:"
# STOP_TO_PROMPT, exactly as the backend sends it: "F64:" + base64(frame) + "\n" (line_framing.py), the frame
# copied from interfaces/protocol/vectors/messages.json ("STOP_TO_PROMPT-18", frameHex 00020da0).
STOP_TO_PROMPT_LINE = b"F64:" + base64.b64encode(bytes.fromhex("00020da0")) + b"\n"
LISTENER_BOOT_S = 8  # after a reset: let the listener come up (and its Ctrl-C window close) before stopping it  # separates the test's own output from the write-count report after it

# Board-side helpers, sent with every exec (a soft reset clears globals). B(n) must match body(n) below.
_BOARD_PRELUDE = """\
import sys,time
def B(n):
 return ''.join('%05d,'%i for i in range(n//6+1))[:n]
def W(s):
 return sys.stdout.write(s)
def C(s):
 b=s.encode();i=0;tries=0
 while i<len(b):
  k=sys.stdout.buffer.write(b[i:i+64]) or 0
  if k:
   i+=k;tries=0
  else:
   tries+=1
   if tries>500:
    break
  time.sleep_ms(1)
 return i
"""


def body(n: int) -> str:
    return "".join("%05d," % i for i in range(n // 6 + 1))[:n]


def single_test(n: int, method: str) -> tuple[str, bytes, bytes]:
    fn = "W" if method == "whole" else "C"
    code = _BOARD_PRELUDE + f"r={fn}(B({n})+'\\n')\nsys.stdout.write('\\x1eR:%s'%r)\n"
    return f"{n} B {method}", code.encode(), (body(n) + "\n").encode()


def burst_test(method: str) -> tuple[str, bytes, bytes]:
    fn = "W" if method == "whole" else "C"
    code = _BOARD_PRELUDE + (
        f"t=0\nfor j in range({BURST_LINES}):\n t+={fn}('B%d:'%j+B({BURST_SIZE})+':B%d\\n'%j)\n"
        "sys.stdout.write('\\x1eR:%s'%t)\n"
    )
    expected = "".join(f"B{j}:{body(BURST_SIZE)}:B{j}\n" for j in range(BURST_LINES))
    return f"burst {BURST_LINES}x{BURST_SIZE} B {method}", code.encode(), expected.encode()


def all_tests() -> list[tuple[str, bytes, bytes]]:
    tests = [single_test(n, m) for n in SIZES for m in ("whole", "chunked")]
    tests += [burst_test("whole"), burst_test("chunked")]
    return tests


def dtr_low_tests() -> list[tuple[str, bytes, bytes]]:
    return [single_test(300, "whole"), single_test(1024, "whole"), single_test(1024, "chunked")]


def analyse(expected: bytes, got: bytes) -> dict:
    """Classifies what arrived against what was sent. difflib, not a prefix/suffix scan: the digit
    pattern repeats short runs, which fools a byte-by-byte match into seeing a gap in the wrong place."""
    if got == expected:
        return {"result": "intact"}
    info: dict = {"expected_len": len(expected), "got_len": len(got)}
    if not got:
        return {"result": "nothing arrived", **info}
    ops = difflib.SequenceMatcher(None, expected, got, autojunk=False).get_opcodes()
    gaps = [(i1, i2 - i1) for tag, i1, i2, _, _ in ops if tag == "delete"]
    other = [(tag, i1, repr(got[j1:j2][:60])) for tag, i1, i2, j1, j2 in ops if tag in ("insert", "replace")]
    if other:
        return {"result": "GARBLED (wrong or extra bytes, not just a drop)", "first_bad": other[:5], "gaps_offset_len": gaps[:20], **info}
    lost = len(expected) - len(got)
    if len(gaps) == 1:
        off, n = gaps[0]
        where = "START" if off == 0 else "END" if off + n == len(expected) else "MIDDLE"
        return {"result": f"lost {lost} B from the {where}", "gap_offset": off, **info}
    return {"result": f"lost {lost} B in {len(gaps)} pieces", "gaps_offset_len": gaps[:20], **info}


def run_one(ser: serial.Serial, scenario: str, test: tuple[str, bytes, bytes]) -> dict:
    name, code, expected = test
    row: dict = {"scenario": scenario, "test": name}
    try:
        out = exec_raw(ser, code, f"{scenario}: {name}", timeout=EXEC_TIMEOUT).replace(b"\r\n", b"\n")
        got, sep, reported = out.rpartition(TRAILER)
        if not sep:
            got, reported = out, b"?"
        row.update(analyse(expected, got))
        row["board_reported_written"] = reported.decode(errors="replace").strip()
    except RawReplError as exc:
        row["result"] = f"ERROR: {exc}"
        row["seen_tail"] = repr(exc.seen[-200:])
        _recover(ser)
    print(f"  {name:32} {row['result']}" + (f"  (board says wrote {row['board_reported_written']})" if "board_reported_written" in row else ""))
    return row


def _recover(ser: serial.Serial) -> None:
    try:
        time.sleep(0.5)
        ser.reset_input_buffer()
        enter_raw_repl(ser, ENTER)
    except Exception as exc:  # noqa: BLE001 -- best effort; the next test reports its own failure
        print(f"  (couldn't get back into raw REPL: {exc})")


def get_to_raw_repl(ser: serial.Serial) -> str:
    """Stops a running listener with STOP_TO_PROMPT, then enters raw REPL. Harmless on a board already at
    a prompt (the line is just a SyntaxError there, and enter_raw_repl's Ctrl-C clears it). Returns what
    the board said, for the record."""
    ser.reset_input_buffer()
    ser.write(STOP_TO_PROMPT_LINE)
    seen, deadline = b"", time.monotonic() + 6
    while time.monotonic() < deadline and b"LISTENER_STOPPED" not in seen and b">>>" not in seen:
        seen += ser.read(max(ser.in_waiting, 1))
    said = "listener stopped" if b"LISTENER_STOPPED" in seen else "at a prompt" if b">>>" in seen else f"no answer to STOP_TO_PROMPT (saw {seen[-120:]!r})"
    print(f"  ({said})")
    time.sleep(0.3)
    enter_raw_repl(ser, ENTER)
    return said


def open_port(path: str) -> serial.Serial:
    # Same settings as serial_relay.py: pyserial's defaults, so DTR/RTS asserted on open.
    deadline = time.monotonic() + 15
    while True:
        try:
            return serial.Serial(path, baudrate=BAUD, timeout=0.5, write_timeout=5)
        except (serial.SerialException, OSError):
            if time.monotonic() > deadline:
                raise
            time.sleep(0.5)


def close_quietly(ser: serial.Serial) -> None:
    try:
        ser.close()
    except Exception:  # noqa: BLE001
        pass


def board_info(ser: serial.Serial) -> str:
    try:
        out = exec_raw(ser, b"import sys,os\nprint(os.uname())\nprint(getattr(sys.implementation,'_machine','?'))", "board info")
        return out.decode(errors="replace").strip()
    except RawReplError as exc:
        return f"(couldn't read: {exc})"


def pick_port() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    ports = sorted(list_ports.comports(), key=lambda p: p.vid is None)
    if not ports:
        sys.exit("No serial ports found. Is the board plugged in?")
    for i, p in enumerate(ports):
        print(f"  [{i}] {p.device}  {p.description}")
    choice = input("Port number: ").strip()
    return ports[int(choice)].device


def main() -> None:
    path = pick_port()
    print(f"\nUsing {path}. Make sure the editor isn't connected to it.\n")
    results: list[dict] = []
    ser = open_port(path)
    get_to_raw_repl(ser)
    info = board_info(ser)
    print(f"Board: {info}\n")

    print("== as found")
    results += [run_one(ser, "as found", t) for t in all_tests()]

    print("== port closed and reopened")
    close_quietly(ser)
    time.sleep(1)
    ser = open_port(path)
    enter_raw_repl(ser, ENTER)
    results += [run_one(ser, "reopened", t) for t in all_tests()]

    print("== after soft reset (Ctrl-D; listener restarts, then interrupted)")
    ser.write(b"\x02")  # leave raw REPL
    time.sleep(0.3)
    ser.write(b"\x04")  # soft reset from the friendly REPL: boot.py + main.py, as the listener's restart does
    time.sleep(LISTENER_BOOT_S)
    try:
        get_to_raw_repl(ser)
    except RawReplError:
        close_quietly(ser)
        ser = open_port(path)
        get_to_raw_repl(ser)
    results += [run_one(ser, "after soft reset", t) for t in all_tests()]

    print("== DTR held low (diagnostic: should provoke case 1, start lost)")
    ser.dtr = False
    time.sleep(0.3)
    results += [run_one(ser, "DTR low", t) for t in dtr_low_tests()]
    ser.dtr = True
    _recover(ser)

    print("== after hard reset (machine.reset(); board re-enumerates)")
    ser.write(b"import machine\nmachine.reset()\x04")
    time.sleep(0.2)
    close_quietly(ser)
    vanished = False
    for _ in range(40):  # up to 10 s for the port to disappear
        if not os.path.exists(path):
            vanished = True
            break
        time.sleep(0.25)
    if vanished:
        for _ in range(80):  # up to 20 s to come back
            if os.path.exists(path):
                break
            time.sleep(0.25)
    ser = open_port(path)
    time.sleep(LISTENER_BOOT_S)
    get_to_raw_repl(ser)
    results += [run_one(ser, "after hard reset", t) for t in all_tests()]

    # Leave the listener running again.
    ser.write(b"\x02")
    time.sleep(0.3)
    ser.write(b"\x04")
    time.sleep(0.5)
    close_quietly(ser)

    bad = [r for r in results if r["result"] != "intact"]
    print(f"\n{len(results) - len(bad)} of {len(results)} intact.")
    print("\n===== FULL RESULTS (paste this back to Claude) =====")
    print(json.dumps({"port": path, "board": info, "pyserial": serial.VERSION, "host": os.uname().sysname,
                      "results": results}, indent=1))
    print("===== END FULL RESULTS =====")


if __name__ == "__main__":
    main()
