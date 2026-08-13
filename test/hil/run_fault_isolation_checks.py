#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test/hil/run_fault_isolation_checks.py
#
# The actual hardware-in-the-loop driver for
# docs/working-notes/validation/mvp-validation-plan.md's "Fault isolation"
# bar -- push-button once both boards are flashed and wired per
# test/hil/pin-map.md and test/hil/README.md, rather than a human typing
# into two terminal sessions. Talks to the DUT over the real §13 protocol
# (device-runtime/src/{framing,messages,protocol,cbor}.py, imported
# directly -- pure Python, no MicroPython-only syntax, same as
# device-runtime/test/test_listener_integration.py already relies on) and
# to the witness board over its own line-based command protocol
# (witness_firmware.py).
#
# IMPORTANT, stated plainly rather than glossed over: this script has NOT
# been run against real hardware in the environment that wrote it (no
# boards attached) -- test_listener_integration.py's equivalent scenarios
# (minus the witness board's independent GPIO observation) ARE verified,
# against real MicroPython over a real byte-stream pipe. This is the same
# logic adapted for pyserial and the witness rig's extra observation
# points; it needs a real run, by whoever has the boards wired, before its
# own Results entry can honestly claim more than "code complete, structure
# verified, first hardware run pending" -- exactly the convention every
# prior hardware-touching piece of this project has followed when hardware
# wasn't available in the writing session.
#
# Requires `pyserial` (not yet a tracked project dependency -- see
# docs/third-party-licenses.md's note on this file) and a native
# `mpy-cross` build (device-runtime/test/README.md has the build recipe;
# same binary, reused here to compile the tiny test flows this script
# deploys).

import argparse
import base64
import os
import sys
import tempfile
import time

try:
    import serial
except ImportError:
    print("ERR: pyserial not installed. `pip install pyserial` -- see test/hil/README.md.", file=sys.stderr)
    sys.exit(2)

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(THIS_DIR, "..", "..", "device-runtime", "src")
sys.path.insert(0, SRC_DIR)

import protocol  # noqa: E402

F64_PREFIX = "F64:"
BAUD_RATE = 115200


class DutLink:
    """Talks §13 over a real serial port to the DUT, base64/readline-framed
    per listener.py's own contract (fault-isolation-briefing.md's stated
    default) -- the pyserial equivalent of editor/src/protocol/transport.ts's
    WebSerialTransport, kept separate rather than shared since this script
    runs under plain CPython, not a browser."""

    def __init__(self, port_path, timeout_s=8):
        self.ser = serial.Serial(port_path, BAUD_RATE, timeout=timeout_s)
        self.decoder = protocol.ProtocolStreamDecoder()

    def send_message(self, message):
        frame = protocol.encode_message(message)
        line = F64_PREFIX + base64.b64encode(frame).decode("ascii") + "\n"
        self.ser.write(line.encode("ascii"))
        self.ser.flush()

    def send_raw_line(self, text):
        self.ser.write((text + "\n").encode("ascii"))
        self.ser.flush()

    def read_line(self):
        raw = self.ser.readline()
        if not raw:
            return None
        return raw.decode("utf-8", "replace").rstrip("\r\n")

    def wait_for_message(self, predicate, timeout_s, description):
        deadline = time.time() + timeout_s
        debug_lines = []
        while time.time() < deadline:
            line = self.read_line()
            if line is None:
                continue
            if not line.startswith(F64_PREFIX):
                debug_lines.append(line)
                continue
            try:
                frame = base64.b64decode(line[len(F64_PREFIX) :])
            except Exception:
                continue
            for result in self.decoder.push(frame):
                if "message" in result and predicate(result["message"]):
                    return result["message"]
        raise TimeoutError("timed out waiting for %s; debug output seen:\n%s" % (description, "\n".join(debug_lines)))

    def close(self):
        self.ser.close()


class WitnessLink:
    """Line-based command protocol client for witness_firmware.py."""

    def __init__(self, port_path, timeout_s=5):
        self.ser = serial.Serial(port_path, BAUD_RATE, timeout=timeout_s)

    def command(self, line, terminator_prefixes, timeout_s=5):
        """Sends one command line, collects reply lines until one starts
        with any of `terminator_prefixes` (inclusive)."""
        self.ser.write((line + "\n").encode("ascii"))
        self.ser.flush()
        deadline = time.time() + timeout_s
        replies = []
        while time.time() < deadline:
            raw = self.ser.readline()
            if not raw:
                continue
            text = raw.decode("utf-8", "replace").rstrip("\r\n")
            replies.append(text)
            if any(text.startswith(p) for p in terminator_prefixes):
                return replies
        raise TimeoutError("witness command %r did not complete in %ss; saw: %r" % (line, timeout_s, replies))

    def close(self):
        self.ser.close()


def compile_flow(mpy_cross, tmpdir, name, source):
    import subprocess

    py_path = os.path.join(tmpdir, name + ".py")
    mpy_path = os.path.join(tmpdir, name + ".mpy")
    with open(py_path, "w") as f:
        f.write(source)
    subprocess.run([mpy_cross, "-o", mpy_path, py_path], check=True, capture_output=True)
    with open(mpy_path, "rb") as f:
        return f.read()


def check_per_task_boundary(dut, witness, mpy_cross, tmpdir, results):
    """mvp-validation-plan.md: "deploy a multi-node flow containing one
    deliberately broken node; confirm NODE_ERROR reports the correct node
    ID and exception info, and confirm every other node/task keeps running
    unaffected." The "keeps running" half is confirmed physically here,
    not just by trusting the DUT's own output: the working chain drives
    GPIO12 (pin-map.md), and the witness's WATCH_EDGES on its paired pin
    (GPIO3) has to actually observe the transition.

    Sequencing note, worth keeping visible rather than just "getting
    right" silently: WATCH_EDGES blocks the witness for its whole
    duration_ms before replying, so it has to be armed BEFORE the DEPLOY
    that triggers the edge, not after -- and since pyserial has no async
    mode here, "armed" means writing the command line without waiting for
    its reply, sending DEPLOY next, and only then reading the WATCH_EDGES
    reply back. Getting this backwards (waiting for WATCH_EDGES's own
    reply before sending DEPLOY) would deadlock this script against the
    witness's own blocking wait.
    """
    source = (
        "import runtime\n"
        "import machine\n"
        "async def _flow_0():\n"
        "    try:\n"
        "        raise ValueError('hil check: deliberately broken')\n"
        "    except Exception as _e:\n"
        "        raise runtime.NodeError('99', _e)\n"
        "runtime.spawn(_flow_0(), '1')\n"
        "async def _flow_1():\n"
        "    _p = machine.Pin(12, machine.Pin.OUT)\n"
        "    _p.value(0)\n"
        "    _p.value(1)\n"
        "runtime.spawn(_flow_1(), '2')\n"
    )
    bytecode = compile_flow(mpy_cross, tmpdir, "flow_per_task", source)

    # Arm the witness's edge watch first (it blocks for up to 2s waiting),
    # sending the command line without blocking this script on its reply.
    witness.ser.write(b"WATCH_EDGES 3 2000\n")
    witness.ser.flush()

    dut.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})

    node_error = dut.wait_for_message(lambda m: m["type"] == "NODE_ERROR", timeout_s=5, description="NODE_ERROR from the broken chain")
    ok = node_error["nodeId"] == "99" and node_error["exceptionType"] == "ValueError"
    results.append(("per-task boundary: NODE_ERROR has correct node ID", ok, node_error))

    # Collect the witness's WATCH_EDGES reply (armed above).
    edge_lines = []
    deadline = time.time() + 3
    while time.time() < deadline:
        raw = witness.ser.readline()
        if not raw:
            continue
        text = raw.decode("utf-8", "replace").rstrip("\r\n")
        edge_lines.append(text)
        if text.startswith("EDGES_DONE") or text.startswith("EDGES_ERR"):
            break
    saw_transition = any(line.startswith("EDGE ") for line in edge_lines)
    results.append(("per-task boundary: independent chain's GPIO transition physically observed by witness", saw_transition, edge_lines))


def check_listener_hardening_regression(dut, mpy_cross, tmpdir, results):
    """mvp-validation-plan.md: "send a malformed frame mid-transfer,
    confirm the listener logs and recovers rather than dying." Sends a
    truncated §13 frame (a real length header promising more bytes than
    actually follow on the line -- i.e. valid base64 of too few bytes for
    the length it declares), then confirms a subsequent, valid DEPLOY
    still succeeds."""
    # A syntactically-plausible but truncated frame: length header says 20
    # bytes of type+body follow; only 3 are actually sent.
    truncated_frame = bytes([0x00, 0x14, 0x02, 0xAA, 0xBB])
    dut.send_raw_line(F64_PREFIX + base64.b64encode(truncated_frame).decode("ascii"))

    ok_source = "import runtime\nasync def _flow_0():\n    print('HIL_RECOVERY_CHECK_OK')\nruntime.spawn(_flow_0(), '1')\n"
    bytecode = compile_flow(mpy_cross, tmpdir, "flow_recovery", ok_source)
    dut.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
    ack = dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK after a truncated-frame recovery")
    results.append(("listener hardening: recovers from a truncated mid-transfer frame and still deploys", ack is not None, ack))


def check_fault_injection_soak(dut, witness, mpy_cross, tmpdir, results):
    """mvp-validation-plan.md: "50 consecutive malformed/garbled frames
    sent to a running device, confirm the listener task survives all 50...
    Liveness during this test must be confirmed via the witness rig's
    HEARTBEAT_WATCH, not the DUT's own printed heartbeat" -- exactly what
    this does: arm HEARTBEAT_WATCH on the witness (non-blocking send, same
    pattern as the per-task check above) before firing 50 garbage frames
    at the DUT, then read back how many transitions the witness actually
    saw independently."""
    witness.ser.write(b"HEARTBEAT_WATCH 0 3000 4\n")  # DUT heartbeat toggles every 200ms (listener.py) -- 3s should comfortably clear 4 transitions
    witness.ser.flush()

    for i in range(50):
        if i % 2 == 0:
            dut.send_raw_line(F64_PREFIX + "not-valid-base64!!!")
        else:
            garbage = base64.b64encode(bytes([i % 256]) * 5).decode("ascii")
            dut.send_raw_line(F64_PREFIX + garbage)

    heartbeat_reply = None
    deadline = time.time() + 5
    while time.time() < deadline:
        raw = witness.ser.readline()
        if not raw:
            continue
        text = raw.decode("utf-8", "replace").rstrip("\r\n")
        if text.startswith("HEARTBEAT_OK") or text.startswith("HEARTBEAT_TIMEOUT"):
            heartbeat_reply = text
            break
    results.append(("fault-injection soak: witness independently confirms DUT liveness through 50 malformed frames", heartbeat_reply is not None and heartbeat_reply.startswith("HEARTBEAT_OK"), heartbeat_reply))

    ok_source = "import runtime\nasync def _flow_0():\n    print('HIL_SOAK_SURVIVED')\nruntime.spawn(_flow_0(), '1')\n"
    bytecode = compile_flow(mpy_cross, tmpdir, "flow_soak", ok_source)
    dut.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
    ack = dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK after the 50-frame soak")
    results.append(("fault-injection soak: listener still accepts a real DEPLOY after 50 malformed frames", ack is not None, ack))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--witness-port", required=True)
    parser.add_argument("--dut-port", required=True)
    parser.add_argument("--mpy-cross", required=True, help="path to a native mpy-cross build (device-runtime/test/README.md)")
    args = parser.parse_args()

    results = []
    with tempfile.TemporaryDirectory() as tmpdir:
        dut = DutLink(args.dut_port)
        witness = WitnessLink(args.witness_port)
        try:
            dut.wait_for_message(lambda m: m["type"] == "HELLO", timeout_s=8, description="DUT's boot-time HELLO")
            pong = witness.command("PING", ["PONG", "ERR"])
            results.append(("witness responds to PING", pong and pong[-1] == "PONG", pong))

            check_per_task_boundary(dut, witness, args.mpy_cross, tmpdir, results)
            check_listener_hardening_regression(dut, args.mpy_cross, tmpdir, results)
            check_fault_injection_soak(dut, witness, args.mpy_cross, tmpdir, results)
        finally:
            dut.close()
            witness.close()

    print("=== Fault isolation HIL check results ===")
    all_ok = True
    for name, ok, detail in results:
        status = "PASS" if ok else "FAIL"
        if not ok:
            all_ok = False
        print("%s: %s" % (status, name))
        print("    %r" % (detail,))
    print("---")
    print("ALL PASS" if all_ok else "SOME FAILED -- see above")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
