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

    def __init__(self, tmpdir):
        self.tmpdir = tmpdir
        env = dict(os.environ)
        env["THINGSTUDIO_BOOT_DELAY_S"] = "0.1"
        env["THINGSTUDIO_FLOW_PATH"] = os.path.join(tmpdir, "_flow.mpy")
        env["THINGSTUDIO_STATIC_DATA_PATH"] = os.path.join(tmpdir, "_flow_static.bin")
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
            assert msg["runtimeVersion"] == {"major": 0, "minor": 1, "patch": 0}
            assert isinstance(msg["freeRamBytes"], int) and msg["freeRamBytes"] > 0
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


TESTS = [
    test_hello_sent_on_boot,
    test_deploy_success_and_flow_runs,
    test_node_error_reported_end_to_end,
    test_malformed_frame_soak_does_not_kill_listener,
    test_trigger_fires_the_registered_node_and_ignores_unknown_ids,
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
