# Briefing: the online editor with WebSerial (deploy and runtime install in the browser)

Status: brief, 2026-11-18. For an implementation session. Written from a read of the code on 2026-11-18, file
and line references as of commit `40314493`.

Read first (paths relative to `docs/working-notes/` unless rooted): `outstanding-items/online-and-offline-editor.md`
(the item this delivers, slices 1 and 2), `online-editor-demo-scoping.md` (the demo build this extends),
`interfaces/protocol/README.md` and `SPEC.md`, `decisions/runtime-install-from-editor.md`,
`decisions/editor-firmware-flashing.md`.

## Why now

The Hacker News repost on 2026-11-16 gave a clear signal. Over 11–17 November the demo server's own log shows
330 human visitors to demo.thingstudio.net, about 50 of whom went far enough to load the compile-hook
interpreter. The docs show only about 5 people working through the install tutorial (steps 2–6: 4–7 views
each). GoatCounter undercounts by up to 2.5× (204 demo arrivals from the landing page against 88 recorded
button clicks), but the ratio holds: people try things in the browser, not by installing. ESPHome and WLED
users already expect "plug in, click Connect in Chrome".

## Goal

A hosted build of the editor, in Chrome or Edge on a desktop, that can take a board which already has
MicroPython, install the Thingstudio runtime on it, and deploy flows to it, all over WebSerial with no backend.
That is slices 1 and 2 of `online-and-offline-editor.md`. Slice 3 (flashing MicroPython from the browser) is out
of scope: it reverses `decisions/editor-firmware-flashing.md` and needs its own decision from Mike.

## Where things stand (checked against code, 2026-11-18)

**Already done:**

- **The transport exists and speaks the current wire format.** `WebSerialTransport`
  (`editor/src/protocol/transport.ts:100`) does F64 line framing as in SPEC §5. It implements the shared
  `DeviceTransport` interface (24 October). Connect in direct mode is wired (`main.ts` ~3072: `navigator.serial.requestPort()`).
  It's hidden: `index.html:266` `<option id="connModeOptionDirect" value="direct" hidden>`.
- **Deploy logic is transport-agnostic.** HELLO handling, version gate, chunked transfer (`protocol/transfer.ts`,
  SPEC §7), library skip from the board's reported inventory (`boardDependencies` from HELLO), board settings
  (`SET_BOARD_SETTINGS`), and `HELLO_REQUEST` on Connect all live in the editor and go through the transport.
  The long comment at `main.ts` ~1365 saying the editor can't ask for a HELLO is stale: `HELLO_REQUEST` exists
  and Connect sends it (`main.ts` ~3174). Fix the comment in passing.
- **The compile is in the browser** (mpy-cross and micropython-wasi WASM), as the demo already shows.
- **A demo build mode exists:** `npm run build:demo` → `vite build --mode demo`, compile-time `__DEMO__`,
  `dist-demo/`, `tools/demo_request_check.py`, `packaging/demo-server/`. It is live at demo.thingstudio.net
  (`outstanding-items.md` still says "not live yet": update it).

**What still needs the backend, so blocks direct mode today:**

| Need | Today | File |
|---|---|---|
| Library list and sources for a deploy | `GET /api/dependencies`. Deploy is blocked with "no library list from the backend" without it. | `main.ts` ~3227, `backend/.../dependencies.py` |
| Runtime sources to install | `GET /api/runtime-sources` | `main.ts` ~2571 |
| Runtime install | `install_runtime` over the backend WebSocket: raw REPL driven from Python | `raw_repl.py` (353 lines), `runtime_installer.py` (208), `ws_relay.py` `_install_runtime_exclusive` |
| Remove flow (board recovery) | `remove_flow`, raw REPL | `board_recovery.py` (112), `ws_relay.py` |
| Command box (raw text to the board) | `raw_write` | `ws_relay.py` `_raw_write` |
| Flow save/open/list | `/api/flows` | demo build already has a non-backend path (`picker: !__DEMO__`) |
| Credentials and presets (WiFi, MQTT) | `/api/credentials`, `/api/presets` | `admin_api.py` |
| User board definitions, custom nodes | `/api/definitions`, `/api/custom-nodes` (read `~/.thingstudio`) | built-ins only online |
| WiFi transport, discovery | raw TCP from the backend | not possible in a browser: USB only online |
| Firmware flashing | `esptool` subprocess | out of scope (slice 3) |

## Tasks

### 1. An "online" build mode

Decide with Mike whether this replaces the demo or sits beside it (open question 1). Either way, add a build
flag next to `__DEMO__` (for example `__ONLINE__`, or a mode value) that keeps the board-facing UI but uses
direct mode with no backend. Every `!__DEMO__` gate in `main.ts` needs reviewing: about 30 of them, some of
which mean "has a board" and some "has a backend". Split those two meanings rather than piling on conditions.
Keep `tools/demo_request_check.py` passing: the page still requests nothing beyond its own assets and
GoatCounter.

**Done when:** the online build shows Connect, Deploy, Install runtime and Board settings; hides WiFi connect,
discovery, firmware flashing, custom nodes and user definitions; and the request check passes.

### 2. Libraries and runtime sources as static assets

Generate at build time what `/api/dependencies` and `/api/runtime-sources` return today, from the same sources
the backend reads (`backend/.../dependencies.py`, `device-runtime/runtime_manifest.py`). Emit them as JSON files
in the build output, and make the two fetches in `main.ts` read from there in the online build. One generator
for both builds, so the online editor can't drift from the installed one. The runtime version the editor targets
(`EDITOR_TARGET_VERSION`, currently 15.1.0) must match the runtime sources it ships. Add a test that checks this.

**Done when:** a deploy in the online build resolves and sends libraries with no backend, and installing the
runtime gets its files from the build.

### 3. Deploy over WebSerial on real hardware

Unhide direct mode in the online build and run a deploy on the boards the docs list as supported: at least a
classic ESP32 (USB-UART), an ESP32-S3 on native USB, and a Pico W. Watch for anything the backend's
`serial_relay.py` does that the browser path doesn't: DTR/RTS left untouched on open, a 5 s write timeout, and
reading what's available rather than waiting for full chunks. Earlier serial fixes (the classic-ESP32 link, the
2026-11-07 S3 USB mangling work) need re-checking on this path, since they were tested through the backend.

Before touching anything that emits or parses frames, follow `CLAUDE.md`/`AGENTS.md`'s interface rules: read
`interfaces/protocol/SPEC.md` and run the conformance vectors (`cd editor && npm test`,
`test/protocol-conformance.test.ts`). Mike runs npm commands on his Mac, or the session runs them in its own
extracted copy. Never against the live-mounted `editor/node_modules`. No protocol change without Mike's
explicit permission.

**Done when:** deploy, redeploy, NODE_STATUS and DEBUG output, and Board settings all work over WebSerial on the
three boards, and the conformance test passes.

### 4. Runtime install and Remove flow over WebSerial

Port the raw-REPL client to TypeScript over the WebSerial port: enter raw REPL, exec, chunked file write, hard
reset, with every read time-bounded as in `raw_repl.py`. Port the install sequence from `runtime_installer.py`
and `ws_relay.py`. That includes:

- the 2026-09-23 fixes (read latency, prompt handling, progress, timeouts, board diagnosis);
- precompiled `.mpy` runtime files (`precompileRuntime`, already in the editor);
- the custom-image case (14.1.0: a board with a frozen inventory module gets only `/main.py`);
- getting a running listener to stop. It ignores Ctrl-C, and a native-USB board doesn't reset on port open,
  so read what `_install_runtime_exclusive` does before assuming.

Remove flow (`board_recovery.py`) uses the same primitives, so port it alongside. `raw_write` (the command box)
becomes a plain write to the port.

The backend has tests for its raw REPL client (`backend/test/test_raw_repl.py`, which caught a real
dropped-bytes bug). Port those cases with the code, and test against a fake port.

**Done when:** on the three boards above, the online build installs the runtime on a board with fresh
MicroPython, then deploys a flow, and Remove flow recovers a board stuck on a crashing flow.

### 5. Credentials, flows and storage in the browser

Mike, 2026-11-08: credentials and similar settings could live in the browser's local storage. Design it with
him before building (open question 3). A flow that uses WiFi or MQTT needs the credentials at compile time.
For flows, reuse the demo's save/open path (File System Access in Chrome and Edge, which are the WebSerial
browsers anyway).

**Done when:** a WiFi/MQTT flow can be configured, deployed and reopened in the online build, and what's stored
where is written down.

### 6. Words

- The landing page and docs: what the online version does and doesn't do (USB only, Chrome/Edge desktop, no
  flashing yet). Adjust the "local only" message: the page still sends nothing anywhere except GoatCounter.
- A docs page or section: "Use it in your browser", covering the board needing MicroPython first, with links
  to the Pico UF2 and Espressif's own tools until slice 3 exists.
- Record the decision change: `decisions/runtime-install-from-editor.md` said "web serial is deprecated"
  (2026-09-22). Mike's 2026-11-18 call to reinstate it supersedes that. Add a dated entry rather than editing
  the old one. Close or update `ambiguous-browser-only-claim.md`.

## Open questions for Mike

1. Does the online version replace the demo at demo.thingstudio.net, or sit beside it (for example at
   app.thingstudio.net), with the demo kept for phones and Firefox/Safari?
2. Feature subset: is "USB only, built-in boards and nodes, no flashing" acceptable for the first release?
3. Credentials: local storage as-is, or encrypted with a passphrase? Should they be exportable?
4. Slice 3 (esptool-js for ESP32 flashing in the browser): decide now or after this ships?
5. Timing relative to the launch gates in `marketing-plan.md` section 8.
