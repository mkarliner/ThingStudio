# Deploy the runtime itself from the browser editor, not just compiled flows

Confirmed untracked anywhere until 2026-09-12 (grep across `outstanding-items.md` and every
`outstanding-items/*.md`). Still wanted, priority **P3** (Mike, 2026-09-13).

## What exists today vs. what this asks for

Two genuinely different operations already share the word "deploy," and this item is about the one that isn't
built at all:

- **Flow deploy (built, works today):** the browser's Deploy button sends a §13 `DEPLOY` message -- compiled
  flow bytecode + static data -- over whatever transport is connected (WebSerial direct, or via the backend's
  WebSocket relay). `listener.py`'s `_handle_deploy()` (`device-runtime/src/listener.py` ~line 330) just writes
  those bytes to `_FLOW_PATH`/`_STATIC_DATA_PATH` on the device's filesystem and starts running it -- the
  listener process itself keeps running throughout, unmodified.
- **Runtime deploy (today: `test-flows/deploy_runtime.py`, a standalone hand-run script, not built into the
  editor at all):** pushes `device-runtime/src/*.py` itself -- `listener.py` (installed as `main.py`, so the
  board boots straight into it), `runtime.py`, `messages.py`, vendor libs (`mqtt_as`, etc.) -- via `mpremote cp`
  over the serial port. This is what makes the board able to speak the protocol and run flows at all; a runtime
  deploy is a precondition for any flow deploy ever working, not an alternative to one.

## Why this isn't just "reuse the DEPLOY message"

`DEPLOY` writes one bytecode file while the listener that's already running stays untouched. A runtime deploy
needs to overwrite the listener's own source files -- including the file it's currently executing from
(`main.py`) -- which a running MicroPython process can't cleanly do to itself. `mpremote`'s approach works
because it operates from the host machine against the board's raw REPL/filesystem access, entirely independent
of whatever's currently running on-device.

Doing this from the browser means either:

- A new §13 message type (or small family of them) for writing arbitrary named files to the device filesystem,
  handled by `listener.py` itself -- but `listener.py` would be rewriting its own currently-executing source,
  which needs careful sequencing (write files first, then explicitly `machine.reset()` to actually load the new
  code -- there's no way to "hot-swap" a running MicroPython module), and no visibility into whether the
  in-progress transfer is even a coherent set of files until reset actually happens.
- Or a recovery/bootstrap-mode path that doesn't depend on the currently-running listener at all (closer to what
  `mpremote`'s raw-REPL access does) -- which the direct-WebSerial transport could plausibly implement (Web
  Serial gives raw byte access to the port), but the via-backend transport would need the *backend* to speak
  raw-REPL directly rather than relaying through the listener's own framed protocol, a meaningfully different
  code path from every other backend-relay message today.

## Also relevant once this is picked up

`CLAUDE.md`'s "Device-runtime version bump discipline" section and `version.ts`'s `decideDeploy()`/
`checkRuntimeBuild()` -- a browser-triggered runtime deploy is exactly the mechanism that would make
`_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION` mismatches self-correcting rather than something Mike has to notice
and fix by re-running the manual script. Worth designing this item with that in mind rather than bolting version
awareness on afterward.

Not scoped further than this -- needs a real design session (which transport(s) to support first, whether v1
can be direct-WebSerial-only and defer the via-backend case, wire message shape) before it's buildable.

## Scoped, 2026-09-22 -- this is MVP item 1, and the two questions above are answered

Confirmed with Mike before writing any wire-protocol code (this doc's own "needs a real design session" line,
taken literally):

- **Transport: backend-relay only, not WebSerial-direct.** Matches `decisions/backend.md`'s 2026-09-08 entry
  (`direct` mode already hidden in `index.html`, no new investment per the 2026-08-16 addendum) -- Mike's own
  call, confirmed explicitly this session ("web serial is deprecated").
- **This doc's own framing of the two mechanisms as a choice is wrong -- they solve different problems, and
  only one of them solves *this* item.** A board with no runtime at all has nothing listening on the framed
  §13 protocol -- there's no running listener for a new "write-file" message family to reach. So:
  - **Raw-REPL bootstrap (this item's actual mechanism):** the backend drives MicroPython's raw REPL directly
    over the already-open `pyserial` connection `serial_relay.py` already has -- same primitive `mpremote`
    uses, no new dependency (the MVP's own fixed decision already rules out asking users to `pip install
    mpremote`, `serial_relay.py` already depends on plain `pyserial`). This is the only mechanism that works
    for an initial install on a bare-MicroPython board.
  - **A listener-side self-rewrite message family (this doc's other option):** only useful for a board that
    already has *some* working listener -- an in-place runtime *upgrade*, not an initial install. Real, and
    ties into `CLAUDE.md`'s version-bump-discipline section (an auto-correcting `_RUNTIME_VERSION`/
    `EDITOR_TARGET_VERSION` mismatch), but it's a different, separate future item -- not scoped further here,
    not blocking this one.
- **v1 ships a manual "Install runtime" action, not automatic detection.** No preference from Mike on this
  point, so defaulting to the cheaper, faster-to-ship slice: always offer the action when not connected/no
  HELLO, rather than first building the boot-log-based "no runtime" detection
  (`learnings/hardware-bringup-hil-rig.md`'s 2026-09-18 `LISTENER_BOOTING`-line finding) to gate it. Detection
  can be layered on top later without changing the install mechanism itself.

**Built, 2026-09-22 -- backend + editor, NOT yet verified against real hardware.** Mike had no board available
this session ("part the validation, for the moment, I don't have a real board on me"), so this landed with full
unit-test rigor but zero hardware confirmation -- treat every claim below as "implemented and tested against
fakes," not "confirmed working."

Layers, bottom to top:

- `backend/src/thingstudio_backend/raw_repl.py` (new) -- the raw-REPL client itself: `enter_raw_repl()`,
  `exec_raw()`, `write_file_chunked()` (base64-chunked, 256-byte chunks -- a whole-file paste risks the same
  `MemoryError` pressure `learnings/hardware-bringup-hil-rig.md` already documents on real hardware for a large
  file like `mqtt_as.py`), `hard_reset()`, and `install_runtime()` tying them together. Structured
  `RawReplError` (this backend's existing `NODE_ERROR`-prefixed attribution convention, not a bare exception),
  every read time-bounded via `RawReplTimeouts`. Unit-tested against a fake port
  (`backend/test/test_raw_repl.py`, 10 tests) -- a real protocol bug (a `_read_until()` that silently dropped
  bytes read past a marker within the same physical chunk) was caught this way, not by inspection; see the
  file's own header and `learnings/` for the incident if one gets written up separately.
- `device-runtime/runtime_manifest.py` (new) -- `CORE_FILES`/`LISTENER_FILE`/`VENDOR_FILES` moved here from
  `test-flows/deploy_runtime.py` so that script and the new backend path share one file list instead of two
  hand-maintained copies that can silently drift.
- `backend/src/thingstudio_backend/runtime_installer.py` (new) -- reads the real files off disk via the shared
  manifest and drives `raw_repl.install_runtime()`. Tested against a fake tree and, separately, a smoke test
  against the real `device-runtime/src` manifest (confirms every real file resolves and reads non-empty, with
  nothing pushed).
- `backend/src/thingstudio_backend/ws_relay.py` (edited) -- new `install_runtime` / `install_runtime_result`
  control-plane message pair. Closes any existing relay connection on that WS session first, then runs the
  install as one blocking `asyncio.to_thread()`. Deliberately does **not** auto-reconnect after the install's
  hard reset -- USB re-enumeration timing after a reset varies per board/OS, and per `CLAUDE.md`'s "don't chase
  every board's idiosyncrasy" corollary the answer is a legible manual reconnect, not a guessed wait.
- `editor/src/protocol/backend-transport.ts` (edited) -- `BackendTransport.installRuntime(port, baudRate?)`,
  mirroring `connectPort()`'s pending-promise pattern; a new `"install_runtime_result"` case in
  `#handleControlMessage`. Tested in `editor/test/backend-transport.test.ts` (4 new cases: success, backend
  error, default baudrate, rejection on `disconnect()` mid-flight).
- `editor/index.html` / `editor/src/app/main.ts` (edited) -- a new "Install runtime…" button, visible only in
  "via backend" mode (same as the port picker/refresh controls -- there's no WebSerial-direct equivalent). The
  click handler disconnects the editor's own live session first if one is holding the port open, runs the
  install via its own short-lived `BackendTransport` (same shape `refreshBackendPorts()`'s probe already uses),
  and on success tells the user to reconnect manually -- it does not attempt to reconnect itself, matching the
  backend's own no-auto-reconnect choice above.

Verification done this session: `tsc --noEmit` clean (one pre-existing, unrelated error in
`test/node-startup.test.ts` -- a `codegenFireableSource` property check, nothing to do with this work); the
full backend test suite (143 tests) and the editor's `backend-transport.test.ts` (16 tests, including the 4 new
ones) passing in isolated verify environments, never against the live-mounted tree (`CLAUDE.md`'s npm/build
rule). **Not done:** any real-hardware pass. Before trusting this against a real board, confirm at minimum:
raw-REPL timing/chunk-size behavior on at least one real ESP32 and one real RP2040 (the two platform families
this project targets), and what actually happens to the OS-visible serial port across the hard reset (does it
stay enumerated, re-enumerate under the same path, or disappear and require a manual re-plug/re-select in
`backendPortSelect`) -- that answer is what future work (e.g. attempting an auto-reconnect) would depend on, and
right now it's unknown, not just unbuilt.
