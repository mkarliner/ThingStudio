# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/board_recovery.py
#
# "Remove flow from board": deletes the saved flow so the board boots into the listener alone.
# Mike, 2026-09-23: "need a way of deleting flows that cause a boot loop or similar lock out.
# mpremote rm is not enough."
#
# Why mpremote rm isn't enough: once listener.py is running it has switched Ctrl-C off (the serial
# line belongs to the protocol), so the only way to the prompt is the 3s window at boot where Ctrl-C
# still works. mpremote sends its interrupt once, when it connects -- it has to be lucky. This keeps
# sending Ctrl-C every half second for up to a minute while the user presses reset (or while a
# boot-looping board reboots on its own), so one lands inside a boot window. A board whose native
# USB port disappears across the reset (ESP32-S2/S3, RP2040) is reopened in the loop.
#
# The editor sends STOP_TO_PROMPT first when the board is still answering, so a healthy board is at
# ">>>" before this starts and nothing needs resetting. The listener's own safe mode
# (listener.py, _BOOT_COUNT_PATH) already handles a flow that crashes the board on start; this is for
# the rest -- a flow that hogs the CPU so the listener never gets to run, say.

from __future__ import annotations

import logging
import time
from typing import Callable

from . import raw_repl
from .raw_repl import RawReplError, read_available

logger = logging.getLogger(__name__)

# Everything listener.py keeps on flash for the current flow. Removing all of them leaves the board
# exactly as a fresh Install runtime does: listener only, nothing to resume.
FLOW_FILES = ("/_flow.mpy", "/_flow_static.bin", "/_flow_meta.json", "/_flow_wifi_provision.json", "/_boot_count")

CATCH_STEP = "waiting for the board to stop at a prompt"
_PROMPT_MARKERS = (b">>>", b"raw REPL", b"KeyboardInterrupt")
_REOPEN_PAUSE_S = 0.3

_REMOVE_CODE = (
    "import os\n"
    f"for _p in {FLOW_FILES!r}:\n"
    "    try:\n"
    "        os.remove(_p)\n"
    "    except OSError:\n"
    "        pass\n"
    "print('THINGSTUDIO_FLOW_REMOVED')\n"
).encode()

StatusCallback = Callable[[str], None]


def catch_prompt(open_port: Callable[[], object], deadline: float, on_status: StatusCallback):
    """Sends Ctrl-C until the board answers from a prompt; returns the open port. Reopens the port
    whenever it goes away (a native-USB board re-enumerating across a reset). Also Install runtime's
    first step (ws_relay.py), since 2026-09-24: a Pico has no reset-on-open, so a single Ctrl-C at a
    running listener got nothing back."""
    port = None
    seen = b""
    told_to_reset = False
    try:
        while time.monotonic() < deadline:
            if port is None:
                try:
                    port = open_port()
                except Exception:  # noqa: BLE001 -- port not back yet after a reset; keep trying
                    time.sleep(_REOPEN_PAUSE_S)
                    continue
            try:
                port.write(raw_repl._CTRL_C)
                chunk = read_available(port, 256)
            except Exception:  # noqa: BLE001 -- the board reset under us; reopen on the next pass
                logger.info("board went away while waiting for a prompt -- reopening")
                _close_quietly(port)
                port = None
                continue
            seen = (seen + chunk)[-400:]
            if any(m in seen for m in _PROMPT_MARKERS):
                p, port = port, None
                return p
            if not told_to_reset:
                on_status("Waiting for the board. If nothing happens, press its reset button, or unplug it and plug it back in.")
                told_to_reset = True
        raise RawReplError(
            CATCH_STEP,
            "the board never stopped at a prompt -- press its reset button (or unplug and replug it) while this is waiting",
            seen=seen,
        )
    finally:
        if port is not None:
            _close_quietly(port)


def _close_quietly(port) -> None:
    try:
        port.close()
    except Exception:  # noqa: BLE001
        pass


def remove_flow(open_port: Callable[[], object], timeout_s: float, on_status: StatusCallback) -> None:
    """Deletes the saved flow (FLOW_FILES) and hard-resets the board. Raises RawReplError naming the
    step on any failure. `open_port` opens the serial port fresh each time it's called."""
    port = catch_prompt(open_port, time.monotonic() + timeout_s, on_status)
    try:
        on_status("Board stopped. Removing the saved flow…")
        raw_repl.enter_raw_repl(port)
        out = raw_repl.exec_raw(port, _REMOVE_CODE, "removing the saved flow")
        if b"THINGSTUDIO_FLOW_REMOVED" not in out:
            raise RawReplError("removing the saved flow", f"unexpected output: {out!r}")
        raw_repl.hard_reset(port)
    finally:
        _close_quietly(port)
