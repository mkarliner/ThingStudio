#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/deploy_flow.py
#
# Generic "load a compiled flow onto a real DUT and watch it" tool --
# reuses test/hil/hil_common.py's DutLink/compile_flow rather than
# reinventing the §13 wire-protocol handling, same as every test/hil/
# driver script. Not itself a hardware-in-the-loop *check* (no witness
# board, no pass/fail assertions) -- this is for a human at the DUT
# physically exercising a flow and watching the console, which is exactly
# what test-flows/ is for (see its README).
#
# Takes an already-compiled .py source file (NOT a flow.json -- see
# test-flows/README.md for the JSON -> Python step via
# editor/src/dev-tools/compile-flow.ts, kept separate so this script has
# no Node/tsc dependency of its own, only pyserial + mpy-cross like the
# rest of test/hil/).
#
# Usage:
#   python3 deploy_flow.py --dut-port /dev/ttyUSB0 --mpy-cross /path/to/mpy-cross /tmp/interrupt-basic.py

import argparse
import os
import sys
import tempfile
import time

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_THIS_DIR, "..", "test", "hil"))
from hil_common import DutLink, compile_flow, deploy_message  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dut-port", required=True)
    parser.add_argument("--mpy-cross", required=True, help="path to a native mpy-cross build (device-runtime/test/README.md)")
    parser.add_argument("py_path", help="already-compiled flow source (see test-flows/README.md)")
    args = parser.parse_args()

    with open(args.py_path) as f:
        source = f.read()

    with tempfile.TemporaryDirectory() as tmpdir:
        bytecode = compile_flow(args.mpy_cross, tmpdir, "flow", source)

        dut = DutLink(args.dut_port)
        try:
            print("Waiting for the DUT's boot-time HELLO (reset the board now if it's not fresh)...")
            dut.ser.reset_input_buffer()
            try:
                dut.wait_for_message(lambda m: m["type"] == "HELLO", timeout_s=8, description="DUT's boot-time HELLO")
                print("Got HELLO.")
            except TimeoutError:
                print("No fresh HELLO seen in 8s -- continuing anyway (the DUT may already be running from a prior boot); DEPLOY still works without one, per main.ts's own soft-on-absence gate.")

            print("Sending DEPLOY (%d bytes bytecode)..." % len(bytecode))
            dut.send_message(deploy_message(dut, args.mpy_cross, tmpdir, source, bytecode))
            dut.wait_for_message(lambda m: m["type"] == "DEPLOY_ACK", timeout_s=8, description="DEPLOY_ACK")
            print("DEPLOY_ACK received. Flow is running. Watching for NODE_ERROR / console output -- Ctrl-C to stop.")

            deadline = time.time() + 1.5
            while time.time() < deadline:
                line = dut.read_line()
                if line is not None and not line.startswith("F64:"):
                    print("[console] %s" % line)

            while True:
                line = dut.read_line()
                if line is None:
                    continue
                if line.startswith("F64:"):
                    import base64

                    frame = base64.b64decode(line[len("F64:") :])
                    for result in dut.decoder.push(frame):
                        if "message" in result:
                            msg = result["message"]
                            if msg.get("type") == "NODE_ERROR":
                                print("!! NODE_ERROR node=%s %s: %s" % (msg.get("nodeId"), msg.get("exceptionType"), msg.get("exceptionMessage")))
                            else:
                                print("[protocol] %s" % msg)
                else:
                    print("[console] %s" % line)
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            dut.close()


if __name__ == "__main__":
    main()
