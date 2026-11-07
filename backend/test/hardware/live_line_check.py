#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# backend/test/hardware/live_line_check.py
#
# Manual real-hardware pass: sit on a board's serial port in place of the editor, with the listener and its
# flow running, and check every protocol line the board sends. Written 2026-11-07 for the Freenove FNK0104S
# (ESP32-S3, native USB CDC), where large messages from the board arrive mangled in normal use.
#
# s3_cdc_tx_pass.py showed the USB link itself is clean at a bare prompt (8 KB bursts intact) and that the
# only mangling it could provoke needs DTR low. So the remaining difference is a running flow. This
# catches a bad line in the act and keeps the raw bytes, which say which mechanism it is:
#   - non-base64 text inside an F64 line  -> something else printed into the middle of it (interleaving)
#   - clean base64, frame shorter than its length header says -> bytes dropped
#   - start missing / stale bytes at the end -> the TX FIFO overwrite seen with DTR low
#
# Three phases, each just listening and checking:
#   1. passive   -- whatever the running flow sends (NODE_STATUS, NODE_ERROR, printed lines)
#   2. soft reset -- sends RESTART hard=false, captures the boot HELLO and the flow starting up
#   3. hard reset -- sends RESTART hard=true, reopens the port when the board re-enumerates, same again
# RESTART frames are copied from interfaces/protocol/vectors/messages.json (RESTART-27 / RESTART-28),
# wrapped as the backend wraps them (line_framing.py): "F64:" + base64(frame) + "\n". Nothing else is sent.
#
# Not part of pytest; needs a real board with the runtime and a flow on it, ideally the one you saw the
# mangling with. Disconnect the editor first (the backend must not have the port open). From the repo root:
#
#     .venv/bin/python backend/test/hardware/live_line_check.py [port] [--passive SECONDS]
#
# Default 30 s passive, then ~20 s per reset phase. Use the board as you normally would during the passive
# phase (touch the screen, trigger whatever produced the big message). Paste the FULL RESULTS block back.

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import time
from pathlib import Path

import serial
from serial.tools import list_ports

BAUD = 115200
REPO = Path(__file__).resolve().parents[3]
RESTART_SOFT = b"F64:" + base64.b64encode(bytes.fromhex("000813a16468617264f4")) + b"\n"
RESTART_HARD = b"F64:" + base64.b64encode(bytes.fromhex("000813a16468617264f5")) + b"\n"
B64_CHARS = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")


def type_names() -> dict[int, str]:
    try:
        spec = json.loads((REPO / "interfaces/protocol/messages.json").read_text())
        return {m["id"]: m["name"] for m in spec["messages"]}
    except Exception:  # noqa: BLE001 -- names are a nicety
        return {}


NAMES = type_names()


def check_f64(line: bytes) -> dict:
    """line is one whole line without its newline, starting with F64:."""
    payload = line[4:].rstrip(b"\r")
    row: dict = {"line_len": len(line)}
    bad = [(i, b) for i, b in enumerate(payload) if b not in B64_CHARS]
    if bad:
        i = bad[0][0]
        row.update(ok=False, why="non-base64 bytes inside the line (something else wrote into it?)",
                   first_bad_at=i, around=repr(payload[max(0, i - 30): i + 60]), n_bad=len(bad))
        return row
    try:
        frame = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        row.update(ok=False, why=f"base64 doesn't decode ({exc}) -- usually a length that's not a multiple of 4, i.e. bytes missing")
        return row
    if len(frame) < 3:
        row.update(ok=False, why=f"frame only {len(frame)} bytes")
        return row
    declared = int.from_bytes(frame[:2], "big") + 2
    t = frame[2]
    row.update(type=NAMES.get(t, f"type {t}"), frame_len=len(frame), declared_len=declared)
    if declared != len(frame):
        row.update(ok=False, why=f"frame is {len(frame)} B but its header says {declared} B ({declared - len(frame):+d})")
        return row
    if t not in NAMES and NAMES:
        row.update(ok=False, why=f"unknown type id {t} (start of frame lost?)")
        return row
    row["ok"] = True
    return row


class Capture:
    def __init__(self) -> None:
        self.buf = b""
        self.rows: list[dict] = []
        self.console: list[str] = []

    def feed(self, data: bytes, phase: str) -> None:
        self.buf += data
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            self.handle(line.rstrip(b"\r"), phase)

    def handle(self, line: bytes, phase: str) -> None:
        idx = line.find(b"F64:")
        if idx == -1:
            if line.strip():
                self.console.append(f"[{phase}] {line[:160].decode(errors='replace')}")
                if any(c in B64_CHARS for c in line) and len(line) > 60 and all(c in B64_CHARS for c in line.strip()):
                    self.rows.append({"phase": phase, "ok": False, "why": "a long base64-looking line with no F64: prefix (start of an F64 line lost?)",
                                      "line_len": len(line), "raw": repr(line[:300])})
                    print(f"  [{phase}] BAD  no-prefix base64 line, {len(line)} B")
            return
        if idx > 0:
            self.console.append(f"[{phase}] (text before F64 on one line) {line[:idx][:120].decode(errors='replace')}")
        row = {"phase": phase, **check_f64(line[idx:])}
        if idx > 0:
            row.update(ok=False, why=f"{idx} B of other text in front of F64: on the same line -- " + row.get("why", "frame itself fine"),
                       text_before=repr(line[:idx][:120]))
        if not row["ok"]:
            row["raw"] = repr(line[:600]) + (" ..." if len(line) > 600 else "")
        self.rows.append(row)
        label = row.get("type", "?")
        print(f"  [{phase}] {'ok  ' if row['ok'] else 'BAD '} {label:20} {row['line_len']:6} B" + ("" if row["ok"] else f"  {row['why']}"))


def open_port(path: str, wait_s: float = 20) -> serial.Serial:
    deadline = time.monotonic() + wait_s
    while True:
        try:
            return serial.Serial(path, baudrate=BAUD, timeout=0.2, write_timeout=5)  # pyserial defaults, as serial_relay.py
        except (serial.SerialException, OSError):
            if time.monotonic() > deadline:
                raise
            time.sleep(0.3)


def listen(ser: serial.Serial, cap: Capture, phase: str, seconds: float, path: str) -> serial.Serial:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            data = ser.read(max(ser.in_waiting, 1))
        except (serial.SerialException, OSError):
            print(f"  [{phase}] port went away -- reopening")
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1)
            ser = open_port(path)
            continue
        if data:
            cap.feed(data, phase)
    return ser


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?")
    ap.add_argument("--passive", type=float, default=30)
    ap.add_argument("--after-reset", type=float, default=20)
    args = ap.parse_args()
    path = args.port
    if not path:
        ports = sorted(list_ports.comports(), key=lambda p: p.vid is None)
        for i, p in enumerate(ports):
            print(f"  [{i}] {p.device}  {p.description}")
        path = ports[int(input("Port number: ").strip())].device
    print(f"\nUsing {path}. The editor/backend must not have it open.\n")

    cap = Capture()
    ser = open_port(path)
    print(f"== passive, {args.passive:.0f} s -- use the board normally now")
    ser = listen(ser, cap, "passive", args.passive, path)

    print("== soft reset (RESTART hard=false)")
    ser.write(RESTART_SOFT)
    ser = listen(ser, cap, "soft reset", args.after_reset, path)

    print("== hard reset (RESTART hard=true)")
    ser.write(RESTART_HARD)
    time.sleep(0.3)
    ser = listen(ser, cap, "hard reset", args.after_reset, path)
    if cap.buf:
        cap.handle(cap.buf, "end (no newline)")
    ser.close()

    f64 = [r for r in cap.rows if "type" in r or not r["ok"]]
    bad = [r for r in cap.rows if not r["ok"]]
    print(f"\n{len(f64)} protocol lines, {len(bad)} bad.")
    print("\n===== FULL RESULTS (paste this back to Claude) =====")
    print(json.dumps({"port": path, "host": os.uname().sysname, "bad": bad,
                      "all_lines": [{k: r.get(k) for k in ("phase", "type", "line_len", "ok")} for r in cap.rows],
                      "console": cap.console[-80:]}, indent=1))
    print("===== END FULL RESULTS =====")


if __name__ == "__main__":
    main()
