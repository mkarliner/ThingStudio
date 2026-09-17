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

# device-runtime/src/{...}.py, copied as-is -- everything listener.py
# imports at module scope. Same file list and order test/hil/README.md's
# step 4 documents.
# wifi_provision.py added 2026-09-14 -- listener.py's own guarded `import wifi_provision` degrades
# to a no-op on a board bootstrapped before this line existed (its own header comment), so an
# already-deployed board isn't broken by this list changing; it just needs a re-run of this script
# to pick up the new feature, same as any other core-file addition.
CORE_FILES = ["errors.py", "cbor.py", "framing.py", "messages.py", "protocol.py", "runtime.py", "wifi_provision.py"]

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
    os.path.join(_REPO_ROOT, "device-runtime", "src", "vendor", "primitives_events", "events.py"),
    os.path.join(_REPO_ROOT, "device-runtime", "src", "vendor", "primitives_events", "delay_ms.py"),
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


def _runtime_build_sha():
    """git SHA of the last commit that touched device-runtime/src, scoped
    (not the whole repo's HEAD) so an unrelated editor/docs-only commit
    doesn't make every already-bootstrapped board look stale for no
    reason. Belt-and-braces companion to _RUNTIME_VERSION -- see
    CLAUDE.md's "Device-runtime version bump discipline" and listener.py's
    own header on _RUNTIME_BUILD. None if git isn't available or this
    isn't a git checkout -- fails open (skips the marker, doesn't fail the
    bootstrap), matching this project's fault-handling-over-happy-path
    priority applied to tooling, not just device code."""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%H", "--", _RUNTIME_SRC],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        sha = out.stdout.strip()
        return sha or None
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", required=True, help="serial device path, e.g. /dev/tty.usbmodemXXXX")
    parser.add_argument("--no-vendor", action="store_true", help="skip vendor/ libs (threadsafe_event, mqtt_as, primitives_events) -- see VENDOR_FILES comment")
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
