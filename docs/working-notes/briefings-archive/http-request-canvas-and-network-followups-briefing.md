# Briefing: `http_request` canvas presence + loud network errors, plus the still-open ESP32 leg of the ordering-race verification

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`.

**Check `git log` before assuming anything below is committed.** This briefing's own starting state depends on
commits from 2026-09-05 (boot-time flow auto-resume, flow identity, the runtime version-bump-discipline rule and
belt-and-braces `runtimeBuild` marker, `HELLO_REQUEST`) landing cleanly on top of 2026-09-04's five commits
(single-wifi-owner fix, the mqtt reconnect-ordering-race fix, a PropertyPanel.vue UI change, a docs commit, a
UI-cleanup-pass commit). Confirm the actual tip before trusting anything else in this file.

## Where this came from

This supersedes `wifi-race-fix-verification-and-network-followups-briefing.md` (now marked superseded at its own
top). That briefing's Problem 1 (verify the wifi_status-vs-mqtt_as ordering-race fix on real hardware) is **done
for RP2040, still open for ESP32** — Mike redirected to RP2040 first, and the session that followed never
circled back. Its Problems 2 and 3 were never reached at all. This briefing carries all three forward, plus
records what else that session actually built along the way (unplanned, but directly relevant if you touch
`listener.py`/`messages.py`/the wire protocol again).

## What the last session actually did (context, not this session's job to redo)

Read `docs/working-notes/decisions.md`'s 2026-09-05 entries in full before touching device-runtime or the wire
protocol — five real, separate things landed that day, each worth knowing about:

1. **Runtime/editor version-check gap closed, two layers.** A stale RP2040 board crashed with
   `AttributeError: 'module' object has no attribute 'register_trigger'` because nobody bumped
   `_RUNTIME_VERSION` when `register_trigger` was added 2026-09-02. Fixed with a documented bump-discipline rule
   (CLAUDE.md's "Device-runtime version bump discipline") plus a non-blocking git-SHA `runtimeBuild` marker
   (belt-and-braces, Mike's own request).
2. **`HELLO_REQUEST`** (message type 10, editor -> device) — "resend your current HELLO right now," no side
   effects, built because the Pico W has no reset button and power-cycling drops the WebSerial connection.
3. **Boot-time flow auto-resume.** Before this, a previously-DEPLOYed flow only ever restarted via a live DEPLOY
   message — any reset/power-cycle lost the running flow entirely until a human manually redeployed, even though
   the compiled bytecode survived on flash the whole time. `listener.py`'s new `_resume_flow()` fixes this.
   Mike's own words: "not persisting flows to survive reset or power cycle is pretty fundamental. fix it."
4. **Flow identity** (`flowName` + `deployId`, HELLO's `currentFlowName`/`currentFlowDeployId`) — the direct
   follow-on to auto-resume: "is the flow running on this board the one I have open." `flowName` is a stable,
   user-edited string (flow-file.ts, a new toolbar input); `deployId` is a fresh uuid generated on every single
   Deploy click. Both null/absent are safe on an old editor or a board that's never had a flow deployed.
5. **A real, previously-invisible bug fixed along the way:** `cbor.py` (device-runtime's hand-rolled CBOR codec)
   has no null-encoding support at all; `_send_hello()` was sending `runtimeBuild: None` unconditionally on
   boards without the marker file, which would have silently broken HELLO entirely on exactly those boards.
   Fixed generally in `messages.encode_message_body` (drops `None`-valued keys before encoding). This is also
   why `CLAUDE.md` now has a rule about building and running the real MicroPython test suite
   (`device-runtime/test/README.md`'s recipe) rather than trusting `python3 -m py_compile` alone — it caught
   exactly this bug, twice, after `py_compile` reported both changes clean.

Two related but still-open items from the same investigation, not fixed:

- **`outstanding-items/wlan-state-not-torn-down-on-redeploy.md`** now has a 2026-09-05 addendum: RP2040 shows
  the same class of bug as the already-documented ESP32 finding (leftover native WiFi driver state surviving a
  redeploy, cleared only by a power cycle) via a different trigger path (invalid-then-corrected credentials,
  oscillating `wifi_status` True/False) and a different chip's WiFi stack (cyw43, not ESP-IDF). Not
  root-caused, not fixed — the file's own "Why this isn't a mechanical fix" section still applies, now
  confirmed cross-platform.
- **`outstanding-items/reset-before-deploy.md`** has a 2026-09-05 update: its point 2 (something must run at
  boot to auto-resume a flow) is now built and tested. Points 1/3/4 (DEPLOY_ACK's meaning/timing across a
  reset, host tooling tolerating a connection drop) are still open, still unscoped, still Mike's call.

None of the above is this briefing's job to build further unless it blocks Problem 2 or 3 below — flagged so you
don't rediscover it from scratch or assume it's still broken.

## Problem 1, remainder: ESP32 leg of the ordering-race verification — still not done

`wifi-race-fix-verification-and-network-followups-briefing.md`'s Problem 1 asked for both an ESP32 and an
RP2040 real-hardware pass of the wifi_status-vs-mqtt_as ordering-race fix (`mqttEnsureConnectedSnippet()` in
`mqtt-shared.ts`, moved out of module scope 2026-09-04). RP2040 passed (see `mvp-validation-plan.md`'s
2026-09-05 dated Results entry, network batch section, Tier 1) — no `OSError: Wifi Internal State Error` under
invalid credentials, a genuine confirmation for that platform. **ESP32 was never retested this session at all**
(the RP2040 redirect meant the session never circled back). Do this first, same procedure as the RP2040 pass
already run: redeploy `basic-mqtt.flow.json` with valid credentials (confirm clean deploy, no crash), then
deliberately with invalid credentials (confirm the failure mode is a clean "can't connect," not the internal-
state crash the original 2026-08-21/2026-09-04 investigation found). If it still fails either way, stop and
re-open the design rather than tuning bounds/timeouts — same stop condition the original fix's own briefing set.
Record the result in `mvp-validation-plan.md`'s Tier 1 network section either way, matching the RP2040 entry's
own level of detail.

## Problem 2: `http_request` still has no canvas presence

Unchanged since before 2026-09-04. `http-request.ts` picked up its WiFi-config-node migration
(`resolveFlowWifiCredentials()`, same as every other network node type) but is still registry-only — no
`ports`, no Rete node class, no palette entry, unreachable from the editor UI
(`outstanding-items/http-request-config-node-gap.md`, `outstanding-items/canvas-presence-gaps.md` — read both in
full before starting). Mechanical fix, following the pattern `mqtt-publish.ts`'s own canvas wiring already
demonstrates: `ports`, a Rete node class, a palette entry (`palette.ts` — it has a `group` field now, added in
the 2026-09-04 UI-cleanup pass; `http_request` should presumably land in the "network" group alongside the
other network nodes), and a `PropertyPanel.vue` section. Needs its own real hardware pass afterward (a local
HTTP test server, GET and POST, confirming response body/status land in `msg` correctly) — never done, per
`outstanding-items/network-hardware-pass-status.md`.

## Problem 3: loud network errors never reached `http_request`/mqtt

Unchanged since 2026-08-21. The OSError-with-host:port-context pattern `udp-send.ts`/`udp-receive.ts` already
have (`redeploy-cleanup-and-network-fault-detection-briefing.md`'s Problem 2a) was flagged as a judgment call
for `http-request.ts`/`mqtt-shared.ts` too, never done — worth re-confirming by grep it's still true before
assuming (this project's own established convention: don't trust a carried-forward claim without re-checking).
Same mechanical fix: wrap the request call in `http-request.ts`, and `mqtt_as.MQTTClient`'s
`connect()`/`.publish()`/`.subscribe()` calls in `mqtt-shared.ts`, with the operation's own broker/host:port
folded into the re-raised message.

## Still not reached (carried forward from the original scope, blocked behind Problem 1's ESP32 leg passing)

qos 1 (only qos 0 tested so far), the `retain` flag, broker `username`/`password` auth actually being enforced
by a real broker, outage recovery (kill/restart the broker or WiFi mid-flow, confirm `mqtt_as`'s
`_keep_connected()` actually reconnects), and the original stale-NVS-cached-credentials repro condition.

## Also flagged, still explicitly NOT this session's job (deferred, recorded, not forgotten)

- **`machine.reset()` before each deploy** — `outstanding-items/reset-before-deploy.md`, now partially
  unblocked (see above) but still real open questions (Mike's call).
- **Credential-free git-committable mqtt flows** — `outstanding-items/credential-free-committable-flows.md`.
- **WiFi provisioning / scan-at-runtime + dropdown** — `outstanding-items/wifi-provisioning-captive-portal.md`.
- **Gray out the compile/deploy button after a successful deploy until the flow is edited** — UI-only, unrelated
  to network/wifi work — `outstanding-items/gray-deploy-button-until-edit.md`.
- **A flow-triggered reset node** — Mike's own proposal (2026-09-05, prompted by the RP2040 stuck-WiFi finding),
  now more viable since auto-resume means a reset no longer loses the running flow, but not scoped or built.
- **Real N-power-cycle hardware validation of flow auto-resume** — built and verified off-device
  (CPython-driven subprocess restart, not real silicon power-cycling) this session; `mvp-validation-plan.md`'s
  Tier 2 "Flow persistence" bullet still wants the real hardware pass.
- **Whether to raise the WiFi/mqtt-decoupling idea with Peter Hinch upstream** — Mike's own call.

## Success criteria

- ESP32 leg of the ordering-race verification done, with a dated Results entry in `mvp-validation-plan.md`
  matching the RP2040 entry already there.
- `http_request` given real canvas presence (Problem 2) and its own hardware pass, or explicitly flagged as a
  carried-forward follow-up if the session runs long (not a silent cut).
- Problem 3's loud-error fix attempted for at least `mqtt-shared.ts` while in the area, flagged either way.
- `npx tsc --noEmit` clean (stray-`.js` check first), all touched off-device tests passing (both TS/vitest and,
  if `device-runtime/src` is touched, the real MicroPython suite — build the toolchain once per
  `device-runtime/test/README.md`, don't rely on `py_compile` alone).

## Stop conditions

- ESP32 still fails the ordering-race fix — stop and re-open the design rather than tuning bounds/timeouts.
- `http_request`'s canvas wiring surfaces a real structural blocker the other four node types' canvas work
  didn't hit — stop and reconsider rather than forcing the same pattern through.
- Any existing test suite needs modifying beyond what's already flagged above.

## Not in scope for this chat

- RP2350 (Pico 2 / Pico 2 W) bring-up — separate, already-queued item (`rp2350-bringup-briefing.md`).
- The custom-node-authoring sequencing override (`outstanding-items/sequencing-override.md`) — check whether
  Mike has run the validation session it calls for before assuming this briefing is next by default.
- Backend/auth work, TCP send/listen-receive, I2C/SPI sensor nodes, filter/event-compression node — separately
  tracked in `outstanding-items.md`.
- MQTTS/TLS — still deferred.
- Everything in "Also flagged" above.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself in a real Terminal, never executed from the sandbox — this has been violated once before (2026-09-04),
hit a real permission/lock error on the shared mount exactly as CLAUDE.md warned it would. Read-only git
commands (status, log, diff) are fine to run directly, but even a read-only `git status` has left a stale
`.git/index.lock` behind at least once (`learnings.md`) — if a git command hangs or errors oddly, that's the
first thing to suspect, and the fix is telling Mike to `rm -f .git/index.lock` in a real Terminal, not retrying
from the sandbox.
