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
(check and delete before trusting any test/build result). `npm install`/
`build`/`test` against the live-mounted `editor/` corrupts `node_modules`
for Mike's Mac the same way (Linux native bindings written over darwin
ones) — never run from the sandbox, hand Mike the command instead. See
`CLAUDE.md` directly for all three — this file doesn't restate them.

A fourth: `device-runtime/src/*.py` changes need a breaking-change
judgment call and a matching `_RUNTIME_VERSION`/
`EDITOR_TARGET_VERSION` bump in the same change, backed by an
automatic (non-blocking) git-SHA marker check -- see CLAUDE.md's
"Device-runtime version bump discipline" (2026-09-05, surfaced by a
real RP2040 hardware failure).

A fifth: `py_compile` is a syntax check, not a test -- verify any
`device-runtime/src` change that could actually run against the real
MicroPython suite (build the toolchain once, ~2 minutes, per
`device-runtime/test/README.md`), not `py_compile` alone. See
CLAUDE.md's "`device-runtime/src` changes: run the real MicroPython
suite, not just `py_compile`" (2026-09-05, caught a real `cbor.py`
`None`-encoding bug `py_compile` had twice reported clean).

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
- **ESP-IDF's own NVS-cached station auto-reconnect can fire from
  `network.WLAN(network.STA_IF).active(True)` alone, and races an
  immediately-following explicit `.connect()` call.** If a *previous*
  deploy left credentials in NVS, `active(True)` alone can kick off
  ESP-IDF's own reconnect using those stale credentials; code that then
  unconditionally calls `.connect(ssid, password)` right after (with no
  `isconnected()`/`status()` check first) can collide with that in-flight
  attempt, which ESP-IDF refuses with `E (...) wifi:sta is connecting,
  cannot set config` — its own driver-level error, not a MicroPython
  exception, so it surfaces as a raw serial log line rather than a Python
  traceback. Confirmed on real hardware via `mqtttest.flow.json`; root
  cause traced into the vendored `mqtt_as`'s `wifi_connect()` (ESP32
  branch), which had exactly this gap — `docs/working-notes/decisions.md`,
  2026-08-21 entry. Worth checking for the same shape (`active(True)`
  immediately followed by an unconditional `.connect()`, no connecting-state
  guard) in any other code that brings up `STA_IF` directly, not just this
  one call site.
- **`py_compile` only proves a file parses -- it caught neither of two
  real bugs a real MicroPython run found in the same session.** Built the
  actual toolchain (`device-runtime/test/README.md`'s recipe: clone
  `micropython`, `make -C mpy-cross`, `make submodules && make` in
  `ports/unix`) for the first time from inside a Cowork device-bridge
  session, entirely in the bridge's own scratch space (`~/tmp/`, never the
  shared mount) so it carried none of the cross-platform-native-binary
  risk the npm/`node_modules` restriction exists for. Running the real
  suite immediately surfaced `cbor.py`'s encoder raising `TypeError` on a
  `None` value (2026-09-05's `runtimeBuild` field, sent unconditionally
  including when unknown) -- invisible to `py_compile`, which only checks
  syntax, not runtime behavior, and would have shipped a HELLO that
  silently never sent on any board without a `_runtime_build.txt` marker.
  Worth the ~2 minutes of one-time build cost whenever a session touches
  `device-runtime/src` in a way that could actually run — `py_compile`
  alone is a syntax check, not a test.
- **CBOR `None`/null has to be handled explicitly on both the write and
  read side of an optional field -- it doesn't fail loudly by default.**
  `cbor.py` (this project's hand-rolled encoder) has no null/undefined
  support at all, by design (optional fields are meant to be omitted from
  the map entirely, never encoded as CBOR null) -- but nothing enforced
  that at the call site, so `_send_hello()` passing an explicit `None`
  straight through to `cbor.encode` raised, and that raise was swallowed
  by `_send_message_safe`'s own catch-all, so the failure mode was total
  silence (no HELLO at all), not a visible error. Fixed generally at
  `messages.encode_message_body` (drops `None`-valued keys before
  encoding) rather than at the one call site that happened to trigger it
  -- any future optional-and-sometimes-unknown field gets this for free.
  `decisions.md`'s 2026-09-05 entry.

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

## Cowork remote-device testing environment

- **The cloud session's own staged read-only mirror of the repo (under
  the uploads directory) can be a partial/curated snapshot, not a full
  checkout -- don't trust it for `npm test`/`vitest run` without first
  confirming the full `src`/`test` tree is actually present.** Discovered
  2026-08-20: the mirror available during the custom-node session was
  missing `src/compiler/errors.ts` and several other node-library/test
  files, so a same-session verification attempt (tried because the device
  bridge to Mike's machine was down) failed on unrelated
  import-resolution errors, not real regressions in the new code. When
  `device_bash` can't reach Mike's machine either, there is currently no
  way to get a fully trustworthy test/typecheck signal from inside the
  cloud session alone for this project -- say so plainly rather than
  reporting a red result as if it were a real one, and defer the actual
  verification to Mike's machine.

## Custom node authoring

- **A custom node's top-level `.node.py` code runs inside a generated
  per-instance wrapper function, not at true module scope — `nonlocal`,
  not `global`, is the correct idiom for persistent state.** First-party
  node codegen (e.g. `timer.ts`) inlines its code directly at true
  module/coroutine scope, where `global` is correct; a custom-node author
  following that same familiar pattern would hit a `NameError` at deploy
  time instead, since no module-level name exists inside the wrapper.
  Self-caught while writing `custom-node.test.ts`'s closure-isolation
  test, not by a real deploy failure — documented prominently in
  `custom-node.ts`'s header comment and in `docs/user-guide/custom-nodes.md` (its own
  dedicated section) given the project's fault-handling-first priority.
  `custom-node-authoring-scoping.md`.

## Reusable patterns worth remembering

- **A bounded, drop-oldest ring buffer for queued outbound messages** —
  the vendored `mqtt_as`'s own `MsgQueue` already implements exactly this
  eviction shape for *inbound* subscribed messages; a validated precedent
  worth reusing for any future "buffer while disconnected, flush on
  reconnect" need, even though the data path differs (inbound vs.
  outbound). `mvp-feature-priorities.md`.
