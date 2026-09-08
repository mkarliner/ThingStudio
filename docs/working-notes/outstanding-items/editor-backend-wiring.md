# Editor↔backend wiring — built and verified end-to-end on real hardware, 2026-09-07

**Picked up next session as expected** — `backend-persisted-data-protocol.md`'s own "suggested next-session
candidates" #1, confirmed via a clarifying question at the start of this chat. Before this session, two backend
surfaces existed and were tested (the WS serial relay, and the new admin API) and nothing in the browser could
reach either one (`backend-auth-overview.md`'s own finding #4).

## Scoping call, confirmed with Mike before starting

Two separable pieces existed under this one heading: the WS transport client + connection-mode picker (talk to
the backend's serial relay; design doc §4's mandated Direct/Via-backend choice), and a `fetch`-based client for
the new `/api/flows`/`/api/custom-nodes` admin API (flow/custom-node save-load through the backend). **Scoped to
the first only this session** — the more foundational half, since it's what actually lets a deploy travel
through the backend at all. The admin-API client is explicitly not touched here; flow/custom-node save-load
still goes through the existing File System Access picker (`flow-file/file-io.ts`) regardless of connection
mode. That's its own follow-up, named so it isn't assumed done.

**Second call, same conversation:** default connection mode is "via backend" (Mike's own ask), but "direct"
WebSerial stays available rather than being dropped — checked rather than just complied with, since Mike
explicitly invited a use-case check first. Real reasons it's worth keeping, not just inertia: it needs no
backend process installed or running at all (lowest friction for a quick one-off session, matching the
"browser-only, no install" framing design doc §4 explicitly preserves as this mode's frozen niche), and it
remains a working fallback if the backend itself is what's broken. Keeping it cost nothing new this session
since `WebSerialTransport` already existed and already worked — only the connection-mode picker UI and the
shared `DeviceTransport` contract needed building either way.

## What shipped

- **`editor/src/protocol/backend-transport.ts`** (new) — `BackendTransport`, the WebSocket client for the "via
  backend" mode. Two-phase like the backend itself expects: `open(wsUrl)` establishes the socket and lets the
  caller ask what serial ports the backend sees (`listPorts()`) before committing to one (unlike
  `navigator.serial`'s own native picker, the backend has no OS-level file-picker equivalent — the editor builds
  that UI itself); `connectPort(port, baudRate)` opens the actual serial port on the backend side. `send()`
  encodes one `Message` as one WS binary frame; incoming binary WS messages are decoded via the same
  `ProtocolStreamDecoder` `WebSerialTransport` already uses (a fresh push() per message, since the backend
  guarantees one complete frame per WS message). A new "debug" control-message type is handled too — the
  device's own plain print()/status lines, forwarded so they still reach the console in "via backend" mode the
  way they already do in "direct" mode (`transport.ts`'s `onDebugLine`). WebSocket construction is injectable
  (`wsFactory` constructor param, unused by `main.ts`, defaults to the real `WebSocket`) purely for testability —
  `editor/test/backend-transport.test.ts` (new, 12 tests) exercises it against an in-memory fake, no real network
  or backend process needed, same shape `test/transport.test.ts` already uses for `WebSerialTransport` and
  `ws_relay.py`'s own tests use for `SerialConnection`.
- **`editor/src/protocol/transport.ts`** — added `DeviceTransport`, the minimal shared contract
  (`isConnected`/`disconnect()`/`send()`) both transports now implement, so `main.ts`'s Deploy/Check
  status/Disconnect/inject-click-to-fire logic is written once and used by either mode.
- **`editor/src/app/main.ts`** — `transport` is now a `let DeviceTransport`, reassigned to a freshly-constructed
  `WebSerialTransport` or `BackendTransport` each time Connect succeeds, both driven by the same shared
  `transportEvents` object (extracted from the old inline constructor call, logic unchanged). The Connect
  handler branches on `connModeSelect`'s value; the shared "actively request HELLO" probe after connecting is
  unchanged and transport-agnostic (`transport.send({type: "HELLO_REQUEST"})` already worked this way before
  this session). A new "⟳ ports" button (`refreshBackendPorts()`) populates the backend port picker via a
  short-lived, separate `BackendTransport` used only for that one request/response — never auto-run on load or
  on switching modes, per design doc §4's "explicit choice, not auto-detection" reasoning applied literally
  (probing a URL nobody asked to probe yet would silently fail on every page load before a backend is even
  started).
- **`editor/index.html`** — `connModeSelect` (Direct/Via backend, defaulting to "Via backend"), `backendUrlInput`
  (defaults to `ws://127.0.0.1:8765/ws`, matching the backend's own CLI defaults), `backendPortSelect`, and the
  refresh button — shown/hidden via the native `[hidden]` attribute based on the selected mode.
- **A real bug found and fixed in the backend, in the same session, not deferred:** `ws_relay.py` (built
  2026-08-16/2026-09-07) assumed §13's raw binary frame layout rides the physical serial wire directly. It
  doesn't — the real device listener (`device-runtime/src/listener.py`) only ever speaks base64-encoded,
  `"F64:"`-prefixed text lines there, a deliberate POC-D-era hardware workaround
  `editor/src/protocol/transport.ts`'s `WebSerialTransport` already implements identically for the direct path.
  New `backend/src/thingstudio_backend/line_framing.py` (a Python port of `transport.ts`'s own base64/line
  encode/decode) sits between `serial_relay.py`'s raw byte stream and the relay; `framing.py` itself is
  unchanged and still correct as a transport-agnostic frame codec, it just isn't what belongs directly on the
  serial byte stream. `ws_relay.py`'s tests (`test_ws_relay.py`) updated to match the real contract; new
  `test_line_framing.py` (13 tests) covers the new module directly, same adversarial bar `test_framing.py`
  already holds `FrameDecoder` to. Full incident write-up:
  `docs/working-notes/learnings/backend-serial-wire-format.md` — worth reading before touching this boundary
  again, since it's exactly the kind of "two independently-tested components silently disagree" gap that won't
  show up as a test failure on either side alone.
- **A second real bug found the same session, via an actual live-hardware attempt with Mike** (see
  "Live-testing follow-up" below): `ws_relay.py`'s `_send_status()` didn't guard against the WebSocket already
  being closed/closing when called from `_disconnect()`/`cleanup()`. A real teardown race (a stale second
  editor connection to the same board, from a session Mike had accidentally left open, racing this one's
  serial read into a "Bad file descriptor") meant cleanup landed on an already-closing WS and raised
  `ClientConnectionResetError`, uncaught, straight out of the request handler. Fixed with a
  `try/except (ConnectionResetError, RuntimeError)` around the `send_str()` call, same best-effort posture
  `_pump_serial_to_ws()` already applies to its own unexpected errors. New direct regression test,
  `test_send_status_on_already_closing_ws_does_not_raise`, instantiates `ConnectionSession` against a
  deliberately-failing fake WS (bypassing the full aiohttp test-server stack, since the real race isn't
  practical to reproduce deterministically through one). Confirmed the test catches the regression by
  reverting the fix in a scratch copy and re-running it. Full incident:
  `docs/working-notes/learnings/backend-ws-status-send-race.md`.

## Live-testing follow-up, 2026-09-07 (same session)

After the above shipped, Mike ran the backend and editor himself and tried a real "via backend" connection
against a real board — the first time any of this was exercised outside a fake-serial/fake-WS unit test. Two
things came out of it:

- **The `_send_status` crash bug above** — found and fixed because Mike pasted the backend's own real log
  output (including the unhandled traceback) into the session, which is exactly the kind of signal a live pass
  is for. His own accidental duplicate editor tab was the trigger, not a bug in the duplicate-detection sense —
  the bug is that the backend's fault handling didn't tolerate that race, which it now does.
- **Resolved, same session, once the backend was actually running**: the browser-pane WS mystery above was not
  a ThingStudio bug. With the real backend up, a plain HTTP `navigate` to `http://127.0.0.1:8765/api/flows` from
  the pane returned real data (`{"flows": []}`) with no trouble, but every attempt to open
  `new WebSocket("ws://127.0.0.1:8765/ws")` from a page in that same pane still failed (one explicitly as
  `net::ERR_BLOCKED_BY_CLIENT`) — so the backend and the editor's WS client are both fine; the pane itself
  appears to block outgoing WebSocket connections to local/private addresses while allowing plain HTTP to the
  same host. Full detail: `docs/working-notes/learnings/cowork-remote-device-testing.md`. Practical consequence:
  this pane cannot give a real end-to-end signal for "via backend" mode — that verification needs a real,
  non-sandboxed browser (Mike's own, or Claude in Chrome once its extension is connected — it wasn't, this
  attempt).

## Verification

- **Backend**: 81 tests passing (66 previous + 14 wire-format + 1 status-send-race), verified in a scratch venv
  built outside the live-mounted repo (`~/scratch-backend-test/`, deleted after this session and again after the
  live-testing follow-up — same shared-mount/cross-platform-binary reasoning `CLAUDE.md` already gives for npm,
  applied to Python here per prior sessions' own precedent).
- **Editor**: `tsc --noEmit` clean, `vitest run` — 341 tests passing (329 previous + 12 new) — verified by
  extracting `editor/` (excluding `node_modules`/`dist`/`.git`) into the cloud session's own workspace and
  running `npm ci`/`tsc`/`vitest` fresh there, per `CLAUDE.md`'s "never run these directly against the
  live-mounted `editor/`" rule; `.verify-tmp/` (gitignored) is the established staging point for this, not a new
  pattern this session invented.
- **Verified end-to-end against real hardware, same session.** Mike's first pass (real backend + real board)
  is what surfaced and let us fix the `_send_status` race above. After that fix, Mike confirmed a real "Via
  backend" connect to a real ESP32 plus a basic MQTT flow deployed and running on it — the first actual
  round trip through the backend, not just a fake-serial/fake-WS unit test. This is the checkpoint the earlier
  "not yet confirmed" note below was waiting on.

## What's still open, named explicitly rather than silently skipped

- ~~**Admin-API `fetch` client** — flow/custom-node save-load through `/api/flows`/`/api/custom-nodes`, regardless
  of connection mode. Not touched this session (see "Scoping call" above).~~ **Done, 2026-09-08** --
  `editor/src/flow-file/admin-api-client.ts`. Turned out narrower than "regardless of connection mode" implied:
  Mike's own call was that storage is backend-*exclusive* now, so it needed no connection-mode branching at all
  (unlike the transport half above) -- see `backend-persisted-data-protocol.md`'s own addendum and
  `decisions/backend.md` for the full reasoning, including the CORS support this required
  (`backend/src/thingstudio_backend/cors.py`) and "direct" WebSerial mode's connModeSelect option being hidden
  as a consequence (it can no longer save/load a flow on its own).
- ~~**Real end-to-end verification**: editor (either mode) → real running backend → real board.~~ **Done,
  2026-09-07**: Mike confirmed "via backend" connect to a real ESP32 plus a basic MQTT flow both work. Still
  open, narrower than before: the backend's own dedicated real-hardware pass for DTR/RTS-per-board specifics and
  actual disconnect timing (`backend-platform-decision.md` §5) — this confirms basic connect/deploy/run works,
  not that every board-specific reset/disconnect edge case has been exercised.
- **Posture-2 auth** (`[P4]`) — unaffected, unrelated to this session's scope.
- **`admin_api.py`/`persisted_store.py` being run by Mike for real** — unrelated pre-existing open item, still
  open.
