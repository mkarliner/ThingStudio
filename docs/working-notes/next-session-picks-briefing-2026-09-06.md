# Briefing: delay node + canvas-presence gaps closed, both committed — open threads and next-session candidates

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`.

**Check `git log` before assuming anything below is committed.** As of this writing the tip is `b046af1`
("Give variable_get/variable_set/pwm_out canvas presence; gitignore .verify-tmp"), directly on top of `64aca52`
("Add delay node..."), on top of `d7753f6`/`5956a1b`/`43f4eec` (the ESP32 ordering-race decision, the
`http_request` real-hardware pass, and `http_request`'s canvas presence, all from 2026-09-05/06). `git status`
was clean at the end of this session — confirm that's still true before trusting it.

## Where this came from

This session worked the backlog via the established "next item" loop pattern (pick one concrete item, do it for
real — code, tests, docs — rather than just discuss it). Four items got picked and closed in sequence:
redeploy-twice EADDRINUSE test (real hardware, passed clean), RP2350 bring-up (partial — flash/deploy/boot
confirmed, wiring deferred by Mike until he has time), the `udp_send`/`udp_receive` property questions
(answered from the code itself, no change needed), and the two described in detail below. Nothing here
supersedes an earlier briefing — this is a fresh "what's left, pick the next one" handoff, same role
`http-request-canvas-and-network-followups-briefing.md` played two sessions ago.

## What this session actually did (context, not this session's job to redo)

1. **`delay` node — scoped and built from scratch** (`editor/src/node-library/delay.ts`). The last unaddressed
   item from `mikes-questions-and-points.md`'s original node-prioritisation list ("gets a message and relays it
   after an interval"). A `transform`: one `delayMs` property (default 1000), codegen is
   `await asyncio.sleep_ms(delayMs); return msg`. Full canvas presence from day one (not registry-only) — Rete
   class, palette entry ("general" group, "⌛" icon), property-panel input. 7 new tests
   (`editor/test/node-delay.test.ts`), same real-`asyncio.run`-plus-pymock harness as `node-udp-send.test.ts`.
   **Honest limitation documented in the node's own header, not glossed over**: `compile.ts` runs one source's
   downstream chain synchronously within that source's own coroutine, so this node's sleep blocks its SOURCE's
   own next iteration for at least `delayMs` — a `timer` (200ms) feeding a `delay` (5000ms) will NOT keep
   ticking every 200ms once a message reaches the delay. Not a new failure mode (any slow transform already has
   this effect on its own source), but `delay` makes it the whole point rather than a side effect. A future
   non-blocking, per-message-concurrent mode remains a real option later, not foreclosed by anything built here.

2. **Canvas-presence gaps — fully closed.** `variable_get`, `variable_set`, `pwm_out` were the last three
   registry-only node types (`outstanding-items/canvas-presence-gaps.md`, now itself fully closed — nothing
   left in the node library without canvas presence). Given real Rete classes, palette entries, and
   `PropertyPanel.vue` sections, following `http_request`'s own worked example. `variable_get`'s output port is
   dynamic (`payloadType`-dependent, same `resolvePortType` mechanism `inject`'s own output already used) with
   its own `retypeOutput()` method, mirroring `InjectNode`'s. `pwm_out`'s codegen already had a real hardware
   pass from the original 2026-08-14 GPIO/timer batch (witness-rig `MEASURE_PWM`) — only the canvas wiring was
   missing, so no new hardware pass is needed for this closure. Port-declaration tests added to each type's
   existing test file (`node-variable.test.ts`, `node-pwm-out.test.ts`).

3. **Both verified off-device** the same way every prior session has (CLAUDE.md's sandbox rule: never
   npm/build/test directly against the live-mounted repo) — fresh `npm ci` + `tsc --noEmit` (clean) +
   `vitest run` in an isolated extracted copy of `editor/`. Final count: **29 files / 329 tests passing**
   (up from 319 at the start of this session).

4. **Incidental find, fixed:** two scratch verification tarballs (`.verify-tmp/editor-src.tar.gz`,
   `.verify-tmp/editor-src-fresh.tar.gz`) had been accidentally committed in `43f4eec` — `.verify-tmp/` was
   never in `.gitignore`. Deleted from git and `.verify-tmp/` added to `.gitignore` (with a comment explaining
   why) so this can't recur. If you ever see a `.verify-tmp/*.tar.gz` sitting in the sandbox that `rm` can't
   delete ("Operation not permitted"), that's the known shared-mount limitation (CLAUDE.md) — either leave it
   (harmless scratch) or ask Mike to grant delete permission via the folder-delete-permission tool, same as
   this session did.

## Open threads carried forward, not touched this session

These are real, flagged, and waiting — none of them blocks anything above:

- **`mqtt_publish`/`mqtt_subscribe` boot-race** (`outstanding-items/mqtt-pubsub-boot-race.md`) — suspected
  missing publish-after-subscribe-confirmed ordering guarantee, likely (co-)cause of a real 2026-09-02
  silent-failure hardware test. Unconfirmed, needs a targeted fix + retest. Good next-session candidate: the
  fix itself is buildable and off-device-testable now; confirming it actually resolves the hardware symptom
  needs a real retest from Mike afterward, same shape as the wifi-status-emit-on-change item below.
- **`wifi_status` emit-on-change** (`outstanding-items/wifi-status-emit-on-change.md`) — implemented
  2026-09-02, still not run through the sandbox's `npm test`/build or retested on real hardware.
- **Single-wifi-owner fix** (`outstanding-items/wifi-single-owner-fix.md`) — landed 2026-09-04, off-device
  tests pass, but the actual redeploy + retest on real hardware (including re-confirming `basic-mqtt.flow.json`)
  still hasn't happened.
- **RP2350 bring-up** (`outstanding-items/rp2350-bringup.md`) — flash/deploy/boot-to-HELLO confirmed working
  2026-09-06 on a plain Pico 2. Functional interrupt-flow pass and the RAM-floor comparison against RP2040's
  ~209KB-free baseline are deferred until Mike has time to wire the button. Don't restart this without checking
  with Mike first — it's parked on his own timeline, not blocked technically.
- **Filter / event-compression node** — never built. Buildable with zero new compiler capability (reuses
  `timer.ts`'s per-instance state pattern, same shape `delay` just used for its own state-free version).
  Good next-session candidate, same "scope + build" shape as `delay`.
- **Pin/resource-conflict detection** — never built. A compile-time check (two nodes claiming the same pin in
  different modes should be a `CompileError`, not two silently-conflicting `Pin` objects), testable off-device
  with zero hardware needed. Good next-session candidate.
- **TCP send / TCP listen-receive** — never built. Bigger scope than the above: TCP send needs a lazy-expiry
  connection cache, TCP listen-receive needs a callback-to-coroutine bridge design. Worth its own scoping pass
  before committing to build it in one sitting.
- **I2C/SPI sensor nodes** — not started, gated on having actual sensor hardware on hand (Mike's call on
  timing, not something to start speculatively).
- Everything else in `outstanding-items.md`'s "UI / editor", "Hardware / rig", "Backend / auth", "Board/processor
  reference data", and "Docs / process" sections — untouched, all still open, none picked this session.

## Suggested next-session candidates (if Mike says "next item" again)

In rough order of "buildable right now without needing Mike's hands-on time first":

1. Scope + build the filter/event-compression node (same shape as `delay`, zero new compiler capability needed).
2. Scope + build pin/resource-conflict detection (compile-time check, no hardware needed to verify).
3. Investigate + fix the `mqtt_publish`/`mqtt_subscribe` boot-race (fix is buildable now; real-hardware
   confirmation is a separate follow-up step for Mike).
4. Scope (at least) TCP send / TCP listen-receive — bigger, may want to split scoping from building.

Items needing Mike's own hardware/browser time first, not this session's to start unprompted: the
wifi_status-emit-on-change and single-wifi-owner-fix real-hardware retests, RP2350 wiring, I2C/SPI sensor work.

## Success criteria (whichever item gets picked)

- Real code, real tests, real canvas wiring where applicable — not just a scoping doc, matching this session's
  and every prior session's bar.
- Off-device verified in an isolated extracted copy (`tsc --noEmit` clean, `vitest run` passing) before calling
  anything done — never against the live-mounted repo directly.
- `outstanding-items.md`, the item's own detail file, and (if it's a hardware-relevant node)
  `mvp-validation-plan.md`'s Tier 1 section all updated in the same session, dated, honest about what's still
  open.
- Any real limitation (like `delay`'s source-blocking behavior) documented in the code's own header comment,
  not just in the docs — this project's own established convention now, not optional.

## Not in scope for this chat

- RP2350 wiring/bring-up continuation — parked on Mike's own timeline.
- I2C/SPI sensor nodes — gated on hardware in hand.
- MQTTS/TLS — deferred, Mike's explicit call.
- Backend/auth, UI/editor items, docs/process items — separately tracked, not urgent, not flagged as next.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself in a real Terminal, never executed from the sandbox. Read-only git commands (`status`/`log`/`diff`) are
fine to run directly from the sandbox, but even those have occasionally left a stale `.git/index.lock` behind on
this shared mount — if a git command hangs or errors oddly, that's the first thing to suspect; the fix is
telling Mike to `rm -f .git/index.lock` in a real Terminal, not retrying from the sandbox. The sandbox also
cannot delete files it creates on the shared mount by default (`rm` -> "Operation not permitted") — ask Mike to
grant delete permission (this session did, successfully) rather than leaving scratch files to accumulate
silently, or just tell him what's left over.
