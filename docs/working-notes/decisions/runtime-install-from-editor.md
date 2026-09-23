# Decisions — Runtime install from the editor

Status: detail file for `decisions.md`'s "Runtime install from the editor" index entry.

- **2026-09-22 — MVP item 1 (`mvp-kickoff-brief.md`) built end-to-end, backend-relay only, NOT yet
  verified against real hardware.** Confirmed with Mike before writing any wire-protocol code
  (`outstanding-items/deploy-runtime-from-editor.md`'s own "needs a real design session" line,
  taken literally):
  - **Transport: backend-relay only, not WebSerial-direct.** Matches `decisions/backend.md`'s
    2026-09-08 entry (`direct` mode already hidden in `index.html`, no new investment per the
    2026-08-16 addendum) — confirmed explicitly this session ("web serial is deprecated").
  - **v1 ships a manual "Install runtime" action, not automatic no-runtime detection.** No
    preference from Mike on this point; defaulted to the cheaper, faster-to-ship slice — always
    offer the action, rather than first building boot-log-based detection
    (`learnings/hardware-bringup-hil-rig.md`'s 2026-09-18 `LISTENER_BOOTING`-line finding) to gate
    it. Detection can be layered on top later without changing the install mechanism itself.
  - **This item's own earlier scoping framed two mechanisms as a choice — that framing was wrong.**
    A board with no runtime at all has nothing listening on the framed §13 protocol, so a
    listener-side self-rewrite message family (the other option) can't solve an *initial* install —
    it only ever works for a board that already has *some* listener running (an in-place upgrade,
    a separate future item, not blocking this one). Raw-REPL bootstrap — the backend driving
    MicroPython's raw REPL directly over the same `pyserial` connection `serial_relay.py` already
    holds, the same primitive `mpremote` uses — is the only mechanism that actually solves this
    item's stated problem.
- **Layers built, bottom to top** (full detail in `outstanding-items/deploy-runtime-from-editor.md`'s
  2026-09-22 update, not repeated here):
  - `backend/src/thingstudio_backend/raw_repl.py` — the raw-REPL protocol client (`enter_raw_repl`,
    `exec_raw`, `write_file_chunked`, `hard_reset`, `install_runtime`), structured `RawReplError`
    (this backend's `NODE_ERROR` attribution convention), every read time-bounded. A real protocol
    bug (a `_read_until` that silently dropped bytes read past a marker within one physical chunk)
    was caught by `backend/test/test_raw_repl.py`'s own tests failing, not by inspection.
  - `device-runtime/runtime_manifest.py` — `CORE_FILES`/`LISTENER_FILE`/`VENDOR_FILES` moved here
    from `test-flows/deploy_runtime.py`, now shared by that script and the new
    `runtime_installer.py` so the two file lists can't silently drift the way two hand-maintained
    copies of the same list eventually do.
  - `backend/src/thingstudio_backend/runtime_installer.py` — reads the real files off disk via the
    shared manifest, drives `raw_repl.install_runtime()`.
  - `backend/src/thingstudio_backend/ws_relay.py` — new `install_runtime`/`install_runtime_result`
    control-plane message pair. Closes any existing relay connection on that WS session first, runs
    the install as one blocking `asyncio.to_thread()`. Deliberately does not auto-reconnect after
    the hard reset — per `CLAUDE.md`'s "don't chase every board's idiosyncrasy, make the failure
    legible instead" corollary, USB re-enumeration timing after a reset isn't something to chase
    across boards/OSes; a manual reconnect is the legible answer, not a guessed wait.
  - `editor/src/protocol/backend-transport.ts` — `BackendTransport.installRuntime(port, baudRate?)`,
    mirroring `connectPort()`'s pending-promise pattern; a new `"install_runtime_result"` case in
    `#handleControlMessage`.
  - `editor/index.html` / `editor/src/app/main.ts` — an "Install runtime…" button, visible only in
    "via backend" mode. Disconnects the editor's own live session first if one is holding the port
    open (a second WS connection installing on the same port would otherwise conflict with it), runs
    the install via its own short-lived `BackendTransport`, and on success tells the user to
    reconnect manually rather than attempting to reconnect itself.
- **Verified:** `backend/test/test_raw_repl.py` (10 cases), `backend/test/test_runtime_installer.py`
  (5 cases, including a smoke test against the real manifest with nothing pushed),
  `backend/test/test_ws_relay.py` (5 new cases for the install-runtime control messages),
  `editor/test/backend-transport.test.ts` (4 new cases) — all passing, full backend suite (143
  tests) and this editor test file (16 tests) run in isolated environments, never against the
  live-mounted tree (`CLAUDE.md`'s npm/git-write rules). `tsc --noEmit` clean except one
  pre-existing, unrelated error in `test/node-startup.test.ts`.
- **Not done — real hardware.** No board was available this session
  ("part the validation, for the moment, I don't have a real board on me" — Mike, 2026-09-22).
  Every layer above is implemented and unit-tested against fakes only. Before trusting this against
  a real board: confirm raw-REPL chunk-size/timing behavior on at least one real ESP32 and one real
  RP2040, and what actually happens to the OS-visible serial port across the hard reset (stays
  enumerated / re-enumerates under the same path / disappears and needs a manual re-select in
  `backendPortSelect`) — right now that's unknown, not just unbuilt, and it's what any future
  auto-reconnect attempt would need to design against.
- **2026-09-23 — Failures now say what the board sent back and what to do next.** First real-hardware
  run, deliberately done the way a newcomer who skipped the docs would: a blank ESP32-S2 (no
  MicroPython), Connect then Install runtime. Connect's no-HELLO text pointed at the old
  `deploy_runtime.py` terminal step; the install failed with `entering raw REPL ... last seen: b''`.
  Accurate, but no next step. Fix, "fail well" over "work badly":
  - `raw_repl.classify_reply()` names what came back after Ctrl-C/Ctrl-A (`silent`, `micropython`,
    `circuitpython`, `esp_rom`, `other`); `ws_relay.py` sends it as `install_runtime_result`'s
    `diagnosis`, only when the failure was at `ENTER_STEP` (a mid-push failure says nothing about
    the firmware).
  - Wording lives only in `editor/src/app/board-diagnosis.ts`, so backend and editor can't give
    different advice. The same module classifies the plain text lines seen after a HELLO_REQUEST, so
    Connect and Check status now say "MicroPython but no runtime: click Install runtime…" instead of
    a fixed guess. That is also the first cut of item 1's "detect a board with no runtime" — it
    detects and says so, it doesn't yet auto-offer a button.
  - New user doc page `installing-micropython.md`, plus a "Board won't connect" table in
    `debugging.md`.
  - Verified: backend pytest 180 passed; editor vitest 578/581 (the same 3 known failures:
    `node-startup.test.ts` x2, flaky `node-eswitch` timing), `tsc` only the known
    `node-startup.test.ts` error. Both run in an isolated copy, not the shared mount.
- **2026-09-23 — Install can no longer hang silently.** Same ESP32-S2, now with MicroPython: detection worked
  ("MicroPython but not the Thingstudio runtime"), then Install runtime sat with no output and no end. Root
  cause not yet known; the silent hang itself was ours: the install port had no write timeout (pyserial
  blocks forever by default) and the editor had no timeout at all. Fixed:
  - `ws_relay.py` opens the install port with `write_timeout` 5s; every write goes through
    `raw_repl._write()`, which turns a failure into a `RawReplError` naming the step.
  - Pastes are sent in 256-byte pieces with a 10ms pause, as upstream `pyboard.py` does — classic raw REPL
    has no flow control. A plausible cause of the hang, not a confirmed one.
  - Per-file progress: `install_runtime_progress` messages, shown in the console as `[install runtime] 3/14
    messages.py`; backend logs each file at INFO, each exec at DEBUG.
  - `BackendTransport.installRuntime()` gives up after 30s with no progress or result (diagnosis
    `"stalled"`, with advice to replug and retry).
  - Size for scale: 14 files, ~168 KB, ~690 raw-REPL execs per install.
- **2026-09-23 — Root cause of the "hang": every read waited out its full timeout.** The backend log from
  that run showed the install still going 3.5 minutes in, ending only when the board was unplugged.
  `_ByteReader` called `port.read(256)`; pyserial's `read(n)` waits for n bytes *or* the 0.5s timeout, and a
  raw-REPL reply is ~4 bytes, so each of ~690 execs cost 0.5s (~6 min per install, silent). Fixed with
  `raw_repl.read_available()` (read what's waiting, else wait for one byte — pyboard.py's approach). Measured
  through real pyserial on a pty against a simulated raw REPL: old read 26.1s for 2 files; new read 7.8s for
  all 14. `serial_relay.py`'s relay loop had the same pattern (`read(4096)`), delaying every relayed frame by
  up to 0.5s; it uses `read_available()` too now. Same pass: a mid-install read failure was mislabelled
  "serial open failed" (now a `RawReplError` naming the step), and closing the relay while its read was in
  flight logged a spurious `Bad file descriptor` warning (now a quiet end of the read loop).
- **2026-09-23 — Consume the raw-REPL prompt after each exec.** Next real run failed at `pushing errors.py
  (chunk 2 of 7): unexpected bytes before OK echo: b'>OK'`. The device sends a fresh `>` after every exec;
  `exec_raw()` never read it, so it landed in front of the next exec's `OK`. The old over-reading `read(256)`
  had been swallowing it by luck of timing. `exec_raw()` now reads through the `>`. Reproduced before fixing:
  the pty simulator, changed to trickle each reply a piece at a time like a real USB CDC device, fails with
  the identical error without the fix and completes all 14 files (11.1s) with it. Test fakes now include the
  prompt in every scripted reply, as a real device does.
- **2026-09-23 — First end-to-end success on real hardware.** LOLIN S2 Mini (ESP32-S2FN4R2), MicroPython
  flashed from the new docs page: Install runtime pushed all 14 files in 24s with per-file progress, the board
  reset, and Connect got a HELLO ~50ms later (runtime 1.0.0, compatible). macOS kept the same port name
  (`/dev/cu.usbmodem14201`) across the reset — one data point on the re-enumeration question, not a general
  answer. The one gap: `runtimeBuild: null`, because only `deploy_runtime.py` wrote `_runtime_build.txt`.
  `runtime_installer.runtime_build_sha()` now stamps the same marker (fails open with no git); `version.ts`'s
  null-build message no longer refers to `deploy_runtime.py`.
- **2026-09-23 — First blink from a blank board, following only the product and its docs.** Mike, LOLIN S2
  Mini: MicroPython from `installing-micropython.md`, Install runtime from the editor, then the new "Blink an
  LED" page (`first-flow.md`: timer → function `% 2` → gpio out). Not yet the formal acceptance test
  (road-to-mvp.md §1.5 wants a first-time user who isn't Mike), but every step of that path now exists and
  has run on real hardware. The docs build now gets the same stale-build banner as the editor, after the
  served Getting started page turned out to be the pre-rewrite version (`mkdocs build` not rerun).
