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
import tempfile

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.join(_THIS_DIR, "..")
_RUNTIME_SRC = os.path.join(_REPO_ROOT, "device-runtime", "src")

# CORE_FILES/LISTENER_FILE/VENDOR_FILES used to be hardcoded here -- moved 2026-09-22 into
# device-runtime/runtime_manifest.py, shared with the new browser-triggered install path
# (backend/src/thingstudio_backend/runtime_installer.py) so the two can't silently drift the
# way two hand-maintained copies of the same list eventually do (this file's own git history
# already shows that risk: wifi_provision.py and st7789py.py/ssd1306.py were each added here by
# hand, at different times, with no automatic check the other consumer picked them up too).
sys.path.insert(0, os.path.join(_REPO_ROOT, "device-runtime"))
from runtime_manifest import CORE_FILES, LEGACY_ROOT_FILES, LISTENER_FILE  # noqa: E402 -- needs sys.path set first

# Vendored libraries are no longer pushed here (flow dependencies, 2026-10-07,
# docs/working-notes/flow-dependencies-scoping.md): the editor's Deploy installs the ones a flow
# imports into the board's /lib. What this script still does about them is delete the copies older
# runtimes put in the root (LEGACY_ROOT_FILES), which would otherwise shadow the /lib versions.


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", required=True, help="serial device path, e.g. /dev/tty.usbmodemXXXX")
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

    build_sha = _runtime_build_sha()
    if build_sha:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write(build_sha)
            marker_path = f.name
        try:
            mpremote(args.port, "cp", marker_path, ":_runtime_build.txt")
        finally:
            os.unlink(marker_path)
        print("Runtime build marker: %s (device-runtime/src @ this commit)" % build_sha)
    else:
        print(
            "WARN: couldn't determine device-runtime/src's git SHA (not a git checkout, or git isn't "
            "installed) -- skipping the runtime-build marker. The board will report runtimeBuild=None; "
            "the editor's belt-and-braces staleness check (CLAUDE.md) can't confirm freshness for it, "
            "same as any board bootstrapped before this feature existed."
        )

    # Old root copies of vendored libraries (see LEGACY_ROOT_FILES above). One exec, ignoring files
    # that aren't there, so a board that never had them is fine.
    legacy = []
    for name in LEGACY_ROOT_FILES:
        legacy += [name, name[:-3] + ".mpy"]
    mpremote(args.port, "exec", "import os\nfor f in %r:\n try:\n  os.remove(f)\n except OSError:\n  pass" % (legacy,))

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
