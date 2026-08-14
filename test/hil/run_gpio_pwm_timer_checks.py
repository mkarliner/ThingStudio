#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test/hil/run_gpio_pwm_timer_checks.py
#
# The hardware-in-the-loop driver for Tier 1's GPIO/timer node batch
# (docs/working-notes/validation/mvp-validation-plan.md's Tier 1 "node
# set" section: "GPIO in/out, PWM, and timer nodes: hardware pass runs
# through the witness rig... non-negotiable"). Same structure and
# conventions as run_fault_isolation_checks.py (see that file's own
# header for the general pattern this follows), sharing its DUT/witness
# link classes via hil_common.py.
#
# Deploys hand-written flows that match what the real compiler
# (editor/src/compiler/compile.ts) would generate for
# gpio_in/pwm_out/timer node instances -- same approach
# check_per_task_boundary already uses in run_fault_isolation_checks.py,
# not a coincidence: this script drives real MicroPython source through
# mpy-cross and the real §13 protocol, same as that one, just exercising
# different node types.
#
# IMPORTANT, stated plainly rather than glossed over: this script has NOT
# been run against real hardware in the environment that wrote it (no
# boards attached) -- same "code complete, structure verified, first
# hardware run pending" status every prior hardware-touching piece of
# this project has carried when hardware wasn't available in the writing
# session. The node types' own codegen (gpio-in.ts/pwm-out.ts/timer.ts)
# IS off-device tested (editor/test/node-{gpio-in,pwm-out,timer}.test.ts,
# mvp-validation-plan.md's 2026-08-14 Tier 1 Results entry) -- this
# script is what closes the gap to an actual hardware pass.
#
# Requires `pyserial` and a native `mpy-cross` build -- see
# run_fault_isolation_checks.py's header for both.

import argparse
import sys
import tempfile
import time

from hil_common import DutLink, WitnessLink, compile_flow  # noqa: E402

# test/hil/pin-map.md's currently-wired rows.
DUT_GPIO_OUT_PIN = 12  # -> witness GPIO3 (WATCH_EDGES)
WITNESS_EDGE_WATCH_PIN = 3
DUT_GPIO_IN_PIN = 4  # <- witness GPIO5 (DRIVE_GPIO)
WITNESS_DRIVE_PIN = 5
DUT_PWM_PIN = 6  # -> witness GPIO7 (MEASURE_PWM)
WITNESS_PWM_WATCH_PIN = 7


def warm_up_witness_irq(witness):
    """Pays witness_firmware.py's own documented one-time cost up front:
    "a real hardware run of this task's own driver script hit a
    MemoryError... on the FIRST WATCH_EDGES/MEASURE_PWM/HEARTBEAT_WATCH
    call in a session -- almost certainly ESP32's GPIO interrupt service
    needing a one-time chunk of memory on first use... a later call using
    the identical pin.irq() pattern succeeded once that cost had already
    been paid" (witness_firmware.py's _arm_irq comment). That file's
    gc.collect()-before-arming mitigation reduces the odds but isn't a
    guaranteed fix under heap fragmentation -- this run's own first
    WATCH_EDGES call still hit it (a 9296-byte allocation failure, a
    different size than the originally-documented 16384 bytes, consistent
    with fragmentation-dependent, not deterministic). Rather than let
    that land on whichever real check happens to run first, spend it here
    on a throwaway 10ms watch on the already-wired edge-watch pin, before
    any check that actually asserts on the result depends on it
    succeeding on the first try."""
    print("Warming up witness IRQ subsystem (documented first-call memory allocation quirk)...")
    try:
        reply = witness.command("WATCH_EDGES %d 10" % WITNESS_EDGE_WATCH_PIN, ["EDGES_DONE", "EDGES_ERR"], timeout_s=3)
        # Logged rather than silently discarded -- a prior version of this
        # function didn't check/print this, which meant a run where the
        # warm-up call itself ate the MemoryError (instead of "paying the
        # cost" the way it's meant to) would look identical to a run where
        # it succeeded, from this script's own output. Worth knowing which
        # happened when a later real WATCH_EDGES call still hits it.
        print("  warm-up result: %r" % (reply,))
    except TimeoutError as e:
        print("  warm-up call itself timed out (%r) -- continuing anyway, best-effort" % (e,))


def check_no_early_node_error(dut, context, results, timeout_s=1.5):
    """DEPLOY_ACK only confirms the bytecode was accepted and loaded, not
    that the flow's own code ran without raising -- a node's codegen can
    be syntactically fine (confirmed off-device, editor/test/node-*.test.ts)
    and still hit a real hardware/API surprise pymock can't reproduce by
    definition. Waits briefly for a NODE_ERROR after a deploy; a clean
    timeout (nothing arrived) is the expected/passing case, not an error
    itself, so this doesn't raise -- it reports into `results` either way
    so a look at the output tells you whether "no observed effect" was a
    DUT-side exception or something else (wiring, the witness's own
    observation) worth checking instead."""
    try:
        err = dut.wait_for_message(lambda m: m["type"] == "NODE_ERROR", timeout_s=timeout_s, description="(early-error check, not expected to find one)")
    except TimeoutError:
        err = None
    results.append(("%s: DUT flow started without raising a NODE_ERROR" % context, err is None, err))
    return err


def check_gpio_in(dut, witness, mpy_cross, tmpdir, results):
    """mvp-validation-plan.md's gpio_in bar, via pin-map.md's DUT
    GPIO4 <- witness GPIO5 pair: the witness drives a known signal, a
    real gpio_in-shaped flow on the DUT reads it and mirrors it onto
    DUT GPIO12 (gpio_out's own already-wired pin) so the witness can
    confirm the read succeeded via WATCH_EDGES on its paired GPIO3,
    without needing VALUE_STREAM (Tier 2, not built yet) to observe the
    read directly.

    Sequencing, worth being explicit about (this rig's actual protocol
    constraint, not just a style choice): the witness board runs ONE
    command at a time on a single serial link -- while WATCH_EDGES is
    blocking (it owns the command loop until its duration_ms elapses),
    the SAME witness board can't also process a DRIVE_GPIO call. So the
    stimulus has to be set BEFORE WATCH_EDGES is armed, not during it:
    drive the pin to a known level first (fast, synchronous), then arm
    WATCH_EDGES, then DEPLOY the DUT flow -- the flow's first loop
    iteration reads the already-driven pin and produces the mirrored
    edge WATCH_EDGES observes, all after the arm. Run twice (LOW then
    HIGH) to confirm both directions, not just "some edge happened."
    """
    for expected_value, label in ((1, "HIGH"), (0, "LOW")):
        drive_reply = witness.command("DRIVE_GPIO %d %d" % (WITNESS_DRIVE_PIN, expected_value), ["DRIVE_OK", "DRIVE_ERR"])
        drive_ok = drive_reply and drive_reply[-1].startswith("DRIVE_OK")
        results.append(("gpio_in: witness drove GPIO%d to %s" % (WITNESS_DRIVE_PIN, label), drive_ok, drive_reply))
        if not drive_ok:
            continue

        source = (
            "import runtime\n"
            "import machine\n"
            "asyncio = runtime.asyncio\n"
            "_pin_%d_in = machine.Pin(%d, machine.Pin.IN)\n"
            "_pin_%d = machine.Pin(%d, machine.Pin.OUT)\n"
            "async def _flow_0():\n"
            "    while True:\n"
            "        msg = {'payload': bool(_pin_%d_in.value()), 'topic': ''}\n"
            "        _pin_%d.value(1 if msg.get('payload') else 0)\n"
            "        await asyncio.sleep_ms(50)\n"
            "runtime.spawn(_flow_0(), '1')\n"
        ) % (DUT_GPIO_IN_PIN, DUT_GPIO_IN_PIN, DUT_GPIO_OUT_PIN, DUT_GPIO_OUT_PIN, DUT_GPIO_IN_PIN, DUT_GPIO_OUT_PIN)
        bytecode = compile_flow(mpy_cross, tmpdir, "flow_gpio_in_%s" % label.lower(), source)

        # Arm before DEPLOY -- see docstring above and
        # check_per_task_boundary's identical note in
        # run_fault_isolation_checks.py. A settle delay AFTER writing the
        # arm command and BEFORE triggering the stimulus, added after a
        # real run surfaced the race this closes: writing the command
        # only means the witness has RECEIVED it, not that it's finished
        # gc.collect() + pin.irq() setup yet (_arm_irq in
        # witness_firmware.py) -- if the DUT's transition happens faster
        # than that setup completes, the edge is simply missed with no
        # error at all (a real run showed exactly this: WATCH_EDGES armed
        # cleanly, zero edges captured). 300ms is a guess at "comfortably
        # longer than one gc.collect() pass on this board," not a
        # measured number -- revisit if this specific race recurs with
        # it in place.
        witness.ser.write(("WATCH_EDGES %d 2000\n" % WITNESS_EDGE_WATCH_PIN).encode("ascii"))
        witness.ser.flush()
        time.sleep(0.3)

        dut.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
        dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK for the gpio_in mirror flow (%s)" % label)
        check_no_early_node_error(dut, "gpio_in (%s)" % label, results)

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
        saw_expected_value = any(line.startswith("EDGE ") and line.split()[-1] == str(expected_value) for line in edge_lines)
        results.append(
            (
                "gpio_in: DUT mirrored witness-driven %s onto GPIO%d, observed by witness" % (label, DUT_GPIO_OUT_PIN),
                saw_expected_value,
                edge_lines,
            )
        )


def check_pwm_out(dut, mpy_cross, tmpdir, witness, results):
    """mvp-validation-plan.md's PWM bar, via pin-map.md's DUT GPIO6 ->
    witness GPIO7 pair. Unlike gpio_in/timer, PWM is a genuine hardware
    peripheral (ESP32's LEDC) that free-runs once configured -- a single
    one-shot `duty_u16()`/freq call (matching what a manual inject ->
    pwm_out flow would compile to) is enough to produce a continuous
    signal, no ongoing DUT-side coroutine activity required. So this
    doesn't need WATCH_EDGES's arm-before-DEPLOY dance: deploy, wait for
    DEPLOY_ACK (the signal is already running by then), then call
    MEASURE_PWM normally.

    Configured for 1000Hz / 50% duty; tolerances are deliberately loose
    (10% on frequency, ±10 percentage points on duty) -- this rig's own
    documented breadboard ringing (test/hil/pin-map.md,
    mvp-validation-plan.md's witness-rig status note) is real signal-
    integrity noise, not a reason to expect lab-instrument precision here
    even after the wiring cleanup.
    """
    configured_freq = 1000
    configured_duty_pct = 50.0
    source = (
        "import runtime\n"
        "import machine\n"
        "_pwm_%d = machine.PWM(machine.Pin(%d, machine.Pin.OUT), freq=%d)\n"
        "def _pwm_out(msg):\n"
        "    _pwm_%d.duty_u16(int(max(0.0, min(1.0, msg.get('payload', 0))) * 65535))\n"
        "async def _flow_0():\n"
        "    msg = {'payload': 0.5, 'topic': ''}\n"
        "    try:\n"
        "        _pwm_out(msg)\n"
        "    except Exception as _e:\n"
        "        raise runtime.NodeError('2', _e)\n"
        "runtime.spawn(_flow_0(), '1')\n"
    ) % (DUT_PWM_PIN, DUT_PWM_PIN, configured_freq, DUT_PWM_PIN)
    bytecode = compile_flow(mpy_cross, tmpdir, "flow_pwm_out", source)

    dut.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
    dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK for the pwm_out flow")
    early_error = check_no_early_node_error(dut, "pwm_out", results)
    if early_error is not None:
        # No point calling MEASURE_PWM if the DUT never actually
        # configured the peripheral -- would just add a confusing
        # PWM_ERR timeout on top of the real, already-reported cause.
        return

    reply = witness.command("MEASURE_PWM %d 10 5000" % WITNESS_PWM_WATCH_PIN, ["PWM_RESULT", "PWM_ERR"], timeout_s=8)
    last = reply[-1] if reply else ""
    if not last.startswith("PWM_RESULT"):
        results.append(("pwm_out: MEASURE_PWM returned a result (not PWM_ERR)", False, reply))
        return

    fields = dict(part.split("=", 1) for part in last.split()[2:])
    freq_hz = float(fields.get("freq_hz", "nan"))
    duty_pct = float(fields.get("duty_pct", "nan"))

    freq_ok = abs(freq_hz - configured_freq) <= 0.10 * configured_freq
    results.append(("pwm_out: measured frequency ~%dHz (got %.2fHz)" % (configured_freq, freq_hz), freq_ok, last))

    duty_ok = duty_pct >= 0 and abs(duty_pct - configured_duty_pct) <= 10.0
    results.append(("pwm_out: measured duty ~%.0f%% (got %.2f%%)" % (configured_duty_pct, duty_pct), duty_ok, last))


def check_timer(dut, witness, mpy_cross, tmpdir, results):
    """mvp-validation-plan.md's timer bar: an elapsed-time check, not just
    "did it fire at all". Wires timer's tick count through a parity check
    into a gpio_out toggle (thingstudio/timer's own payload -- an ever-
    incrementing count -- would otherwise stay truthy forever and never
    toggle GPIO12 after the first edge, which WATCH_EDGES needs to
    measure an interval) so consecutive edge timestamps should be spaced
    ~intervalMs apart. Same arm-before-DEPLOY sequencing as check_gpio_in,
    same reasoning.
    """
    interval_ms = 300
    source = (
        "import runtime\n"
        "import machine\n"
        "asyncio = runtime.asyncio\n"
        "_pin_%d = machine.Pin(%d, machine.Pin.OUT)\n"
        "_timer_count = 0\n"
        "async def _flow_0():\n"
        "    while True:\n"
        "        global _timer_count\n"
        "        _timer_count += 1\n"
        "        msg = {'payload': _timer_count, 'topic': ''}\n"
        "        msg['payload'] = (msg['payload'] %% 2 == 0)\n"
        "        try:\n"
        "            _pin_%d.value(1 if msg.get('payload') else 0)\n"
        "        except Exception as _e:\n"
        "            raise runtime.NodeError('2', _e)\n"
        "        await asyncio.sleep_ms(%d)\n"
        "runtime.spawn(_flow_0(), '1')\n"
    ) % (DUT_GPIO_OUT_PIN, DUT_GPIO_OUT_PIN, DUT_GPIO_OUT_PIN, interval_ms)
    bytecode = compile_flow(mpy_cross, tmpdir, "flow_timer", source)

    watch_duration_ms = interval_ms * 7  # enough headroom for several ticks past startup jitter
    witness.ser.write(("WATCH_EDGES %d %d\n" % (WITNESS_EDGE_WATCH_PIN, watch_duration_ms)).encode("ascii"))
    witness.ser.flush()
    time.sleep(0.3)  # same arm/trigger race as check_gpio_in -- see its comment

    dut.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
    dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK for the timer flow")
    check_no_early_node_error(dut, "timer", results)

    edge_lines = []
    deadline = time.time() + (watch_duration_ms / 1000.0) + 3
    while time.time() < deadline:
        raw = witness.ser.readline()
        if not raw:
            continue
        text = raw.decode("utf-8", "replace").rstrip("\r\n")
        edge_lines.append(text)
        if text.startswith("EDGES_DONE") or text.startswith("EDGES_ERR"):
            break

    ticks_us = [int(line.split()[1]) for line in edge_lines if line.startswith("EDGE ")]
    results.append(("timer: witness observed at least 2 edges to measure an interval from", len(ticks_us) >= 2, edge_lines))
    if len(ticks_us) < 2:
        return

    deltas_ms = [(ticks_us[i + 1] - ticks_us[i]) / 1000.0 for i in range(len(ticks_us) - 1)]
    avg_delta_ms = sum(deltas_ms) / len(deltas_ms)
    # Generous tolerance -- IRQ/scheduling jitter on both boards, not lab
    # timing equipment; this is an order-of-magnitude sanity check on
    # intervalMs fidelity, not a precision measurement.
    interval_ok = abs(avg_delta_ms - interval_ms) <= 0.3 * interval_ms
    results.append(
        ("timer: average inter-edge interval ~%dms (got %.1fms across %d gaps)" % (interval_ms, avg_delta_ms, len(deltas_ms)), interval_ok, deltas_ms)
    )


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
            # Same reasoning as run_fault_isolation_checks.py's main(): no
            # auto-reset-on-serial-open on this board class, so HELLO is a
            # one-time boot event this script has to wait for fresh.
            dut.ser.reset_input_buffer()
            input("Press the DUT board's physical RESET button now, then press Enter here to continue...")
            dut.wait_for_message(lambda m: m["type"] == "HELLO", timeout_s=8, description="DUT's boot-time HELLO")
            pong = witness.command("PING", ["PONG", "ERR"])
            results.append(("witness responds to PING", pong and pong[-1] == "PONG", pong))
            warm_up_witness_irq(witness)

            check_gpio_in(dut, witness, args.mpy_cross, tmpdir, results)
            check_pwm_out(dut, args.mpy_cross, tmpdir, witness, results)
            check_timer(dut, witness, args.mpy_cross, tmpdir, results)
        finally:
            dut.close()
            witness.close()

    print("=== GPIO/PWM/timer HIL check results ===")
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
