# Decisions — Backend (design-complete, zero code as of 2026-08-19 — see `outstanding-items.md`)

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-16 — Thin local backend + browser-based web editor — explicitly
  not a native GUI app (Electron/Tauri), and not browser-only
  WebSerial-direct either.** A backend decouples "where the device is"
  from "where the human is" (remote access as a first-class use case, not
  just packaging) — a capability unlock Electron/Tauri can't provide
  either, since a desktop GUI app is just as tied to the machine it runs
  on. Tauri specifically ruled out on a technical ground, not taste: its
  system webview (WKWebView/WebKitGTK) doesn't implement Web Serial, so it
  would force the transport rewrite anyway while also adding Rust and the
  full packaging/signing burden — strictly more cost than the backend
  alone. `rete-migration-decision.md` Decision 2 (§"Not Electron, not
  Tauri").
- **2026-08-16 — Python + `aiohttp`, not FastAPI or raw
  `asyncio`+`websockets`.** The job is narrow (relay + static files);
  FastAPI's Pydantic/Starlette/Uvicorn weight isn't needed; raw
  asyncio means hand-writing what aiohttp already provides.
  `backend-platform-decision.md`.
- **2026-08-16 — Plain `pyserial` (sync, wrapped in
  `asyncio.to_thread`), not `pyserial-asyncio`.** That package is dead
  (no release since Sept 2021); one fewer dependency to audit, at the cost
  of hand-writing the thread-executor wiring. Same note.
- **2026-08-16 — WebSocket wire shape: one endpoint, multiplexed by frame
  type** — binary frames are §13's CBOR bytes passed through verbatim (no
  backend-side decode), text frames are backend-local JSON control
  messages (port list, connect, status). `backend-editor-auth-and-protocol.md`.
- **2026-08-16 — Posture 1 (default) auth: Host-header allowlist is the
  load-bearing defense against DNS rebinding, not `Origin`.** Same-origin
  policy doesn't cover WebSocket connections from page JS the way it
  covers `fetch`/XHR. Same note.
- **2026-08-16 — Posture 2 (opt-in remote access) auth: hand-rolled
  `bcrypt` + signed, expiring session cookie, not `aiohttp-session`.**
  That library has had no release in ~12 months; the actual surface needed
  is small enough to implement directly against the stdlib. Same note.
- **2026-08-16 — Session cookie, not a bearer token**, specifically
  because the browser's native `WebSocket` constructor cannot set custom
  headers — no way to send `Authorization: Bearer` on a WS handshake from
  page JS. Same note.
- **2026-08-21 — `~/.thingstudio` local-state persistence is backend-owned,
  not a browser-only stopgap, and this backend work is now marked
  MVP-needed by Mike.** A browser can't silently target a fixed
  home-relative path — only a user-driven picker, with reliably persisted
  permission in Chrome/Edge only — so this waits for the backend rather
  than building something thrown away once it exists. The MVP mark is a
  real scope change: the backend wasn't in `mvp-feature-priorities.md`'s
  tier list at all before this. Scoped as the app's general local-state
  directory (custom node packages as the first consumer), not
  custom-nodes-only, per Mike's own framing — not yet reconfirmed as a
  separate answer. `local-persistence-scoping.md`.

- **2026-09-07 — Backend↔browser persisted-data protocol: HTTP admin API, not a WS control-plane extension.**
  `ws_relay.py`'s `ConnectionSession` is scoped to "at most one open serial port per socket," a poor fit for
  data (saved flows, custom node packages) that needs to be reachable with no serial connection open at all.
  New `/api/flows`/`/api/custom-nodes` routes, covered automatically by the existing Host-allowlist middleware
  (installed at the `Application` level). `outstanding-items/backend-persisted-data-protocol.md`.

- **2026-09-07 — Editor↔backend wiring: "via backend" is the default connection mode; "direct" WebSerial stays
  available, not retired.** Mike's own call, confirmed at the start of this session and checked rather than
  taken as given: dropping "direct" isn't free even though the backend path is where all new investment goes
  (design doc §4's 2026-08-16 addendum) — it needs no backend process installed/running at all (lowest friction
  for a quick one-off session) and stays a working fallback if the backend itself is what's broken, and keeping
  it cost nothing new here since `WebSerialTransport` already existed and already worked. Both modes now share
  one `DeviceTransport` contract (`transport.ts`) so Deploy/Check status/Disconnect/inject-click-to-fire are
  written once, not duplicated per mode. `outstanding-items/editor-backend-wiring.md`.
- **2026-09-07 — Backend serial relay's real wire format: base64/"F64:"-prefixed lines, not raw binary,
  matching `transport.ts`'s existing browser-direct encoding.** Fixes a real bug in the 2026-08-16-session
  backend build (`ws_relay.py` assumed raw §13 frames ride the serial wire directly; the device listener never
  puts them there unencoded — POC-D's `read(n)` hang workaround). New `line_framing.py`; `framing.py` itself
  unchanged and still correct as a frame codec, just not what belongs directly on the serial byte stream. See
  `docs/working-notes/learnings/backend-serial-wire-format.md` for the full incident.
- **2026-09-08 — Admin-API fetch client: storage is backend-*exclusive*, not connection-mode-gated.** Mike's own
  call, checked before building rather than assumed: every save/load in the editor (flow save/open/delete,
  custom-node load) goes through the backend's `/api/flows`/`/api/custom-nodes` routes now
  (`editor/src/flow-file/admin-api-client.ts`), replacing file-io.ts/custom-node-io.ts's File System Access
  pickers rather than running alongside them, and independent of whether the device transport itself is
  "direct" or "via backend" -- exactly what made an HTTP admin API rather than a WS control-plane extension the
  right shape in the first place (`backend-persisted-data-protocol.md`'s "Two shapes" section). Consequence: WebSerial
  "direct" mode's `connModeSelect` option is hidden (not removed) in `index.html`, since it can no longer
  save/load a flow on its own and Mike doesn't see a use case for it right now. `outstanding-items/editor-backend-wiring.md`.
- **2026-09-08 — Admin-API CORS: reflect the request's Origin, not an explicit allowlist.** Weighed against a
  `--allowed-origin` flag mirroring `--allowed-host`; chosen because it doesn't lower this backend's actual
  security bar -- the WS relay already does zero Origin checking (`middleware.py`'s own header comment), and
  `__main__.py` already refuses to bind anywhere but loopback until posture-2 auth exists, so the worst case
  this opens (another page in the same loopback-reachable browser can also hit the admin API) is a risk category
  already fully accepted for the WS relay today. Works for the `npm run dev` workflow and for a remote/
  firewalled backend reached through a tunnel, with zero backend-side config either way.
  `backend/src/thingstudio_backend/cors.py`.
- **2026-09-08 — Remote/firewalled backend access: tunnel to loopback, not a non-loopback bind, for now.** Mike
  wants to run the backend near firewalled IoT devices and edit from a separate dev machine; confirmed with him
  directly that the near-term answer is an SSH/VPN tunnel into the backend's own loopback interface (no code
  change needed -- design doc §9's "network-secured / localhost-behind-a-VPN" default posture already covers
  this), not loosening `__main__.py`'s loopback-only bind refusal. The other shape (binding directly to a
  non-loopback interface, e.g. a Tailscale IP) is still wanted, just deferred -- flagged explicitly in
  `outstanding-items/posture-2-auth.md`'s 2026-09-08 addendum rather than silently dropped.


- **2026-09-08 -- First real-hardware DTR/RTS pass: leaving DTR/RTS alone (today's `serial_relay.py` default) does not reset this board; forcing both low does.** Run against an ESP32-C3-class board with a CH9102 USB-serial chip (WCH, vid=6790/pid=21971) via the new manual test harness (`backend/test/hardware/dtr_rts_disconnect_pass.py`): five DTR/RTS combinations sniffed for a boot banner right after open. Only "both held low" produced one (`LISTENER_BOOTING`, the device-runtime's own boot message); the current default (`dtr=None, rts=None` -- i.e. leave pyserial's own open-time line state alone) showed no reset, matching the "both held high" combo -- consistent with pyserial's open() already asserting both lines by default on this platform. Disconnect handling verified separately: pulling the USB cable produced a clean, structured `NODE_ERROR` (`SerialRelayError`) naming the port and the underlying OS error (`[Errno 6] Device not configured`) -- no hang, no crash, matching this project's fault-handling convention. Detection took ~19.75s in this run, but that figure includes however long it took to physically reach the cable after pressing Enter, not a clean OS-level latency measurement -- the qualitative result (clean, attributed failure) is what's confirmed here, not a precise timing bound. **Board-specific, not a general answer** -- per CLAUDE.md's own board-idiosyncrasy guidance, this settles the question for this one board/chip combination, not for every board `serial_relay.py` might see. `outstanding-items/backend-auth-overview.md`.

- **2026-09-08 (later the same day) -- Flows get their own `--flows-dir`, independent of `~/.thingstudio`; backend Save-flow now confirms before overwriting.** Mike's own finding while live-testing the admin-API client for real against a running backend: a flow is project material that belongs in that project's git repo, not a global per-user app-data folder -- unlike custom node packages, which are genuinely cross-flow and stay in `~/.thingstudio`. `PersistedStore` now takes `flows_dir` independently of `base_dir` (defaults under `base_dir` when not given); `--flows-dir` on the CLI points a real launch at a folder inside a git-tracked project. No wire-protocol or editor-side change needed -- `/api/flows/{name}` is unchanged, only where the backend's own writes land moves. Considered and rejected: bringing back `file-io.ts`'s File System Access picker as a second, browser-native storage path alongside the backend -- Mike's explicit call was one storage path, fixed to point at the right place, not two paths to keep straight. Same session: a real data-loss bug found live -- saving two flows both left at the default name silently overwrote each other -- fixed with a confirm-before-overwrite check in `main.ts`'s `btnSaveFlow` handler. `outstanding-items/backend-persisted-data-protocol.md`.

- **2026-09-08 (same day, superseding the entry above within hours) -- Reversed: flows go through the OS's native file dialog, not a backend `--flows-dir` at all.** Mike's own correction after seeing the `--flows-dir` proposal: he never wanted a directory fixed at backend-startup time -- he wanted "just like saving a file from any other editing program," a per-save/per-open native dialog. The `--flows-dir` CLI flag and `PersistedStore`'s split were fully reverted (`persisted_store.py`/`app.py`/`__main__.py` back to their pre-split state, confirmed identical to HEAD); flow save/open in `main.ts` now calls `flow-file/file-io.ts`'s `saveFlowFileToDisk`/`openFlowFileFromDisk` again -- the same File System Access API path this file used before the whole backend-exclusive period started, restored rather than reinvented. Net effect for flows: no backend involvement at all, no directory to configure anywhere, an OS-native "Save As"/"Open" dialog every time, exactly matching how any other desktop editor handles documents. Custom node packages are unaffected by any of this back-and-forth -- they stay backend-owned in `~/.thingstudio`, per Mike's own stated principle that they're genuinely cross-flow, unlike a flow itself. `outstanding-items/backend-persisted-data-protocol.md`.

- **2026-09-08 (later still) -- No further per-board hardware passes; redirect effort to general failure handling instead.** Mike's call after the single ESP32-C3/CH9102 DTR/RTS pass: with dozens of boards and USB-serial-chip combinations expected in the field, verifying each one individually is exactly the whack-a-mole CLAUDE.md's own fault-handling corollary already warns against ("don't chase every board's idiosyncrasies -- make the failure legible instead"). Backend/auth is treated as complete for the moment -- Mike has installed and run it for real, confirmed working end to end (Save/Open live-verified against a running backend, then again after flows moved to the native file dialog). Going forward, backend hardening work concentrates on strengthening `serial_relay.py`'s general, board-independent failure handling (clearer/more specific error attribution, edge cases beyond the two already covered -- open failure and mid-session disconnect) rather than expanding board coverage. `outstanding-items/backend-auth-overview.md`.
- **2026-09-23 — The backend starts the editor; editor and backend are on the same machine for the MVP.**
  Both Mike's calls, same day. `thingstudio-backend` now serves the built editor at `/` (`editor_site.py`,
  `--static-dir`, dev default `editor/dist`) and opens it in the browser on start (`--no-browser` to skip);
  it prints `Thingstudio is running at <url>`. Details:
  - Not a bare `add_static("/")` (it never served `index.html` for `/`); same small handler as
    `docs_site.py`. Registered last so `/ws`, `/api/*`, `/docs/*` win.
  - `.wasm`/`.mjs` MIME types registered explicitly — browsers reject a module script or streaming WASM
    compile with the wrong type, and Python's table varies by platform.
  - Legible failures: editor not built → `/` returns a page with the build command; built but older than
    `editor/src` → startup warning naming the newest changed file. Needed on day one: Mike's `editor/dist`
    was from 2026-08-22.
  - Editor side: `initialBackendWsUrl()` — when the backend served the page, the backend URL is the page's
    own origin (any port); under the Vite dev server it falls back to `ws://127.0.0.1:8765/ws`. The
    same-machine assumption means no other case is handled; the backend URL field is now a candidate for
    removal in the top-bar tidy-up.
  - Verified: backend pytest 205 passed (7 new for the editor route); a real `vite build` served by the
    backend over HTTP (index, JS, `.mjs`, `.wasm` all 200 with correct types).
  - Follow-up, same day: after a real rebuild the browser still showed the August editor. Cause: Chrome
    heuristically cached `index.html` (served with only `Last-Modified`, no `Cache-Control`). Every
    non-hashed file (everything outside `assets/`) and every docs page is now served `Cache-Control:
    no-cache`; a stale build also gets a red banner in the page itself, not just the startup warning.
