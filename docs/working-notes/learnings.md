# Key learnings

Status: index, started 2026-08-19. An append-only ledger of hard-won
technical facts and gotchas — things that cost real time to discover and
will bite again if forgotten, but aren't a behavioral rule for how a
session should operate (that's `CLAUDE.md`'s job — a few of these
*did* get promoted there, e.g. the git-lock issue and the stray-`.js`
issue, and are cross-referenced rather than duplicated below). Each entry
is short: what was learned, why it matters, where the full story is.

**Maintenance rule:** whenever a session hits something like this — a
surprising platform behavior, a library gotcha, a test-methodology trap,
a hardware quirk — add one line here in the same change, not batched for
later. If it turns out to be a repeatable process rule Claude should
always follow (not just a fact worth knowing), promote it to `CLAUDE.md`
instead, and leave a pointer here rather than duplicating the text.

---

## Already promoted to `CLAUDE.md` (standing rules, not repeated here)

Git writes from the agent sandbox leave stale `.git/*.lock` files behind
on the live-mounted repo (`git add`/`git commit` never run from the
sandbox, ever). Stray compiled `.js` files can shadow real `.ts` sources
when a sandboxed `npx tsc --noEmit` silently doesn't respect the flag
(check and delete before trusting any test/build result). See
`CLAUDE.md` directly for both — this file doesn't restate them.

## MicroPython / device-runtime

- **`sys.stdin.read(n)`/`readexactly(n)` can hang a port's event loop
  outright — not just slow, a genuine non-yielding block `asyncio.wait_for`
  can't preempt.** Confirmed on the ESP32-C3 LuatOS CORE board during
  POC-D. Fixed by riding binary payloads over `readline()` (base64-encoded
  text line) instead. Verify per-port before trusting a specific-byte-count
  read anywhere in this protocol again — never assume it's safe just
  because it works in browser-side simulation. `thingstudio-design-doc.md`
  §15.5, `fault-isolation-briefing.md`.
- **`mpy-cross` needs RAM headroom beyond what the compiled code itself
  needs.** On-device compilation of large-enough source (MQTT client
  libraries were a real historical trigger, pre-`mpy-cross`-era) can OOM a
  constrained board even though the identical code runs fine once it's
  bytecode. Directly why v1 ships precompiled `.mpy`, not raw-source
  `exec()`. `thingstudio-design-doc.md` §15.1 resolution.
- **The ESP32-C3's hardware RNG is not a true RNG unless WiFi or
  Bluetooth is enabled** (Espressif's own ESP-IDF docs, verified directly).
  A USB-only v1 with no radio bring-up generating a nonce via
  `os.urandom()` would be pseudo-random. Chip-agnostic lesson, not an
  ESP32-C3 workaround: don't assume any given MicroPython target has a
  trustworthy on-chip RNG. `transport-auth-design.md`.
- **MicroPython's `asyncio` has no first-class UDP primitive on any port**
  (confirmed against upstream issue #13382, open). Unlike
  `open_connection`/`start_server` for TCP, UDP needs a non-blocking
  socket polled on a short interval, try/except around `recvfrom()`
  catching `EAGAIN`. `udp-tcp-nodes-implementation-briefing.md`.
- **A board with no auto-reset circuit needs a software fallback.** Some
  boards don't reset when a browser opens the WebSerial port the way
  `esptool`-flashable boards typically do — a best-effort
  `port.setSignals()` RTS trick helps but isn't universal; document the
  physical-reset fallback rather than assuming the software path always
  works. `thingstudio-design-doc.md` §15.5 (POC-D).
- **Client/device timeout mismatches make a working deploy look like a
  hard failure.** If the browser gives up waiting before the device's own
  internal timeout would have fired, a possibly-fine deploy reads as
  broken. Keep the client's wait comfortably longer than the device's
  worst case, never shorter. Same section.

## Hardware bring-up / HIL rig

- **A floating witness GPIO input pin picks up what looks exactly like a
  real signal — steady ~27–29µs-spaced edge bursts, present even with
  nothing driving the DUT side.** Diagnosed from the burst's suspicious
  regularity (inconsistent with a real transition or simple wire
  crosstalk) — fixed by giving every watching pin an internal
  `PULL_DOWN`. Design around this from the start on any new witness-rig
  wiring, don't rediscover it. `fault-isolation-briefing.md`,
  `tier1-sensors-network-briefing.md`.
- **Long breadboard patch wires cause real electrical ringing on fast
  GPIO edges.** Harmless for "did *a* transition happen" checks; would
  corrupt anything relying on precise edge *counts* (PWM duty-cycle,
  timer measurements) until the wiring is cleaned up (shorter leads, a
  series resistor). `tier1-sensors-network-briefing.md`.
- **A witness's first `.irq()` arm in a session can `MemoryError` under
  heap fragmentation.** Pre-existing MicroPython behavior, not a bug in
  this project's firmware — worked around with a `gc.collect()` plus a
  throwaway warm-up call before the real checks. `mvp-validation-plan.md`,
  2026-08-14 GPIO/timer hardware Results entry.
- **Watching a board's first boot through Thonny is unreliable.**
  Thonny's Shell sends a keyboard interrupt on connect/reconnect, which
  `listener.py`'s deliberate few-second boot-delay window (§5's
  physical-access fallback) interprets as a real request to drop to
  REPL — looks exactly like "never reaches HELLO" even when boot is
  correct. Use a passive `mpremote connect <port>` (no interrupt) or any
  serial monitor that doesn't auto-send Ctrl-C on open. Not
  board-specific — will bite on any board watched this way.
  `rp2040-bringup-findings.md`.
- **Declared node `width`/`height` are a real rendering clipping budget
  in Rete's classic preset, not layout hints the way Litegraph's `size`
  is.** A node sized against the default renderer can clip its own socket
  once custom per-type styling changes padding/font — verify, don't
  assume old sizes still fit. `editor-look-and-feel-briefing.md`,
  `rete-migration-implementation-briefing.md`.

## Editor / build tooling

- **`vite build` does not type-check** — esbuild strips types rather than
  checking them. A green build proves nothing about type correctness;
  `tsc --noEmit` is the only real check. Cost real bugs in the poc-rete
  spike before this was learned. `rete-migration-implementation-briefing.md`.
- **Litegraph's file-picker `accept` filter doesn't reliably match
  compound/multi-dot extensions** (`.flow.json`) in Chromium's File
  System Access API — even a file just saved with that exact name showed
  up greyed out on open. Fixed by filtering on the single trailing
  extension (`.json`) instead; the saved filename can still be
  `flow.flow.json` as a convention. `editor-hands-on-briefing.md`.
- **`execFileSync` deadlocks Node's own event loop when the child process
  needs to talk back to an in-process test server.** `execFileSync`
  blocks the entire single-threaded event loop until the child exits, but
  an `http.Server` needing to *answer* the child's request lives on that
  same event loop — it can never respond while blocked, and the child
  hangs until its own timeout. Reproduced outside vitest (a plain Node
  script) before concluding it wasn't a codegen bug. Fixed by switching to
  async `execFile`. `mvp-validation-plan.md`, `http_request` Results
  entry.
- **Node's `http` module defaults to chunked transfer-encoding whenever a
  handler doesn't set `Content-Length` itself** — and this project's
  hand-rolled `http_request` client deliberately doesn't support chunked
  (documented v1 gap). Any local test server stood up against this node
  needs an explicit `Content-Length` header to be usable.
  `mvp-validation-plan.md`, same entry.

## Backend / security research

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

## Reusable patterns worth remembering

- **A bounded, drop-oldest ring buffer for queued outbound messages** —
  the vendored `mqtt_as`'s own `MsgQueue` already implements exactly this
  eviction shape for *inbound* subscribed messages; a validated precedent
  worth reusing for any future "buffer while disconnected, flush on
  reconnect" need, even though the data path differs (inbound vs.
  outbound). `mvp-feature-priorities.md`.
