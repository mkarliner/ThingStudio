#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_listener_integration.py
#
# Integration test for listener.py, run with plain CPython3 (NOT part of
# the MicroPython minitest suite -- this file's job is to drive an actual
# `micropython listener.py` subprocess over real stdin/stdout pipes, the
# same way the real WebSerial transport client will, so it needs
# subprocess/threading that MicroPython's minimal unix-port build here
# doesn't have). This is the closest thing to the real hardware pass
# achievable without a board: real uasyncio scheduling, real CBOR/framing
# bytes on a real byte-stream boundary (a pipe, not an in-process buffer
# like test_protocol.py), and -- via a real mpy-cross-compiled flow --
# real per-task fault isolation exercised end-to-end (compiled bytecode ->
# DEPLOY -> runtime.spawn -> NodeError -> NODE_ERROR sent back over the
# wire). Not a substitute for the validation plan's actual hardware pass
# (real uasyncio task-completion timing on real silicon, a real witness
# board's HEARTBEAT_WATCH, physical malformed-frame injection over a real
# serial port) -- see mvp-validation-plan.md's "Fault isolation" section
# for what that still needs.
#
# Requires two things not vendored into this repo (see
# device-runtime/test/README.md for the build recipe): a MicroPython
# unix-port build and a native mpy-cross build, both from the same
# MicroPython commit so bytecode versions match. Path to each via env var
# (MICROPYTHON_BIN, MPY_CROSS_BIN) -- skips with a clear message, doesn't
# fail, if either isn't set, same "honest about what isn't covered in this
# environment" convention every prior hardware-adjacent piece of this
# project has followed when the tool it needs isn't available.

import base64
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(THIS_DIR, "..", "src")
sys.path.insert(0, SRC_DIR)

import cbor  # noqa: E402
import framing  # noqa: E402
import messages  # noqa: E402
import protocol  # noqa: E402

MICROPYTHON_BIN = os.environ.get("MICROPYTHON_BIN")
MPY_CROSS_BIN = os.environ.get("MPY_CROSS_BIN")

F64_PREFIX = "F64:"


def _skip(reason):
    print("SKIP: %s" % reason)
    sys.exit(0)


def _compile_flow(tmpdir, name, source):
    py_path = os.path.join(tmpdir, name + ".py")
    mpy_path = os.path.join(tmpdir, name + ".mpy")
    with open(py_path, "w") as f:
        f.write(source)
    subprocess.run([MPY_CROSS_BIN, "-o", mpy_path, py_path], check=True, capture_output=True)
    with open(mpy_path, "rb") as f:
        return f.read()


class ListenerProcess:
    """Spawns `micropython listener.py` and pumps its stdout lines into a
    queue on a background thread (subprocess pipes block, and the listener
    itself is a long-running event loop -- this is the CPython-side
    equivalent of a WebSerial transport client's read loop)."""

    def __init__(self, tmpdir, extra_env=None):
        self.tmpdir = tmpdir
        env = dict(os.environ)
        env["THINGSTUDIO_BOARD_SETTINGS_PATH"] = os.path.join(tmpdir, "_board.json")
        env.update(extra_env or {})
        env["THINGSTUDIO_BOOT_DELAY_S"] = "0.1"
        env["THINGSTUDIO_FLOW_PATH"] = os.path.join(tmpdir, "_flow.mpy")
        env["THINGSTUDIO_STATIC_DATA_PATH"] = os.path.join(tmpdir, "_flow_static.bin")
        env["THINGSTUDIO_FLOW_META_PATH"] = os.path.join(tmpdir, "_flow_meta.json")
        env["THINGSTUDIO_BOOT_COUNT_PATH"] = os.path.join(tmpdir, "_boot_count")
        env["THINGSTUDIO_STABLE_AFTER_MS"] = "400"
        listener_path = os.path.join(SRC_DIR, "listener.py")
        self.proc = subprocess.Popen(
            [MICROPYTHON_BIN, listener_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            bufsize=1,
        )
        # A growing, never-discarded history of every line the process has
        # printed, plus a lock -- wait_for() below scans the *whole*
        # history on every call rather than draining a queue, precisely so
        # that two sequential wait_for() calls looking for two different
        # lines (e.g. DEPLOY_ACK, then the flow's own print output) can't
        # lose one to the other depending on which order the listener
        # actually emits them in -- real event-loop interleaving order
        # isn't this test's concern, only "did both things happen."
        self._history = []
        self._lock = threading.Lock()
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()

    def _pump(self):
        for line in self.proc.stdout:
            with self._lock:
                self._history.append(line.decode("utf-8", "replace").rstrip("\n"))

    def wait_for(self, predicate, timeout=5, description="expected line"):
        deadline = time.time() + timeout
        while True:
            with self._lock:
                snapshot = list(self._history)
            for line in snapshot:
                if predicate(line):
                    return line
            if time.time() >= deadline:
                raise AssertionError("timed out waiting for %s; saw:\n%s" % (description, "\n".join(snapshot)))
            time.sleep(0.05)

    def send_message(self, message):
        frame = protocol.encode_message(message)
        b64 = base64.b64encode(frame).decode("ascii")
        self.proc.stdin.write((F64_PREFIX + b64 + "\n").encode("ascii"))
        self.proc.stdin.flush()

    def send_raw_line(self, text):
        self.proc.stdin.write((text + "\n").encode("ascii"))
        self.proc.stdin.flush()

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def _decode_f64_line(line):
    assert line.startswith(F64_PREFIX), "not a protocol line: %r" % (line,)
    frame = base64.b64decode(line[len(F64_PREFIX) :])
    decoder = protocol.ProtocolStreamDecoder()
    results = decoder.push(frame)
    assert len(results) == 1 and "message" in results[0], "failed to decode frame: %r" % (results,)
    return results[0]["message"]


def test_hello_sent_on_boot():
    with tempfile.TemporaryDirectory() as tmpdir:
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            line = listener.wait_for(lambda l: l.startswith(F64_PREFIX), description="a HELLO frame")
            msg = _decode_f64_line(line)
            assert msg["type"] == "HELLO"
            assert msg["runtimeVersion"] == {"major": 5, "minor": 1, "patch": 0}
            assert isinstance(msg["freeRamBytes"], int) and msg["freeRamBytes"] > 0
            assert msg["freeIdfHeapBytes"] is None and msg["largestIdfHeapBlockBytes"] is None  # not an ESP32
            # WiFi transport fields (2026-09-24): fresh board -> generated hostname, no password.
            assert msg["hostname"].startswith("ts-"), msg["hostname"]
            assert msg["authRequired"] is False and msg["authScheme"] == "none"
            assert msg["networkAddress"] is None
        finally:
            listener.close()


def test_deploy_success_and_flow_runs():
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_ok",
            "import runtime\n"
            "async def _flow_0():\n"
            "    print('INTEGRATION_FLOW_RAN')\n"
            "runtime.spawn(_flow_0(), '1')\n",
        )
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            listener.wait_for(lambda l: l == "INTEGRATION_FLOW_RAN", description="the deployed flow's own print output")
            line = listener.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ACK",
                description="DEPLOY_ACK",
            )
            msg = _decode_f64_line(line)
            assert msg["type"] == "DEPLOY_ACK"
        finally:
            listener.close()


def test_node_error_reported_end_to_end():
    # The whole point of this task: a real compiled flow, deployed over
    # the real protocol, whose node raises -- confirm NODE_ERROR actually
    # makes it back over the wire with the right node id, and that the
    # listener is still alive and responsive afterward (design doc §5:
    # "the rest of the flow keeps running" -- here, "the listener keeps
    # listening").
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_broken",
            "import runtime\n"
            "async def _flow_0():\n"
            "    try:\n"
            "        raise ValueError('integration test failure')\n"
            "    except Exception as _e:\n"
            "        raise runtime.NodeError('42', _e)\n"
            "runtime.spawn(_flow_0(), '1')\n",
        )
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})

            def is_node_error(l):
                if not l.startswith(F64_PREFIX):
                    return False
                try:
                    return _decode_f64_line(l)["type"] == "NODE_ERROR"
                except Exception:
                    return False

            line = listener.wait_for(is_node_error, description="a NODE_ERROR frame")
            msg = _decode_f64_line(line)
            assert msg["nodeId"] == "42"
            assert msg["exceptionType"] == "ValueError"
            assert msg["exceptionMessage"] == "integration test failure"

            # Listener must still be alive: send a second, valid DEPLOY and
            # confirm it's still answered.
            bytecode2 = _compile_flow(tmpdir, "flow_ok2", "import runtime\nasync def _flow_0():\n    print('STILL_ALIVE')\nruntime.spawn(_flow_0(), '1')\n")
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode2, "staticData": b""})
            listener.wait_for(lambda l: l == "STILL_ALIVE", description="listener still processes DEPLOY after a NODE_ERROR")
        finally:
            listener.close()


def test_malformed_frame_soak_does_not_kill_listener():
    # The fault-isolation-briefing.md / validation plan's own soak test,
    # against the real listener process: 50 malformed "F64:" lines in a
    # row, confirm the listener survives all of them and still answers a
    # good DEPLOY afterward.
    with tempfile.TemporaryDirectory() as tmpdir:
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.wait_for(lambda l: l.startswith(F64_PREFIX), description="initial HELLO")

            for i in range(50):
                if i % 2 == 0:
                    listener.send_raw_line(F64_PREFIX + "not-valid-base64!!!")
                else:
                    # Valid base64, garbage frame bytes underneath.
                    garbage = base64.b64encode(bytes([i % 256]) * 5).decode("ascii")
                    listener.send_raw_line(F64_PREFIX + garbage)

            bytecode = _compile_flow(tmpdir, "flow_after_soak", "import runtime\nasync def _flow_0():\n    print('SURVIVED_SOAK')\nruntime.spawn(_flow_0(), '1')\n")
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            listener.wait_for(lambda l: l == "SURVIVED_SOAK", description="listener survives 50 malformed frames and still deploys")
        finally:
            listener.close()


def test_trigger_fires_the_registered_node_and_ignores_unknown_ids():
    # inject click-only live-fire feature (2026-09-02) -- the real §13
    # TRIGGER message dispatched through the real listener/runtime.py
    # pair. Uses a plain uasyncio.Event rather than the vendored
    # ThreadSafeEvent real inject.ts codegen constructs: this test is
    # about the TRIGGER message reaching runtime.fire_trigger() and
    # waking the right coroutine, not about ThreadSafeEvent's own
    # hard-IRQ-safety (interrupt.ts/its vendored README already cover
    # that separately) -- an ordinary Event is a faithful enough stand-in
    # for "some object with .wait()/.set()" here.
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_trigger",
            "import runtime\n"
            "import uasyncio as asyncio\n"
            "_evt = asyncio.Event()\n"
            "runtime.register_trigger('5', _evt)\n"
            "async def _flow_0():\n"
            "    while True:\n"
            "        await _evt.wait()\n"
            "        _evt.clear()\n"
            "        print('INTEGRATION_TRIGGER_FIRED')\n"
            "runtime.spawn(_flow_0(), '5')\n",
        )
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            listener.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ACK",
                description="DEPLOY_ACK",
            )

            listener.send_message({"type": "TRIGGER", "nodeId": "5"})
            listener.wait_for(lambda l: l == "INTEGRATION_TRIGGER_FIRED", description="the flow's coroutine woke on TRIGGER")

            # A TRIGGER naming an unknown/stale node ID must be a silent
            # no-op, not a crash -- confirmed by the listener staying
            # alive and answering a subsequent DEPLOY normally.
            listener.send_message({"type": "TRIGGER", "nodeId": "does-not-exist"})
            bytecode2 = _compile_flow(
                tmpdir,
                "flow_ok2",
                "import runtime\nasync def _flow_0():\n    print('STILL_ALIVE_AFTER_TRIGGER')\nruntime.spawn(_flow_0(), '1')\n",
            )
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode2, "staticData": b""})
            listener.wait_for(lambda l: l == "STILL_ALIVE_AFTER_TRIGGER", description="listener still alive after TRIGGER traffic")
        finally:
            listener.close()


def test_hello_request_resends_hello_no_side_effects():
    # No reset button on the Pico W (2026-09-05, real hardware pass)
    # surfaced this: _send_hello() only fires once, at boot, so a
    # reconnecting editor (or a board that's been running a while) has no
    # way to learn the device's current state without a physical reset.
    # HELLO_REQUEST is the fix -- confirm it actually resends a real HELLO,
    # and that it has no other effect (no flow re-run, listener stays
    # alive for a subsequent normal DEPLOY).
    with tempfile.TemporaryDirectory() as tmpdir:
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            # Consume the boot-time HELLO first so the next F64: line this
            # test waits for is unambiguously the HELLO_REQUEST's own reply,
            # not a race against the one from boot.
            boot_line = listener.wait_for(lambda l: l.startswith(F64_PREFIX), description="boot-time HELLO frame")
            assert _decode_f64_line(boot_line)["type"] == "HELLO"

            listener.send_message({"type": "HELLO_REQUEST"})
            reply_line = listener.wait_for(lambda l: l.startswith(F64_PREFIX), description="HELLO_REQUEST's HELLO reply")
            msg = _decode_f64_line(reply_line)
            assert msg["type"] == "HELLO"
            assert msg["runtimeVersion"] == {"major": 5, "minor": 1, "patch": 0}

            # No side effects: a normal DEPLOY still works fine afterward.
            bytecode = _compile_flow(
                tmpdir,
                "flow_after_hello_request",
                "import runtime\nasync def _flow_0():\n    print('STILL_ALIVE_AFTER_HELLO_REQUEST')\nruntime.spawn(_flow_0(), '1')\n",
            )
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            listener.wait_for(lambda l: l == "STILL_ALIVE_AFTER_HELLO_REQUEST", description="listener still alive after HELLO_REQUEST")
        finally:
            listener.close()


def test_boot_time_flow_auto_resume():
    # 2026-09-05, Mike's own real-hardware finding: "not persisting flows
    # to survive reset or power cycle is pretty fundamental. fix it." --
    # before listener.py's _resume_flow(), a second listener process
    # pointed at the same on-disk flow file would boot with nothing
    # running at all; only a fresh DEPLOY (a live message, not just the
    # bytecode already sitting on disk) ever started a flow. This test is
    # the whole point: deploy once, throw away that listener process
    # entirely (the real-world equivalent of a reset/power-cycle), start a
    # brand new one against the same tmpdir, and confirm the flow runs
    # again with NO second DEPLOY sent.
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_resumable",
            "import runtime\n"
            "async def _flow_0():\n"
            "    print('INTEGRATION_FLOW_RESUMED')\n"
            "runtime.spawn(_flow_0(), '1')\n",
        )
        first = ListenerProcess(tmpdir)
        try:
            first.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY (first boot)")
            first.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            first.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ACK",
                description="DEPLOY_ACK",
            )
        finally:
            first.close()

        # Simulates a reset/power-cycle: a brand new process, same on-disk
        # _flow.mpy (THINGSTUDIO_FLOW_PATH points at the same tmpdir/file),
        # no DEPLOY sent this time at all.
        second = ListenerProcess(tmpdir)
        try:
            second.wait_for(
                lambda l: l == "LISTENER_BOOT resumed persisted flow from %s" % os.path.join(tmpdir, "_flow.mpy"),
                description="boot-time resume log line",
            )
            second.wait_for(lambda l: l == "INTEGRATION_FLOW_RESUMED", description="the persisted flow's own print output, with no DEPLOY sent this boot")
        finally:
            second.close()


def test_start_reason_is_deploy_then_boot_reason():
    # 2026-09-25, startup node's reason: runtime.start_reason is "deploy" for a flow started by DEPLOY, and
    # listener.py's _boot_reason() when the saved flow resumes at boot -- "unknown" here, since the unix port
    # has no machine.reset_cause(). Also checks DEPLOY_ACK's ESP-IDF heap fields are absent off ESP32.
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_start_reason",
            "import runtime\n"
            "async def _flow_0():\n"
            "    print('START_REASON ' + runtime.start_reason)\n"
            "runtime.spawn(_flow_0(), '1')\n",
        )
        first = ListenerProcess(tmpdir)
        try:
            first.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY (first boot)")
            first.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            line = first.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ACK",
                description="DEPLOY_ACK",
            )
            ack = _decode_f64_line(line)
            assert ack["freeIdfHeapBytes"] is None and ack["largestIdfHeapBlockBytes"] is None, ack
            first.wait_for(lambda l: l == "START_REASON deploy", description="start reason after DEPLOY")
        finally:
            first.close()
        second = ListenerProcess(tmpdir)
        try:
            second.wait_for(lambda l: l == "START_REASON unknown", description="start reason after a boot-time resume")
        finally:
            second.close()


def test_flow_identity_reported_in_hello_and_survives_resume():
    # 2026-09-05, Mike's direct follow-on to auto-resume: "so if we
    # connect to a micro we know if we have the right flow loaded."
    # flowName/deployId travel in DEPLOY, get persisted alongside the
    # bytecode, and come back out in HELLO as currentFlowName/
    # currentFlowDeployId -- confirm both survive a full process
    # restart (the real-world equivalent of a reset/power-cycle), not
    # just a live connection.
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_named",
            "import runtime\nasync def _flow_0():\n    print('INTEGRATION_FLOW_NAMED_RAN')\nruntime.spawn(_flow_0(), '1')\n",
        )
        first = ListenerProcess(tmpdir)
        try:
            first.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY (first boot)")
            first.send_message(
                {
                    "type": "DEPLOY",
                    "bytecode": bytecode,
                    "staticData": b"",
                    "flowName": "my named flow",
                    "deployId": "11111111-2222-3333-4444-555555555555",
                }
            )
            first.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ACK",
                description="DEPLOY_ACK",
            )
            first.send_message({"type": "HELLO_REQUEST"})

            def _is_hello_for_named_flow(l):
                if not l.startswith(F64_PREFIX):
                    return False
                try:
                    msg = _decode_f64_line(l)
                except Exception:
                    return False
                return msg["type"] == "HELLO" and msg.get("currentFlowName") == "my named flow"

            reply_line = first.wait_for(_is_hello_for_named_flow, description="a HELLO reporting the just-deployed flow's identity (not the earlier boot-time one)")
            msg = _decode_f64_line(reply_line)
            assert msg["currentFlowName"] == "my named flow"
            assert msg["currentFlowDeployId"] == "11111111-2222-3333-4444-555555555555"
        finally:
            first.close()

        # Simulates a reset/power-cycle: brand new process, same on-disk
        # flow + flow-meta files, no DEPLOY sent -- the identity should
        # come back exactly as it was, recovered by _resume_flow(), not
        # just the bytecode.
        second = ListenerProcess(tmpdir)
        try:
            second.wait_for(lambda l: l == "INTEGRATION_FLOW_NAMED_RAN", description="the persisted flow resumed with no DEPLOY sent")
            line = second.wait_for(lambda l: l.startswith(F64_PREFIX), description="boot HELLO reporting the resumed flow's identity")
            msg = _decode_f64_line(line)
            assert msg["type"] == "HELLO"
            assert msg["currentFlowName"] == "my named flow"
            assert msg["currentFlowDeployId"] == "11111111-2222-3333-4444-555555555555"
        finally:
            second.close()


def test_failed_redeploy_clears_flow_identity():
    # A DEPLOY that fails (bad bytecode) must not leave the OLD flow's
    # identity looking "current" -- cancel_running() already killed it,
    # so HELLO reporting the stale name/deployId afterward would be a
    # lie about what's actually running (see listener.py's
    # _handle_deploy, the _set_current_flow(None, None) added alongside
    # this same 2026-09-05 change).
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_good",
            "import runtime\nasync def _flow_0():\n    print('INTEGRATION_GOOD_FLOW_RAN')\nruntime.spawn(_flow_0(), '1')\n",
        )
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.send_message(
                {"type": "DEPLOY", "bytecode": bytecode, "staticData": b"", "flowName": "good flow", "deployId": "aaaa"}
            )
            listener.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ACK",
                description="DEPLOY_ACK for the good flow",
            )

            # Deliberately corrupt bytecode -- import _flow will raise.
            listener.send_message(
                {"type": "DEPLOY", "bytecode": b"not real bytecode", "staticData": b"", "flowName": "bad flow", "deployId": "bbbb"}
            )
            listener.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "DEPLOY_ERROR",
                description="DEPLOY_ERROR for the corrupt bytecode",
            )

            listener.send_message({"type": "HELLO_REQUEST"})
            reply_line = listener.wait_for(
                lambda l: l.startswith(F64_PREFIX) and _decode_f64_line(l)["type"] == "HELLO",
                description="HELLO_REQUEST reply after the failed redeploy",
            )
            msg = _decode_f64_line(reply_line)
            assert msg["currentFlowName"] is None, "stale identity from the cancelled good flow must not survive a failed redeploy"
            assert msg["currentFlowDeployId"] is None
        finally:
            listener.close()


def test_boot_time_resume_survives_corrupt_persisted_flow():
    # A persisted flow file that can't actually be imported (this port's
    # bytecode format changed, a truncated write, hand-edited garbage)
    # must degrade to "didn't resume" and let the rest of boot continue --
    # never brick the listener itself. Confirmed here by writing garbage
    # bytes straight to the flow path (bypassing DEPLOY entirely) and
    # checking the listener still reaches LISTENER_READY, still sends its
    # boot HELLO, and still accepts a normal DEPLOY afterward.
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "_flow.mpy"), "wb") as f:
            f.write(b"not a real .mpy file")

        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY despite a corrupt persisted flow")
            listener.wait_for(
                lambda l: l.startswith("LISTENER_BOOT_ERR could not resume persisted flow"),
                description="a logged, non-fatal boot-resume error",
            )
            line = listener.wait_for(lambda l: l.startswith(F64_PREFIX), description="boot HELLO still sent")
            assert _decode_f64_line(line)["type"] == "HELLO"

            bytecode = _compile_flow(
                tmpdir,
                "flow_after_corrupt_resume",
                "import runtime\nasync def _flow_0():\n    print('STILL_ALIVE_AFTER_CORRUPT_RESUME')\nruntime.spawn(_flow_0(), '1')\n",
            )
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            listener.wait_for(lambda l: l == "STILL_ALIVE_AFTER_CORRUPT_RESUME", description="a normal DEPLOY still works after a corrupt persisted flow")
        finally:
            listener.close()


def _hello_reply(listener, description):
    listener.send_message({"type": "HELLO_REQUEST"})
    time.sleep(0.3)
    with listener._lock:
        lines = [l for l in listener._history if l.startswith(F64_PREFIX)]
    hellos = [m for m in (_decode_f64_line(l) for l in lines) if m["type"] == "HELLO"]
    assert hellos, "no HELLO for %s" % description
    return hellos[-1]


def test_exec_prints_results_keeps_variables_and_survives_errors():
    """EXEC (2026-09-23): the editor's command box."""
    with tempfile.TemporaryDirectory() as tmpdir:
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.send_message({"type": "EXEC", "code": "6 * 7"})
            listener.wait_for(lambda l: l == "42", description="expression result")
            listener.send_message({"type": "EXEC", "code": "type(gc.mem_free()).__name__"})
            listener.wait_for(lambda l: l == "'int'", description="gc preloaded, no import needed")
            listener.send_message({"type": "EXEC", "code": "greeting = 'hi from exec'"})
            listener.send_message({"type": "EXEC", "code": "greeting"})
            listener.wait_for(lambda l: l == "'hi from exec'", description="variable kept between commands")
            listener.send_message({"type": "EXEC", "code": "print('printed ' + greeting)"})
            listener.wait_for(lambda l: l == "printed hi from exec", description="print output")
            listener.send_message({"type": "EXEC", "code": "1/0"})
            listener.wait_for(lambda l: "ZeroDivisionError" in l, description="traceback for a failing command")
            listener.send_message({"type": "EXEC", "code": "if if"})
            listener.wait_for(lambda l: "SyntaxError" in l, description="SyntaxError for bad input")
            assert _hello_reply(listener, "after bad commands")["type"] == "HELLO"  # listener still alive
        finally:
            listener.close()


def test_stop_to_prompt_stops_the_flow_and_ends_the_listener():
    """STOP_TO_PROMPT (2026-09-23): on a real board main.py returning leaves the REPL; here the
    unix-port process simply exits once main() returns."""
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_ticker",
            "import runtime\nimport uasyncio as asyncio\n"
            "async def _flow_0():\n    while True:\n        print('TICK')\n        await asyncio.sleep_ms(50)\n"
            "runtime.spawn(_flow_0(), '1')\n",
        )
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            listener.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            listener.wait_for(lambda l: l == "TICK", description="flow running")
            listener.send_message({"type": "STOP_TO_PROMPT"})
            listener.wait_for(lambda l: l.startswith("LISTENER_STOPPED"), description="stop line")
            listener.proc.wait(timeout=5)  # main() returned
            with listener._lock:
                after = listener._history[[i for i, l in enumerate(listener._history) if l.startswith("LISTENER_STOPPED")][0]:]
            assert "TICK" not in after, "flow kept running after STOP_TO_PROMPT: %r" % (after,)
        finally:
            listener.close()


def test_boot_loop_safe_mode():
    """Safe mode (2026-09-23): after 3 boots in a row that never stayed up, the saved flow is
    skipped; a DEPLOY clears it; a flow that stays up clears the counter."""
    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = _compile_flow(
            tmpdir,
            "flow_ok",
            "import runtime\nasync def _flow_0():\n    print('FLOW_STARTED')\nruntime.spawn(_flow_0(), '1')\n",
        )
        count_path = os.path.join(tmpdir, "_boot_count")
        first = ListenerProcess(tmpdir)
        try:
            first.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            first.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            first.wait_for(lambda l: l == "FLOW_STARTED", description="deployed flow runs")
        finally:
            first.close()

        # Simulate three boots that crashed before the flow counted as stable.
        with open(count_path, "w") as f:
            f.write("3")
        safe = ListenerProcess(tmpdir)
        try:
            safe.wait_for(lambda l: l.startswith("LISTENER_SAFE_MODE"), description="safe mode line")
            safe.wait_for(lambda l: l == "LISTENER_READY", description="listener still starts")
            hello = _hello_reply(safe, "in safe mode")
            assert hello["safeMode"] is True, hello
            with safe._lock:
                assert "FLOW_STARTED" not in safe._history, "flow ran in safe mode"
            # A successful deploy leaves safe mode and clears the counter.
            safe.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b""})
            safe.wait_for(lambda l: l == "FLOW_STARTED", description="redeployed flow runs")
            assert _hello_reply(safe, "after redeploy")["safeMode"] is False
            with open(count_path) as f:
                assert f.read().strip() == "0"
        finally:
            safe.close()

        # A normal boot counts up, then clears once the flow has stayed up.
        with open(count_path, "w") as f:
            f.write("1")
        normal = ListenerProcess(tmpdir)
        try:
            normal.wait_for(lambda l: l == "FLOW_STARTED", description="flow resumes on a normal boot")
            with open(count_path) as f:
                assert f.read().strip() == "2", "boot not counted"
            time.sleep(0.8)  # THINGSTUDIO_STABLE_AFTER_MS is 400 in these tests
            with open(count_path) as f:
                assert f.read().strip() == "0", "stable flow didn't clear the counter"
        finally:
            normal.close()



# --- WiFi transport (2026-09-24, wifi-transport-scoping.md) -----------------------------------

import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402
import socket  # noqa: E402


def _free_port(kind=socket.SOCK_STREAM):
    s = socket.socket(socket.AF_INET, kind)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _messages_after(listener, start_index, msg_type, timeout=5):
    """The first decoded F64 message of `msg_type` printed after history index `start_index`."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with listener._lock:
            snapshot = list(listener._history[start_index:])
        for line in snapshot:
            if line.startswith(F64_PREFIX):
                msg = _decode_f64_line(line)
                if msg["type"] == msg_type:
                    return msg
        time.sleep(0.05)
    raise AssertionError("no %s after index %d" % (msg_type, start_index))


def _mark(listener):
    with listener._lock:
        return len(listener._history)


def _client_answer(password, challenge):
    # Independent CPython implementation of what tcp_relay.py does: iterated SHA-256 key, stdlib hmac.
    parts = challenge.split(" ")
    assert parts[0] == "TSAUTH1" and len(parts) == 5, challenge
    nonce, salt, iters = bytes.fromhex(parts[2]), bytes.fromhex(parts[3]), int(parts[4])
    key = salt + password.encode()
    for _ in range(iters):
        key = hashlib.sha256(key).digest()
    return "TSAUTH1 " + hmac.new(key, nonce, hashlib.sha256).hexdigest()


class NetClient:
    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.buf = b""

    def readline(self, timeout=5):
        self.sock.settimeout(timeout)
        while b"\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise EOFError("connection closed; buffered %r" % (self.buf,))
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return line.decode()

    def read_message(self, msg_type, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = self.readline(timeout=max(0.1, deadline - time.time()))
            if line.startswith(F64_PREFIX):
                msg = _decode_f64_line(line)
                if msg["type"] == msg_type:
                    return msg
        raise AssertionError("no %s over the network session" % (msg_type,))

    def send_message(self, message):
        frame = protocol.encode_message(message)
        self.sock.sendall((F64_PREFIX + base64.b64encode(frame).decode("ascii") + "\n").encode())

    def close(self):
        self.sock.close()


def _net_listener(tmpdir):
    tcp, udp = _free_port(), _free_port(socket.SOCK_DGRAM)
    listener = ListenerProcess(
        tmpdir,
        {"THINGSTUDIO_NET_TEST_IP": "127.0.0.1", "THINGSTUDIO_NET_PORT": str(tcp), "THINGSTUDIO_NET_PROBE_PORT": str(udp)},
    )
    listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
    return listener, tcp, udp


def _set_password(listener, password, hostname="kitchen"):
    mark = _mark(listener)
    listener.send_message({"type": "SET_BOARD_SETTINGS", "hostname": hostname, "password": password})
    result = _messages_after(listener, mark, "BOARD_SETTINGS_RESULT")
    assert result["ok"] is True, result
    hello = _messages_after(listener, mark, "HELLO")
    return hello


def test_board_settings_over_serial():
    with tempfile.TemporaryDirectory() as tmpdir:
        listener = ListenerProcess(tmpdir)
        try:
            listener.wait_for(lambda l: l == "LISTENER_READY", description="LISTENER_READY")
            mark = _mark(listener)
            listener.send_message({"type": "SET_BOARD_SETTINGS", "password": "short"})
            bad = _messages_after(listener, mark, "BOARD_SETTINGS_RESULT")
            assert bad["ok"] is False and "8-64" in bad["error"], bad
            mark = _mark(listener)
            listener.send_message({"type": "SET_BOARD_SETTINGS", "hostname": "Bad Name"})
            assert _messages_after(listener, mark, "BOARD_SETTINGS_RESULT")["ok"] is False

            hello = _set_password(listener, "correct horse")
            assert hello["hostname"] == "kitchen" and hello["authRequired"] is True
            assert hello["authScheme"] == "hmac-sha256-nonce"
            with open(os.path.join(tmpdir, "_board.json")) as f:
                assert "correct horse" not in f.read()
        finally:
            listener.close()

        # Survives a restart (a real board: reset/power cycle).
        listener = ListenerProcess(tmpdir)
        try:
            line = listener.wait_for(lambda l: l.startswith(F64_PREFIX), description="HELLO after restart")
            hello = _decode_f64_line(line)
            assert hello["hostname"] == "kitchen" and hello["authRequired"] is True
        finally:
            listener.close()


def test_no_network_listener_without_password():
    with tempfile.TemporaryDirectory() as tmpdir:
        listener, tcp, udp = _net_listener(tmpdir)
        try:
            time.sleep(2.5)  # past one network check
            with listener._lock:
                assert not any(l.startswith("NET_LISTENING") for l in listener._history)
            try:
                socket.create_connection(("127.0.0.1", tcp), timeout=1).close()
                assert False, "TCP port open with no password set"
            except OSError:
                pass
            # The probe still answers, saying WiFi transport is off.
            u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            u.settimeout(3)
            u.sendto(b"TSPROBE1", ("127.0.0.1", udp))
            reply = json.loads(u.recvfrom(1024)[0])
            u.close()
            assert reply["wifiTransport"] is False and reply["hostname"].startswith("ts-"), reply
        finally:
            listener.close()


def test_network_session_end_to_end():
    with tempfile.TemporaryDirectory() as tmpdir:
        listener, tcp, udp = _net_listener(tmpdir)
        try:
            _set_password(listener, "correct horse")
            listener.wait_for(lambda l: l.startswith("NET_LISTENING 127.0.0.1:%d" % tcp), timeout=6, description="NET_LISTENING")

            u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            u.settimeout(3)
            u.sendto(b"TSPROBE1", ("127.0.0.1", udp))
            reply = json.loads(u.recvfrom(1024)[0])
            u.close()
            assert reply["hostname"] == "kitchen" and reply["port"] == tcp and reply["wifiTransport"] is True, reply

            # Wrong password: FAIL, then closed.
            c = NetClient(tcp)
            challenge = c.readline()
            assert challenge.split(" ")[1] == "kitchen"
            c.sock.sendall((_client_answer("wrong horse!", challenge) + "\n").encode())
            assert c.readline(timeout=5) == "TSAUTH FAIL"
            c.close()

            # Right password: OK, HELLO over the session, DEPLOY round trip, flow output mirrored.
            c = NetClient(tcp)
            challenge = c.readline()
            c.sock.sendall((_client_answer("correct horse", challenge) + "\n").encode())
            assert c.readline() == "TSAUTH OK"
            hello = c.read_message("HELLO")
            assert hello["networkAddress"] == "127.0.0.1" and hello["authRequired"] is True, hello

            # A second client while this session is open is refused.
            c2 = NetClient(tcp)
            assert c2.readline() == "TSAUTH BUSY"
            c2.close()

            bytecode = _compile_flow(tmpdir, "net_flow", "import runtime\nasync def _flow_0():\n    pass\nruntime.spawn(_flow_0(), '1')\n")
            c.send_message({"type": "DEPLOY", "bytecode": bytecode, "staticData": b"", "flowName": "net flow", "deployId": "d1"})
            ack = c.read_message("DEPLOY_ACK")
            assert ack["freeRamBytes"] > 0

            # Board settings can't be changed over the network.
            c.send_message({"type": "SET_BOARD_SETTINGS", "password": "another password"})
            res = c.read_message("BOARD_SETTINGS_RESULT")
            assert res["ok"] is False and "USB" in res["error"], res

            # A blank keepalive line is accepted silently and the session stays up.
            c.sock.sendall(b"\n")
            c.send_message({"type": "HELLO_REQUEST"})
            assert c.read_message("HELLO")["currentFlowName"] == "net flow"

            # Clearing the password over USB ends the session.
            mark = _mark(listener)
            listener.send_message({"type": "SET_BOARD_SETTINGS", "clearPassword": True})
            assert _messages_after(listener, mark, "BOARD_SETTINGS_RESULT")["ok"] is True
            listener.wait_for(lambda l: l.startswith("NET_SESSION_CLOSED"), timeout=5, description="session closed")
            try:
                while True:
                    c.readline(timeout=3)
            except (EOFError, OSError):
                pass
            c.close()
            listener.wait_for(lambda l: l.startswith("NET_STOPPED"), timeout=6, description="NET_STOPPED")
        finally:
            listener.close()


def test_network_session_auth_timeout_and_garbage():
    with tempfile.TemporaryDirectory() as tmpdir:
        listener, tcp, udp = _net_listener(tmpdir)
        try:
            _set_password(listener, "correct horse")
            listener.wait_for(lambda l: l.startswith("NET_LISTENING"), timeout=6, description="NET_LISTENING")
            c = NetClient(tcp)
            c.readline()
            c.sock.sendall(b"TSAUTH1 not-hex\n")
            assert c.readline(timeout=5) == "TSAUTH FAIL"
            c.close()
            # A client that connects and says nothing doesn't block the next one for long:
            # a half-open handshake isn't a session, so the next client gets its own challenge.
            idle = NetClient(tcp)
            idle.readline()
            c = NetClient(tcp)
            challenge = c.readline()
            assert challenge.startswith("TSAUTH1 kitchen "), challenge
            c.sock.sendall((_client_answer("correct horse", challenge) + "\n").encode())
            assert c.readline() == "TSAUTH OK"
            c.close()
            idle.close()
            # Listener survives all of it and still serves serial.
            mark = _mark(listener)
            listener.send_message({"type": "HELLO_REQUEST"})
            _messages_after(listener, mark, "HELLO")
        finally:
            listener.close()

TESTS = [
    test_hello_sent_on_boot,
    test_boot_time_flow_auto_resume,
    test_boot_time_resume_survives_corrupt_persisted_flow,
    test_start_reason_is_deploy_then_boot_reason,
    test_flow_identity_reported_in_hello_and_survives_resume,
    test_failed_redeploy_clears_flow_identity,
    test_hello_request_resends_hello_no_side_effects,
    test_deploy_success_and_flow_runs,
    test_node_error_reported_end_to_end,
    test_malformed_frame_soak_does_not_kill_listener,
    test_trigger_fires_the_registered_node_and_ignores_unknown_ids,
    test_exec_prints_results_keeps_variables_and_survives_errors,
    test_stop_to_prompt_stops_the_flow_and_ends_the_listener,
    test_boot_loop_safe_mode,
    test_board_settings_over_serial,
    test_no_network_listener_without_password,
    test_network_session_end_to_end,
    test_network_session_auth_timeout_and_garbage,
]


def main():
    if not MICROPYTHON_BIN or not shutil.which(MICROPYTHON_BIN):
        _skip("MICROPYTHON_BIN not set or not executable -- see device-runtime/test/README.md for the build recipe")
    if not MPY_CROSS_BIN or not shutil.which(MPY_CROSS_BIN):
        _skip("MPY_CROSS_BIN not set or not executable -- see device-runtime/test/README.md for the build recipe")

    passed = 0
    failed = []
    for t in TESTS:
        try:
            t()
            passed += 1
            print("PASS %s" % t.__name__)
        except Exception as e:
            failed.append((t.__name__, e))
            print("FAIL %s: %r" % (t.__name__, e))

    print("---")
    print("%d/%d passed" % (passed, passed + len(failed)))
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
