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
