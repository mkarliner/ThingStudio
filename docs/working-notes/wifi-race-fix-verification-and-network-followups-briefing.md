# Briefing: verify the WiFi/mqtt ordering-race fix on real hardware (ESP32 + RP2040), then close out remaining network follow-ups

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`.

**Check `git log` before assuming anything below is committed.** Five commits landed 2026-09-04 covering this
briefing's starting state (`git log --oneline -6` from the tip should show them): the single-wifi-owner fix for
udp/http nodes, the same for mqtt nodes plus the reconnect-ordering-race fix, the PropertyPanel.vue UI change, a
docs commit, and a UI-cleanup-pass commit. Confirm these are actually on the branch you're working from before
trusting anything else in this file.

## Where this came from

This supersedes `mqtt-hardware-validation-and-network-followups-briefing.md` (now marked superseded at its own
top) -- read that file's history section if you want the full backstory back to 2026-08-21, but don't re-derive
anything from it; this briefing already carries forward everything from it that's still open.

Short version: 2026-09-04's session built a "wifi_status is the flow's sole owner of WiFi credentials" fix
(`outstanding-items/wifi-single-owner-fix.md`) after Mike found a real bug -- a flow's `wifi_status` node could be
set to "unmanaged" while an `mqtt_publish` node elsewhere in the same flow still pointed at a different, real WiFi
config, with nothing catching the disagreement. Every network node type except `wifi_status` itself lost its own
`wifiConfigId` property; `udp_send`/`udp_receive`/`mqtt_publish`/`mqtt_subscribe`/`http_request` now derive
credentials from the flow's one `wifi_status` node via a new `ctx.findNodesOfType()` compiler primitive.

Testing that fix on real hardware (`basic-mqtt.flow.json`) surfaced a SECOND, unrelated bug: the existing
WiFi-reconnect-race precheck (`mqttWifiPrecheckStatement()`, dating to 2026-08-21) was a module-scope statement
whose position in the compiled output depended on the flow file's own arbitrary node array order -- in
`basic-mqtt.flow.json`, both mqtt nodes' setup happened to land before `wifi_status`'s own connect call, so the
precheck ran, found nothing in flight yet, and passed through as a no-op; the real race then happened moments
later when `mqtt_as`'s own connect collided with `wifi_status`'s. Confirmed on real hardware with both invalid AND
valid credentials -- `basic-mqtt.flow.json` did not deploy successfully at all, either way. Full root cause:
`outstanding-items/wifi-status-mqtt-connect-ordering-race.md`.

Fixed the same session: the precheck's wait logic moved out of module scope, into `mqttEnsureConnectedSnippet()`
(`mqtt-shared.ts`) immediately before the actual `client.connect()` call -- this always runs after every
module-scope statement from every node type, regardless of node order, so the ordering bug can't recur by
construction. **This fix has NOT been run through `tsc`/`vitest`, and has NOT been redeployed to real hardware.**
That's this briefing's first and most important job.

Read, in this order, before doing anything else:

1. `outstanding-items/wifi-single-owner-fix.md` -- the single-wifi-owner fix in full, including its own "not yet
   done" section and the mqtt_as WiFi-management side-discussion (a `zcattacz/mqtt_as` fork that decouples WiFi
   management from the MQTT session entirely -- Mike's own plan is to raise this with Peter Hinch upstream, not
   adopt the fork directly; nothing to build there unless that goes somewhere).
2. `outstanding-items/wifi-status-mqtt-connect-ordering-race.md` -- the ordering bug's root cause, the fix, and
   its own RP2040 note (below).
3. `editor/src/node-library/mqtt-shared.ts` in full -- its header covers both fixes together; the
   `mqttEnsureConnectedSnippet()`/`mqttWifiPrecheckSnippet()` functions are where the actual fix lives.
4. `outstanding-items/mqtt-hardware-validation.md` -- the full dated history of every real-hardware attempt
   against this whole line of work, 2026-09-02 through 2026-09-04. Don't re-derive it.

## Problem 1: verify the ordering-race fix -- ESP32 AND RP2040

Nothing in this fix has been checked at all yet. In order:

1. **Stray `.js` check first** (`find editor/src editor/test -name "*.js" -type f`), then `npx tsc --noEmit`
   (direct binary, per CLAUDE.md), then `npx vitest run` against at minimum: `node-mqtt-publish.test.ts`,
   `node-mqtt-subscribe.test.ts`, `node-udp-send.test.ts`, `node-udp-receive.test.ts`, `node-http-request.test.ts`,
   `node-wifi-status.test.ts`, `compiler.config-nodes.test.ts`. All of this is standing-rule sandbox-forbidden
   (CLAUDE.md) -- hand Mike the commands, don't run them yourself.
2. **Real hardware, ESP32**: redeploy `basic-mqtt.flow.json`, confirm it deploys successfully (no
   `OSError: Wifi Internal State Error`) with valid credentials, then deliberately retest with invalid credentials
   too (the exact repro that found this bug) to confirm the failure mode there is now a clean, expected
   "can't connect" rather than the internal-state crash.
3. **Real hardware, RP2040 -- explicitly new, Mike's own ask (2026-09-04), never done for this fix.** Important,
   specific gap: `mqttWifiPrecheckSnippet()`'s wait loop is gated to `sys.platform == "esp32"`, inherited unchanged
   from the original 2026-08-21 fix (which targeted an ESP-IDF-specific driver quirk). On RP2040 that whole wait
   loop is a no-op today -- only the harmless `.active(True)` call runs. `mqtt_as` still hardcodes
   `network.WLAN(network.STA_IF)` on every port including RP2040, so the underlying wifi_status-vs-mqtt_as
   duplication exists there too; whether RP2040's own WiFi driver (cyw43, not ESP-IDF) has the same "reject a
   connect while one's in flight" failure mode, some other failure mode, or none at all, is simply unknown. Test
   `basic-mqtt.flow.json` (or an RP2040-appropriate equivalent) on real RP2040 hardware and record what happens --
   if it DOES fail the same way, the ESP32 gate on the wait loop needs to widen (or become unconditional); if it
   doesn't fail, that's still worth recording rather than assumed.
4. **If either platform still fails**: stop and re-open the design rather than tweaking bounds/timeouts and
   hoping -- this is the same stop condition the original 2026-08-21 fix's own briefing set, and it held once
   already (the first "fix" needed a second one). Record whatever's tried next in `decisions.md`.
5. **Dated Results entry** in `validation/mvp-validation-plan.md`'s Tier 1 network section either way (pass or
   fail), matching this project's own established convention -- don't just fix silently and move on.

## Problem 2: `http_request` still has no canvas presence (inherited, unresolved since before 2026-09-04)

Carried forward unchanged from the superseded briefing: `http-request.ts` picked up its WiFi-config-node migration
2026-09-04 (`resolveFlowWifiCredentials()`, same as every other network node type), but is still registry-only --
no `ports`, no Rete node class, no palette entry, unreachable from the editor UI
(`outstanding-items/http-request-config-node-gap.md`, `outstanding-items/canvas-presence-gaps.md`). Mechanical fix,
following the pattern `mqtt-publish.ts`'s own canvas wiring already demonstrates: `ports`, a Rete node class, a
palette entry (`palette.ts` -- note the new `group` field added 2026-09-04 for the UI-cleanup pass; `http_request`
should presumably land in the "network" group alongside the other network nodes), and a `PropertyPanel.vue`
section. Needs its own real hardware pass afterward (a local HTTP test server, GET and POST, confirming
response body/status land in `msg` correctly) -- never done, per `outstanding-items/network-hardware-pass-status.md`.

## Problem 3: loud network errors never reached `http_request`/mqtt (inherited, unresolved since 2026-08-21)

Also carried forward unchanged: the OSError-with-host:port-context pattern `udp-send.ts`/`udp-receive.ts` already
have (`redeploy-cleanup-and-network-fault-detection-briefing.md`'s Problem 2a) was flagged as a judgment call for
`http-request.ts`/`mqtt-shared.ts` too, never done -- confirmed by grep as of the superseded briefing, worth
re-confirming it's still true before assuming. Same mechanical fix: wrap the request call in `http-request.ts`,
and `mqtt_as.MQTTClient`'s `connect()`/`.publish()`/`.subscribe()` calls in `mqtt-shared.ts`, with the operation's
own broker/host:port folded into the re-raised message.

## Still not reached (original scope, both this and the superseded briefing)

None of these have been exercised on real hardware yet, and all are blocked behind Problem 1 above actually
passing first: qos 1 (only qos 0 tested so far), the `retain` flag, broker `username`/`password` auth actually
being enforced by a real broker, outage recovery (kill/restart the broker or WiFi mid-flow, confirm `mqtt_as`'s
`_keep_connected()` actually reconnects), and the original stale-NVS-cached-credentials repro condition that
started this whole thread back on 2026-08-21.

## Also flagged, 2026-09-04, explicitly NOT this session's job (deferred, recorded, not forgotten)

- **`machine.reset()` before each deploy** for a known-clean device state -- real candidate, real protocol-shape
  implications (DEPLOY/DEPLOY_ACK semantics, boot-time auto-resume), not scoped.
  (`outstanding-items/reset-before-deploy.md`)
- **Credential-free git-committable mqtt flows** -- blocked on mqtt_as's hard credential requirement, no design
  chosen yet. (`outstanding-items/credential-free-committable-flows.md`)
- **WiFi provisioning / scan-at-runtime + dropdown** -- refined but still unscoped.
  (`outstanding-items/wifi-provisioning-captive-portal.md`)
- **Gray out the compile/deploy button** after a successful deploy until the flow is edited -- UI-only, unrelated
  to network/wifi work, not scoped. (`outstanding-items/gray-deploy-button-until-edit.md`)
- **Whether to raise the WiFi/mqtt-decoupling idea with Peter Hinch upstream** -- Mike's own call, not this
  session's job either way.

## Success criteria

- Dated Results entry in `mvp-validation-plan.md` confirming (or refuting) that the ordering-race fix holds on
  real ESP32 hardware, under both valid and invalid credentials.
- The same, explicitly, on real RP2040 hardware -- new ground, not previously covered by any prior session's
  hardware pass.
- `http_request` given real canvas presence (Problem 2) and its own hardware pass, or explicitly flagged as a
  carried-forward follow-up if the session runs long (not a silent cut, matching this project's established
  pattern).
- Problem 3's loud-error fix attempted for at least `mqtt-shared.ts` while in the area, flagged either way.
- `npx tsc --noEmit` clean (stray-`.js` check first), all touched off-device tests passing.

## Stop conditions

- The ordering-race fix does NOT hold on ESP32 or RP2040 -- stop and re-open the design (see Problem 1, item 4)
  rather than tuning bounds/timeouts.
- `http_request`'s canvas wiring surfaces a real structural blocker the other four node types' canvas work didn't
  hit -- stop and reconsider rather than forcing the same pattern through.
- Any existing test suite needs modifying beyond what's already flagged above (standing condition every prior
  session in this repo has used).

## Not in scope for this chat

- RP2350 (Pico 2 / Pico 2 W) bring-up -- separate, already-queued item (`rp2350-bringup-briefing.md`), unrelated
  thread. Don't conflate RP2040 (this briefing's Problem 1) with RP2350.
- The custom-node-authoring sequencing override (`outstanding-items/sequencing-override.md`) -- check whether
  Mike has run the validation session it calls for; if not, that still technically outranks this briefing per
  his own 2026-08-20 ordering, worth confirming rather than assuming this briefing is next by default.
- Backend/auth work, TCP send/listen-receive, I2C/SPI sensor nodes, filter/event-compression node -- all
  separately tracked in `outstanding-items.md`, none touched by this thread.
- MQTTS/TLS -- still deferred, unrelated.
- Everything in "Also flagged, 2026-09-04" above.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself in a real Terminal, never executed from the sandbox -- this was violated once, briefly, in the
2026-09-04 session (hit a real permission/lock error on the shared mount exactly as CLAUDE.md warned it would);
don't repeat that mistake. Read-only git commands (status, log, diff) are fine to run directly.
