# Learnings — Backend / security research

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **Same-origin policy does not cover WebSocket connections initiated
  from page JS the way it covers `fetch`/XHR.** A DNS-rebinding attack can
  get a browser to resolve an attacker-controlled hostname to `127.0.0.1`
  after an initial same-origin check passes, then open a WebSocket to a
  local server with no browser-level barrier stopping it. The `Host`
  header on that request still reads the attacker's hostname (can't be
  forged) — a server-side `Host` allowlist is the actual defense, not
  `Origin` checking. Verified against a real 2026 advisory
  (`GHSA-89vp-x53w-74fx`) against a structurally similar local WebSocket
  server. `backend-editor-auth-and-protocol.md`.
- **The browser's native `WebSocket` constructor cannot set custom
  request headers.** No `Authorization: Bearer …` is possible on a WS
  handshake from page JS — this is a real API limitation, not a design
  preference, and it's why session auth for the backend has to be
  cookie-based rather than token-based. Same note.
- **Check a dependency's actual release activity before trusting it,
  every time — not just for npm.** `pyserial-asyncio` turned out fully
  dead (no release since Sept 2021); `aiohttp-session` has had no release
  in ~12 months. Applied the same diligence `CLAUDE.md` already requires
  for npm packages to Python dependencies too, and it changed both
  decisions. `backend-platform-decision.md`, `backend-editor-auth-and-protocol.md`.
- **A citation can be wrong even when it "sounds right" — verify by
  direct inspection, not by trusting the name.** `connection-mastery-plugin`
  was cited as the drag-to-splice mechanism for a full session before
  being checked directly and found dead (Rete 1.x only, ~6 years stale)
  and, separately, not even the same feature. Corrected to Rete's own
  "Insert node" example. `rete-spike-briefing.md`, `architecture-review-briefing.md`.
- **Browser transport support isn't what it used to be assumed to be —
  check current support before relying on a browser API.** Safari has
  never supported WebSerial with no stated plans to; Firefox only gained
  it in v151 (May 2026); Web Bluetooth is *permanently* Chromium-only —
  a stated policy position from both Firefox and Safari, not a lagging
  gap that will close. `architecture-review-briefing.md`.
