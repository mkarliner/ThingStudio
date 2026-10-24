#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_exchanges.py
#
# The board's half of interfaces/protocol/vectors/exchanges.json (SPEC.md §7): each exchange is played against a
# fresh `micropython listener.py`, sending the editor's lines and checking the board answers exactly the script's
# lines, in order, and nothing else. The editor runs the same file against its sender
# (editor/test/protocol-exchanges.test.ts), so the two sides cannot each pass while disagreeing.
#
# CPython 3, like test_listener_integration.py (whose ListenerProcess it reuses), and needs the same two binaries:
#   MICROPYTHON_BIN=... MPY_CROSS_BIN=... python3 device-runtime/test/test_exchanges.py
# Skips, rather than fails, without them.

import base64
import json
import os
import sys
import tempfile
import time

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, THIS_DIR)
import test_listener_integration as T  # noqa: E402  (also puts device-runtime/src on the path)

VECTORS = os.path.join(THIS_DIR, "..", "..", "interfaces", "protocol", "vectors", "exchanges.json")

# Compared on every key but these: free-memory figures and human-readable text vary by board and wording.
_VOLATILE = ("freeFlashBytes", "freeRamBytes", "freeIdfHeapBytes", "largestIdfHeapBlockBytes", "error", "message")
_SETTLE_S = 0.25  # after the expected answers, how long to watch for an unexpected extra one


def _resolve(value, flow):
    """{"$bytes": hex} -> bytes, {"$flow": true} -> the compiled flow, {"$flowLength": true} -> its length."""
    if isinstance(value, dict):
        if set(value) == {"$bytes"}:
            return bytes.fromhex(value["$bytes"])
        if set(value) == {"$flow"}:
            return flow
        if set(value) == {"$flowLength"}:
            return len(flow)
        return {k: _resolve(v, flow) for k, v in value.items()}
    return value


def _comparable(message):
    return {k: v for k, v in message.items() if k not in _VOLATILE and v is not None}


def _board_messages(listener, mark):
    with listener._lock:
        lines = listener._history[mark:]
    return [T._decode_f64_line(line) for line in lines if line.startswith(T.F64_PREFIX)]


def run_exchange(exchange, tmpdir):
    flow = b""
    if "flowSource" in exchange:
        flow = T._compile_flow(tmpdir, "exchange_flow", exchange["flowSource"])
    listener = T.ListenerProcess(tmpdir)
    try:
        listener.wait_for(lambda line: line == "LISTENER_READY", description="LISTENER_READY")
        listener.wait_for(lambda line: line.startswith(T.F64_PREFIX) and T._decode_f64_line(line)["type"] == "HELLO",
                          description="the boot HELLO")
        time.sleep(0.1)
        steps = exchange["steps"]
        i = 0
        while i < len(steps):
            step = steps[i]
            mark = T._history_len(listener)
            if "editorRaw" in step:
                listener.send_raw_line(T.F64_PREFIX + base64.b64encode(bytes.fromhex(step["editorRaw"])).decode("ascii"))
            elif step.get("garbled"):
                listener.send_raw_line(T.F64_PREFIX + "!!!garbled line, not base64!!!")
            elif "editor" in step:
                listener.send_message(_resolve(step["editor"], flow))
            else:
                raise AssertionError("step %d: a board step must follow an editor step" % (i,))
            i += 1
            expected = []
            while i < len(steps) and "board" in steps[i]:
                expected.append(_resolve(steps[i]["board"], flow))
                i += 1
            deadline = time.time() + 15
            while len(_board_messages(listener, mark)) < len(expected) and time.time() < deadline:
                time.sleep(0.02)
            time.sleep(_SETTLE_S)
            got = _board_messages(listener, mark)
            want = [_comparable(m) for m in expected]
            have = [_comparable(m) for m in got]
            assert have == want, "after step %d the board sent:\n  %r\nexpected:\n  %r" % (i, have, want)
    finally:
        listener.close()


def main():
    if not T.MICROPYTHON_BIN or not T.MPY_CROSS_BIN:
        T._skip("set MICROPYTHON_BIN and MPY_CROSS_BIN (see device-runtime/test/README.md)")
    with open(VECTORS) as f:
        exchanges = json.load(f)["exchanges"]
    assert exchanges, "no exchanges"
    failed = []
    for exchange in exchanges:
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                run_exchange(exchange, tmpdir)
                print("PASS %s" % (exchange["name"],))
            except Exception as e:  # noqa: BLE001 -- this is the test-failure boundary
                failed.append(exchange["name"])
                print("FAIL %s: %s" % (exchange["name"], e))
    print("---")
    print("%d/%d passed" % (len(exchanges) - len(failed), len(exchanges)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
