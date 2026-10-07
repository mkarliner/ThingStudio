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
import sys
import tempfile
import time

from hil_common import DutLink, F64_PREFIX, WitnessLink, compile_flow, deploy_message  # noqa: E402


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

    dut.send_message(deploy_message(dut, mpy_cross, tmpdir, source, bytecode))

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
    confirm the listener logs and recovers rather than dying." Sends one
    complete, self-contained malformed frame (a real length header that
    exactly matches the bytes sent, with a garbage/wrong-shape body) --
    NOT a truncated one: framing.py (matching framing.ts's own documented
    design) treats a genuinely truncated frame as "waiting for more
    bytes", not an error, so anything sent right after gets consumed as
    that same frame's continuation rather than parsed fresh -- a real,
    accepted protocol limitation (no resync marker) this task's own first
    hardware run surfaced by picking the wrong kind of "malformed" input
    here. A complete garbage-content frame is both a faithful regression
    case (POC-D's actual historical bug was an old listener choking on a
    binary frame *shape* it didn't understand, not a truncated one) and
    doesn't desync anything that follows -- same shape
    check_fault_injection_soak already uses successfully, and the same
    fixture framing.adversarial.test.ts's own "garbage payload... still
    framed correctly" case uses.
    """
    # length=4 (type + 3 payload bytes), type=DEPLOY(2), 3 garbage payload
    # bytes -- not valid CBOR, but a complete, correctly-bounded frame.
    malformed_frame = bytes([0x00, 0x04, 0x02, 0xAA, 0xBB, 0xCC])
    dut.send_raw_line(F64_PREFIX + base64.b64encode(malformed_frame).decode("ascii"))

    ok_source = "import runtime\nasync def _flow_0():\n    print('HIL_RECOVERY_CHECK_OK')\nruntime.spawn(_flow_0(), '1')\n"
    bytecode = compile_flow(mpy_cross, tmpdir, "flow_recovery", ok_source)
    dut.send_message(deploy_message(dut, mpy_cross, tmpdir, ok_source, bytecode))
    ack = dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK after a malformed-frame recovery")
    results.append(("listener hardening: recovers from a malformed mid-transfer frame and still deploys", ack is not None, ack))


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
        # A small pacing delay -- this task's own first hardware run sent
        # all 50 lines back-to-back with zero delay and saw corrupted-
        # looking lines partway through (e.g. a bare "F64" with no
        # payload, two lines' bytes fused together) that don't match any
        # bug in the receive-side parsing (framing.py/cbor.py both bounds-
        # check everything and log cleanly on real malformed input) --
        # consistent with the ESP32-C3's small USB-CDC RX buffer
        # overflowing under an unpaced 50-line burst before the device-side
        # loop can drain it, a transport/hardware limit no amount of
        # application-level hardening can defend against. This test's
        # actual question is "does the listener survive 50 malformed
        # frames without dying", not "can it survive a burst rate that
        # exceeds the physical RX buffer" -- pacing tests the former
        # without conflating it with the latter.
        time.sleep(0.02)

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
    dut.send_message(deploy_message(dut, mpy_cross, tmpdir, ok_source, bytecode))
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
            # This board class has no auto-reset-on-serial-open circuit
            # (confirmed on real hardware during this task's own bring-up,
            # same quirk pocs/poc-d/README.md documents) -- HELLO is sent
            # exactly once, at boot, so opening this connection is not
            # itself a "connect" event the DUT can react to. Rather than
            # race a boot-time HELLO that may have already fired before
            # this script started listening, discard whatever's sitting in
            # the OS-level input buffer from before this connection and
            # prompt for a physical reset now, so the HELLO wait below is
            # actually waiting for something that hasn't happened yet.
            dut.ser.reset_input_buffer()
            input("Press the DUT board's physical RESET button now, then press Enter here to continue...")
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
