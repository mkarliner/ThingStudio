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
