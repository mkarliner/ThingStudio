#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/deploy_runtime.py
#
# Pushes device-runtime's core .py files (+ vendor libs, by default) onto
# a board's filesystem via `mpremote`, with listener.py installed as
# main.py so the board boots straight into the listener. Scripts the
# one-time bootstrap step every hands-on session so far has done by hand
# (test/hil/README.md step 4's file list; docs/working-notes/
# rp2040-bringup-findings.md's "Runtime deployed via mpremote" note is the
# exact manual sequence this replays) -- not re-derived, just no longer
# re-typed by hand each time a new board gets set up.
#
# NOT the same thing as deploy_flow.py in this same directory: that one
# pushes a compiled FLOW over the already-running listener's own §13 wire
# protocol (DEPLOY / DEPLOY_ACK). This script pushes the RUNTIME ITSELF
# onto the device's filesystem -- deploy_flow.py's DEPLOY message means
# nothing until this has run at least once on a given board. Order:
#
#   python3 test-flows/deploy_runtime.py --port /dev/tty.usbmodemXXXX
#   # reset the board, confirm it boots to a HELLO (see the printed note below)
#   python3 test-flows/deploy_flow.py --dut-port /dev/tty.usbmodemXXXX --mpy-cross /path/to/mpy-cross /tmp/some-flow.py
#
# Requires `mpremote` (`pip install mpremote` -- not yet a tracked project
# dependency, same status as pyserial; see docs/third-party-licenses.md's
# note on tracking this once it's actually added).
#
# Usage:
#   python3 deploy_runtime.py --port /dev/tty.usbmodemXXXX
#   python3 deploy_runtime.py --port /dev/tty.usbmodemXXXX --no-vendor
#   python3 deploy_runtime.py --port /dev/tty.usbmodemXXXX --wipe

import argparse
import os
import subprocess
import sys

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.join(_THIS_DIR, "..")
_RUNTIME_SRC = os.path.join(_REPO_ROOT, "device-runtime", "src")

# device-runtime/src/{...}.py, copied as-is -- everything listener.py
# imports at module scope. Same file list and order test/hil/README.md's
# step 4 documents.
CORE_FILES = ["errors.py", "cbor.py", "framing.py", "messages.py", "protocol.py", "runtime.py"]

# Copied separately, installed AS main.py -- see main() below.
LISTENER_FILE = "listener.py"

# Vendor libs some (not all) node types need at runtime -- pushed by
# default since the cost is trivial (a few KB of flash) against the
# alternative (rediscovering an ImportError mid-flow-deploy later and
# having to come back to this script) -- the same "don't paint into a
# dead end" reasoning CLAUDE.md already names elsewhere. --no-vendor skips
# both for a leaner image if flash/RAM headroom is ever actually tight;
# rp2040-bringup-findings.md's own memory-headroom data (>75% RAM free
# with the runtime + threadsafe_event + a real flow loaded) suggests it
# isn't, for flows of similar size to what's been tested so far -- but
# that's one data point on one board, not a guarantee for every board/flow
# combination, hence the escape hatch rather than assuming it's always fine.
VENDOR_FILES = [
    os.path.join(_REPO_ROOT, "device-runtime", "src", "vendor", "threadsafe_event", "threadsafe_event.py"),
    os.path.join(_REPO_ROOT, "device-runtime", "src", "vendor", "mqtt_as", "__init__.py"),
]
# mqtt_as's __init__.py needs to land as mqtt_as.py (a single-file module),
# not as __init__.py under an mqtt_as/ package dir -- MicroPython's import
# system finds either shape, but a single flat file is simpler to push
# with this script's one-file-at-a-time cp calls and matches how the
# generated code imports it (`import mqtt_as`, not `from mqtt_as import ...`
# expecting a package).
VENDOR_DEST_NAMES = {
    os.path.join(_REPO_ROOT, "device-runtime", "src", "vendor", "mqtt_as", "__init__.py"): "mqtt_as.py",
}


def mpremote(port, *args):
    cmd = ["mpremote", "connect", port] + list(args)
    print("+ %s" % " ".join(cmd))
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", required=True, help="serial device path, e.g. /dev/tty.usbmodemXXXX")
    parser.add_argument("--no-vendor", action="store_true", help="skip vendor/ libs (threadsafe_event, mqtt_as) -- see VENDOR_FILES comment")
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="erase the device's whole filesystem first (mpremote fs rm -r :) -- DESTRUCTIVE, off by default, "
        "and not exercised against real hardware by this session -- if it errors on your mpremote version, "
        "fall back to `mpremote connect <port> fs ls` + deleting individually, or reflashing the UF2 for a plain Pico/Pico W.",
    )
    args = parser.parse_args()

    if not os.path.isdir(_RUNTIME_SRC):
        print("ERR: %s not found -- run this from inside the repo, not a copied-out script." % _RUNTIME_SRC, file=sys.stderr)
        sys.exit(2)

    if args.wipe:
        confirm = input("This will erase EVERYTHING on the device filesystem at %s. Type 'yes' to continue: " % args.port)
        if confirm.strip().lower() != "yes":
            print("Aborted.")
            sys.exit(1)
        mpremote(args.port, "fs", "rm", "-r", ":")

    for name in CORE_FILES:
        local = os.path.join(_RUNTIME_SRC, name)
        mpremote(args.port, "cp", local, ":%s" % name)

    listener_local = os.path.join(_RUNTIME_SRC, LISTENER_FILE)
    mpremote(args.port, "cp", listener_local, ":main.py")

    if not args.no_vendor:
        for local in VENDOR_FILES:
            dest_name = VENDOR_DEST_NAMES.get(local, os.path.basename(local))
            mpremote(args.port, "cp", local, ":%s" % dest_name)

    print("\nDone. Files now on the device:")
    mpremote(args.port, "ls")

    print(
        "\nReset the board (or power-cycle) to boot into the listener.\n"
        "Watch first boot with a PASSIVE serial connection -- NOT `mpremote repl` and NOT Thonny's Shell, "
        "both send a Ctrl-C on connect, which listener.py's own boot-delay window treats as "
        "'drop to REPL instead of starting' (see docs/working-notes/rp2040-bringup-findings.md's own gotcha note "
        "-- this bit that session and will bite the same way here). "
        "`mpremote connect %s` with no further subcommand works, or any serial monitor that doesn't "
        "auto-interrupt on open. You're looking for LISTENER_BOOTING -> LISTENER_READY -> a HELLO frame." % args.port
    )


if __name__ == "__main__":
    main()
