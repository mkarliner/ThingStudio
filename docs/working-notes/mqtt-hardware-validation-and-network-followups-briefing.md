# Briefing: MQTT real-hardware validation + network/config-node follow-ups

**Superseded, 2026-09-04 -- read `wifi-race-fix-verification-and-network-followups-briefing.md` instead.** A lot
happened against this briefing's scope in the 2026-09-04 session: the MQTT config-node migration this briefing
called for was already done before that session (see Problem 1's own "Where this came from"); real hardware
testing finally happened and found the original WiFi-precheck fix didn't hold (a real ordering bug, now fixed,
still unverified); `http_request` got its WiFi-config migration but NOT its canvas wiring (Problem 2 only half
closed); Problem 3 (loud network errors) still untouched. The successor briefing carries forward everything from
this one that's still open (Problem 2's canvas-wiring half, Problem 3 in full, qos 1/retain/outage-recovery/
stale-NVS repro) plus the new verification work the 2026-09-04 session's own findings require. This file is kept
for its historical reasoning (the original WiFi-precheck design, since superseded) rather than deleted.

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` before assuming anything below is committed.** The
MQTT WiFi-precheck fix (`mqttWifiPrecheckStatement()`, `mqtt-shared.ts`),
this briefing, and the outstanding-items cross-reference were all handed
to Mike as finished files from a sandbox that can't commit — confirm
what's actually landed rather than trusting this doc's own account of
"current state."

## Where this came from

A real hardware deploy of Mike's `mqtttest.flow.json` (pure
`mqtt_publish`/`mqtt_subscribe`, one shared WiFi/broker config) hit
`E (...) wifi:sta is connecting, cannot set config`. Root-caused to the
vendored `mqtt_as`'s own `wifi_connect()` (ESP32 branch) racing ESP-IDF's
NVS-cached auto-reconnect. A vendored-file patch was drafted, applied,
and reverted the same day — Mike reviewed this library's own issue
history ([#59](https://github.com/peterhinch/micropython-mqtt/issues/59),
[#61](https://github.com/peterhinch/micropython-mqtt/issues/61),
[#57](https://github.com/peterhinch/micropython-mqtt/pull/57)) and called
for a fix entirely on Thingstudio's own side instead.
`mqttWifiPrecheckStatement()` (`mqtt-shared.ts`) is that fix: a bounded,
ESP32-gated, wait-not-cancel precheck emitted by every mqtt_publish/
mqtt_subscribe node. Verified so far only by an off-device compile +
`ast.parse` check against the reproducing flow's equivalent graph, plus
273/273 editor tests — **never run against real hardware**. Full story:
`docs/working-notes/decisions.md`'s 2026-08-21 entry under "Redeploy /
network fault handling."

That same day's work also finished migrating `mqtt_publish`/
`mqtt_subscribe` onto config nodes (`wifiConfigId` + a new
`thingstudio/config/mqtt-broker`/`brokerConfigId`, the latter carrying
broker-level `username`/`password` auth) and gave both node types real
canvas presence for the first time. None of that — the config migration,
the broker auth fields, or the WiFi-precheck fix — has a real hardware
pass on record. This briefing is that pass, plus the adjacent
`http_request` gaps `outstanding-items.md`'s "Network / config nodes"
section already tracks as open.

Read, in this order, before writing any code:

1. `docs/working-notes/outstanding-items.md`'s "Network / config nodes"
   section — the current, audited state of every item this briefing
   continues. Don't re-derive it; it's current as of this briefing.
2. `docs/working-notes/decisions.md`'s 2026-08-21 entry (above) — the
   WiFi-precheck fix's full reasoning, including why the vendored-file
   patch was reverted.
3. `editor/src/node-library/mqtt-shared.ts` in full — its header covers
   the config-node migration, the broker-auth design, and the
   WiFi-precheck fix together; `mqtt-publish.ts`/`mqtt-subscribe.ts` for
   how the two node types actually use it.
4. `editor/src/node-library/http-request.ts`'s header — its own
   "Still NOT migrated to config nodes" note, and the `"open"`-security
   compatibility shim it passes `wifiSetupStatement()` today.
5. `editor/src/node-library/udp-send.ts`'s "Loud network errors" section
   (~line 71) — the OSError-with-host:port-context pattern from
   `redeploy-cleanup-and-network-fault-detection-briefing.md`'s Problem
   2a. Neither `http-request.ts` nor `mqtt-shared.ts` has this treatment
   yet — confirmed by grep, zero `OSError`/`except` hits in either file.
6. `test-flows/README.md` and `test-flows/udp-echo-tester.flow.json` —
   the config-node `FlowFile` shape and the load/deploy conventions
   Problem 1's new sample flow should follow.

## Problem 1: MQTT real-hardware validation — the fix is reasoned, not proven

### What to validate

- **The actual bug this fix targets**: redeploy to a board whose
  filesystem still has NVS-cached station credentials from a *different*
  prior deploy (the exact condition that surfaced
  `E (...) wifi:sta is connecting, cannot set config`) and confirm the
  precheck holds — no repeat of that error, connect succeeds.
- **Functional MQTT roundtrip**, none of which has run on real hardware
  yet: publish + subscribe against a real local broker (e.g. Mosquitto);
  broker `username`/`password` auth actually enforced (`mqtt-broker`
  config's new auth fields — confirm a wrong password is rejected by the
  broker, not silently accepted); qos 1 (only qos 0 exercised in Mike's
  sample so far); the `retain` flag.
- **Outage recovery** — the entire reason `mqtt_as` was vendored over
  `umqtt.simple` (`_keep_connected()`), never verified end-to-end: kill
  and restart the broker, or the board's WiFi, mid-flow, and confirm the
  client actually reconnects rather than just hanging or erroring once.

### Recommended approach

Save Mike's own `mqtttest.flow.json` into `test-flows/` as the canonical
MQTT sample — mirroring `udp-echo-tester.flow.json`'s precedent
(`test-flows/README.md` currently has no MQTT entry at all). Add a
`test-flows/README.md` section for it matching the udp-echo-tester
section's shape: broker setup instructions, what to watch for per check
above, prerequisites (a local broker, credentials filled in).

### Validation

Record a dated Results entry in
`docs/working-notes/validation/mvp-validation-plan.md`'s Tier 1 section
(next to the existing 2026-08-14/2026-08-21 mqtt entries) — this is
where the "network nodes: real hardware pass is non-negotiable" bar
actually gets closed out, not just this briefing.

## Problem 2: `http_request` still hasn't gotten the config-node/canvas treatment

### Current state

`http-request.ts` still reads raw `ssid`/`password` off its own
properties (not `wifiConfigId`), is still registry-only (no `ports`, no
Rete node class, no palette entry — confirmed in
`outstanding-items.md`'s "Most of the node library still has no canvas
presence" bullet), and has never had a real hardware pass against a
local HTTP server. All three were explicitly flagged as follow-ups when
`wifi_status`/`udp_send`/`udp_receive`/`mqtt_publish`/`mqtt_subscribe`
each got this same treatment — not silent scope cuts.

### Recommended fix

Mechanical, following the pattern already used four times: migrate
`http-request.ts` to `resolveWifiCredentials()`/`wifiConfigId` (dropping
the `"open"`-security compatibility shim its header documents, once a
real config is required), then wire it onto the canvas — `ports`, Rete
node class, palette entry, `PropertyPanel.vue` section — following
`mqtt-publish.ts`'s own recent worked example rather than re-deriving the
four-step pattern from scratch.

### Validation

A local HTTP test server (Node's own `http` module works, per
`http-request.ts`'s own header note on Content-Length) reachable from
real ESP32 hardware — GET and POST, confirming response body/status
land in `msg` correctly. Dated Results entry in `mvp-validation-plan.md`,
same as Problem 1.

## Problem 3: loud network errors never reached `http_request`/MQTT

`redeploy-cleanup-and-network-fault-detection-briefing.md`'s Problem 2a
fix (OSError re-raised with host:port context, `udp-send.ts`/
`udp-receive.ts`'s pattern) was explicitly flagged as a judgment call for
`http-request.ts`/`mqtt-shared.ts` too, not mandated then. Still not
done — confirmed by grep, neither file catches `OSError` at all today.
Same mechanical fix: wrap `asyncio.open_connection`/the request call in
`http-request.ts`, and `mqtt_as.MQTTClient.connect()`/`.publish()`/
`.subscribe()` in `mqtt-shared.ts`'s `mqttEnsureConnectedSnippet()`/
callers, with the operation's own broker/host:port folded into the
re-raised message.

## Success criteria

- A dated Results entry in `mvp-validation-plan.md` confirming the
  WiFi-precheck fix holds under real stale-NVS-credential conditions on
  real ESP32 hardware — the actual condition that surfaced the bug, not
  just a fresh board's happy path.
- Publish + subscribe, broker auth, qos 1, retain, and (if practical
  within the session) an outage-recovery check all confirmed on real
  hardware, not just reasoned from `mqtt_as`'s own documentation.
- `mqtttest.flow.json` saved into `test-flows/` with a README section,
  the same way `udp-echo-tester.flow.json` already is.
- `http_request` migrated to config nodes and wired onto the canvas, with
  its own real hardware pass — or, if the session runs long, landed
  cleanly with the hardware pass left as an explicit, flagged follow-up
  (not a silent cut), matching this project's own established pattern
  for scope overruns.
- Problem 3's loud-error fix attempted for at least `mqtt-shared.ts`
  while in the area, flagged either way (done, or explicitly deferred)
  rather than silently skipped again.
- `./node_modules/.bin/tsc --noEmit` clean (direct binary, check for
  stray compiled `.js` first), off-device tests updated for anything
  touched.

## Stop conditions

- The WiFi-precheck fix does NOT hold under the stale-NVS repro — stop
  and re-open the design rather than tweaking the timeout/loop bound and
  hoping; `decisions.md`'s "ruled-out alternatives" section is the place
  to record whatever's tried next.
- `http_request`'s config-node migration surfaces a real blocker the
  other four node types' migrations didn't hit (its hand-rolled HTTP
  client differs structurally from `wifi_status`/`udp_send` and the
  vendored-`mqtt_as` cases) — stop and reconsider rather than forcing the
  same pattern through.
- Any existing test suite needs modifying (standing condition every
  prior session in this repo has used).

## Not in scope for this chat

- RP2350 bring-up — separate, already-queued item
  (`rp2350-bringup-briefing.md`), unrelated thread.
- Backend/auth work — separate, already-flagged MVP-needed item, unrelated.
- TCP send/listen-receive, I2C/SPI sensor nodes, filter/event-compression
  node — all separately tracked in `outstanding-items.md`, none touched
  by network-node hardware validation.
- Whether to file an upstream issue against `mqtt_as` — still Mike's own
  call, `outstanding-items.md`.
- MQTTS/TLS — still deferred, unrelated to this pass.

## Git

Same standing rule as every other session: git writes (`add`/`commit`)
go to Mike as exact commands to run himself in a real Terminal, not run
from the sandbox. Read-only git commands are fine.
