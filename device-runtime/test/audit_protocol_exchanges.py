#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/audit_protocol_exchanges.py
#
# Re-runs the board-side findings of the 2026-10-24 protocol audit
# (docs/working-notes/reviews/2026-10-24-protocol-audit.md) against the real listener, and says for each one
# whether the fault is still there. Not a pass/fail test suite: it reports, so it can be run before and after
# a fix. Exits 0 either way.
#
# Same requirements and setup as test_listener_integration.py (CPython 3 driving a MicroPython unix-port
# `listener.py`): MICROPYTHON_BIN and MPY_CROSS_BIN must be set. See README.md in this folder.
#
#   MICROPYTHON_BIN=... MPY_CROSS_BIN=... python3 device-runtime/test/audit_protocol_exchanges.py

import base64
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_listener_integration as T  # noqa: E402  (also puts device-runtime/src on the path)
import framing  # noqa: E402

if not T.MICROPYTHON_BIN or not T.MPY_CROSS_BIN:
    T._skip("set MICROPYTHON_BIN and MPY_CROSS_BIN (see device-runtime/test/README.md)")


def _messages_since(listener, mark):
    with listener._lock:
        lines = listener._history[mark:]
    return [T._decode_f64_line(line) for line in lines if line.startswith(T.F64_PREFIX)]


def _send(listener, message, reply_type, wait_s=1.0):
    """Sends one message, waits, returns the replies of reply_type it caused."""
    mark = T._history_len(listener)
    listener.send_message(message)
    time.sleep(wait_s)
    return [m for m in _messages_since(listener, mark) if m["type"] == reply_type]


def _boot(tmpdir):
    listener = T.ListenerProcess(tmpdir)
    listener.wait_for(lambda line: line == "LISTENER_READY", description="LISTENER_READY")
    return listener


def _report(finding, still_present, what):
    print("%-10s %s: %s" % ("PRESENT" if still_present else "fixed", finding, what))


def finding_1_flow_piece_resend():
    """A resent FLOW_PUT for a piece the board already stored is refused, and so is every later deploy."""
    with tempfile.TemporaryDirectory() as tmpdir:
        flow = T._compile_flow(tmpdir, "f1", "print('F1')\n" * 400)
        listener = _boot(tmpdir)
        try:
            piece = {"type": "FLOW_PUT", "offset": 0, "total": len(flow), "data": flow[:5120]}
            _send(listener, piece, "FLOW_ACK")
            resend = _send(listener, piece, "FLOW_ACK")  # as after a lost FLOW_ACK
            fresh = _send(listener, piece, "FLOW_ACK")  # the next deploy, starting again at 0
            _report("Finding 1a", not resend[-1]["ok"], "resent piece 0 answered %r" % (resend[-1].get("code") or "ok",))
            _report("Finding 1b", not fresh[-1]["ok"], "a new deploy's first piece answered %r" % (fresh[-1].get("code") or "ok",))
        finally:
            listener.close()


def finding_2_library_piece_resend():
    """A resent DEP_PUT is refused, and the library stays refused for later deploys."""
    with tempfile.TemporaryDirectory() as tmpdir:
        dep = T._compile_flow(tmpdir, "ts_f2", "def hello():\n    return 'F2'\n")
        listener = _boot(tmpdir)
        try:
            def piece(offset):
                return {"type": "DEP_PUT", "name": "ts_f2", "file": "ts_f2.mpy", "offset": offset,
                        "total": len(dep), "data": dep[offset : offset + 16]}
            _send(listener, piece(0), "DEP_ACK")
            _send(listener, piece(16), "DEP_ACK")
            resend = _send(listener, piece(16), "DEP_ACK")  # as after a lost DEP_ACK
            fresh = _send(listener, piece(0), "DEP_ACK")  # the next deploy, starting the library again
            _report("Finding 2a", not resend[-1]["ok"], "resent piece answered %r" % (resend[-1].get("code") or "ok",))
            _report("Finding 2b", not fresh[-1]["ok"], "the library's next first piece answered %r" % (fresh[-1].get("code") or "ok",))
        finally:
            listener.close()


def finding_3_refused_flow_replaces_saved_flow():
    """A chunked deploy refused for a missing library still replaces the flow saved on flash."""
    with tempfile.TemporaryDirectory() as tmpdir:
        plain = T._compile_flow(tmpdir, "p", "import runtime\nasync def _f():\n    print('PLAIN_RAN')\nruntime.spawn(_f(),'1')\n")
        needs = T._compile_flow(tmpdir, "q", "import runtime\nimport ts_missing\nasync def _f():\n    print('NEEDS_RAN')\nruntime.spawn(_f(),'1')\n")
        listener = _boot(tmpdir)
        try:
            _send(listener, {"type": "DEPLOY", "bytecode": plain, "staticData": b"", "flowName": "plain",
                             "deployId": "d1", "dependencies": {}}, "DEPLOY_ACK")
            _send(listener, {"type": "FLOW_PUT", "offset": 0, "total": len(needs), "data": needs}, "FLOW_ACK")
            err = _send(listener, {"type": "FLOW_COMMIT", "total": len(needs), "flowName": "needs", "deployId": "d2",
                                   "dependencies": {"ts_missing": "h"}}, "DEPLOY_ERROR")
            assert err and err[-1]["code"] == "MissingDependency", err
            with open(os.path.join(tmpdir, "_flow.mpy"), "rb") as f:
                replaced = f.read() == needs
        finally:
            listener.close()
        listener = _boot(tmpdir)  # power cycle
        try:
            hello = _send(listener, {"type": "HELLO_REQUEST"}, "HELLO")[-1]
        finally:
            listener.close()
        _report("Finding 3", replaced,
                "after the refusal the saved flow is %s; after a reboot HELLO says %r is running"
                % ("the refused one" if replaced else "the old one", hello["currentFlowName"]))


def finding_6_unknown_type_answered_as_garbled():
    """A message type the board doesn't know is answered with a FLOW_ACK Garbled, not just logged."""
    with tempfile.TemporaryDirectory() as tmpdir:
        listener = _boot(tmpdir)
        try:
            mark = T._history_len(listener)
            frame = framing.encode_frame(99, b"\xa0")
            listener.send_raw_line(T.F64_PREFIX + base64.b64encode(frame).decode("ascii"))
            time.sleep(1.0)
            acks = [m for m in _messages_since(listener, mark) if m["type"] == "FLOW_ACK"]
            _report("Finding 6", bool(acks), "an unknown type 99 got %s" % ("a FLOW_ACK Garbled" if acks else "no reply"))
        finally:
            listener.close()


if __name__ == "__main__":
    print("Protocol audit 2026-10-24, board-side findings. PRESENT = the fault is still there.")
    finding_1_flow_piece_resend()
    finding_2_library_piece_resend()
    finding_3_refused_flow_replaces_saved_flow()
    finding_6_unknown_type_answered_as_garbled()
