# Decisions — Board recovery, command box, stop to prompt

Status: detail file for `decisions.md`'s "Board recovery, command box, stop to prompt" index entry.

- **2026-09-23 — Four pieces, Mike's call ("do all"), plus his addition of a command box.** From
  `mikes-questions-and-points.md`: "a way of deleting flows that cause a boot loop or similar lock out.
  mpremote rm is not enough" and "pausing run time so user can go to python prompt without rebooting, also
  resume." Runtime bumped to **2.0.0** (`_RUNTIME_VERSION` / `EDITOR_TARGET_VERSION` together, per CLAUDE.md:
  an editor sending EXEC/STOP_TO_PROMPT to a 1.x board gets LISTENER_IGNORED, and HELLO grew a field).
  - **Command box (EXEC, type 12).** Editor -> listener: `_handle_exec()` tries `eval`, falls back to
    `exec`, prints the repr or a traceback to stdout (relayed as console lines — no reply message). One
    globals dict for the listener's life, preloaded with gc/os/sys/time/machine. Runs synchronously in the
    listener task: a slow command pauses the flow; documented, not guarded.
  - **Stop flow & open prompt (STOP_TO_PROMPT, type 13).** Cancels the flow, re-enables Ctrl-C, stops the
    event loop so `main()` returns and MicroPython sits at `>>>`. Nothing rebooted or deleted. While there,
    the command box sends raw text (`ws_relay.py`'s new `raw_write`), Deploy is disabled, and **Restart
    Thingstudio** sends Ctrl-D (soft reset -> main.py -> listener + saved flow).
  - **Safe mode.** Each boot with a saved flow increments `/_boot_count`; the flow staying up 10s resets it;
    at 3 the listener skips WiFi provisioning and the flow, prints `LISTENER_SAFE_MODE`, and reports
    `HELLO.safeMode`. A successful DEPLOY clears it. Covers crash loops only, not a CPU-hogging flow.
  - **Remove flow…** (`board_recovery.py`). Why `mpremote rm` fails: after boot the listener has Ctrl-C
    off, so only the 3s boot window works and mpremote interrupts once. This sends Ctrl-C every ~0.5s for
    up to 60s, reopening the port when a native-USB board re-enumerates across a reset, then deletes every
    flow file (`/_flow.mpy`, static data, meta, WiFi marker, boot counter) over raw REPL and hard-resets.
    The editor first sends STOP_TO_PROMPT if the board is still answering, so a healthy board needs no
    reset; otherwise the console asks for one.
  - Controls live under the device console, not the top bar (full after the 2026-09-23 tidy-up).
  - Verified: real MicroPython unix port — 96 unit tests and 13 listener integration tests pass, including
    new ones for EXEC, STOP_TO_PROMPT (flow stops, main() returns) and safe mode (count, skip, clear on
    deploy, clear when stable). Two HELLO integration tests had been failing since 2026-09-10 (expected
    runtime 0.1.0); fixed to 2.0.0. Backend 214 passed (4 new fake-port tests for remove flow, 2 for
    raw_write/remove_flow wiring). Editor vitest 595/598 (same 3 known failures), protocol round-trips for
    both new types. **Not yet run on real hardware.**
