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
