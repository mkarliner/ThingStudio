# Single wifi_status ownership of WiFi credentials -- 2026-09-04 fix

Raised by Mike, hands-on, same session as confirming `basic-mqtt.flow.json` works on real
hardware (see `mvp-validation-plan.md`'s 2026-09-04 entry): he could set the flow's
`wifi_status` node's WiFi config to `"unmanaged"` while an `mqtt_publish` node elsewhere in
the same flow still had its own, independently-selectable WiFi config pointed at a config
with a real ssid -- two contradictory claims about the one physical radio the flow actually
has, with nothing in the compiler to notice or reject it.

## Root cause

Every network node type that needs the WiFi station interface up -- `wifi_status`,
`udp_send`, `udp_receive`, `mqtt_publish`, `mqtt_subscribe`, and (unmigrated until this
session) `http_request` -- carried its OWN independent `wifiConfigId` property, each bound
to its own `ConfigRefField` in `PropertyPanel.vue`. This fixed the original "typing the same
ssid/password into five different nodes" problem (config-node-and-palette-implementation-
briefing.md), but never actually constrained every network node in one flow to agree on
*which* WiFi config was in effect -- `wifi-status.ts`'s own header already flagged the
softer version of this ("if two network nodes reference different wifi configs, mergeSetup's
dedup silently keeps whichever compiled first") as a known gap, but mqtt_publish/
mqtt_subscribe don't even share `wifi_status`'s setup-statement dedup key at all (they drive
their own independent connection via the vendored `mqtt_as`, mqtt-shared.ts's own header) --
so for MQTT specifically this wasn't "one silently wins," it was "both fire, with genuinely
different credentials."

## Fix

Mike's own explicit call, same session, on both the fix's scope and its constraints:

1. **Assume exactly one WiFi interface per flow, for now.**
2. **`wifi_status` becomes the flow's sole owner of WiFi identity.** It keeps its own
   `wifiConfigId` property and `ConfigRefField` exactly as before -- it was never part of
   the bug.
3. **Every other network node type loses its own `wifiConfigId` property entirely** --
   `udp_send`, `udp_receive`, `mqtt_publish`, `mqtt_subscribe`, `http_request`. No property,
   no `ConfigRefField`, nothing to independently disagree with `wifi_status` any more.
4. **Keep the `wifi_status` node's own name/type unchanged** (`thingstudio/wifi_status`) --
   explicitly not renamed to plain "wifi," Mike's call, to avoid a flow-file migration for
   no functional gain right now.
5. **Don't foreclose multiple WiFi interfaces later** (Mike's explicit ask) -- see below.

### Mechanism

A new, optional `CodegenContext.findNodesOfType(type)` method (`node-definition.ts`,
implemented for real in `compile.ts` as a plain filter over the graph's own node list --
optional so every pre-existing hand-rolled `CodegenContext` mock in the test suite that
doesn't touch WiFi resolution keeps compiling unchanged, cheap-by-default per CLAUDE.md).

`wifi-status.ts` gains `resolveFlowWifiCredentials(ctx, nodeTypeLabel)`, the flow-wide
counterpart to the existing `resolveWifiCredentials(properties, ctx, nodeTypeLabel)`: it
calls `ctx.findNodesOfType("thingstudio/wifi_status")`, requires exactly one match (a loud
`CompileError` for zero or more than one -- not a silent pick), and resolves WiFi credentials
from THAT node's own `wifiConfigId`. `udp-send.ts`, `udp-receive.ts`, `mqtt-shared.ts`'s
`parseMqttBrokerProps`, and `http-request.ts` all call this instead of the per-node version
now. `http_request` picked up its long-deferred WiFi-config-node migration as a direct side
effect of this change (it had never been migrated at all, still reading raw `ssid`/
`password` off its own properties with a hardcoded `"open"` compatibility shim) -- its
still-open canvas-wiring gap (Rete class/ports/palette entry) is unrelated and untouched,
see `canvas-presence-gaps.md`/`http-request-config-node-gap.md`.

### Multi-interface future, deliberately kept open

Per CLAUDE.md's "don't paint into an architectural dead end" principle: the day a board
legitimately needs a second WiFi interface, each interface becomes its own `wifi_status`
node, and the other network node types would gain ONE new property picking which
`wifi_status` node to derive from. Adding that property later needs no migration of
already-saved flow files -- a flow with exactly one `wifi_status` node has an unambiguous,
correct default (the sole one) whether or not that future property exists yet. Not a
one-way door, same shape as the MQTTS/TLS precedent `mqtt-shared.ts`'s own header already
documents.

## What changed, concretely

- `node-definition.ts`: `CodegenContext.findNodesOfType?(type): GraphNode[]` (optional).
- `compile.ts`: real implementation (`graphData.nodes.filter(...)`).
- `wifi-status.ts`: new `resolveFlowWifiCredentials()`, exported; `resolveWifiCredentials()`
  itself unchanged, still used by `wifi_status`'s own codegen and internally by the new
  function.
- `mqtt-shared.ts`, `udp-send.ts`, `udp-receive.ts`, `http-request.ts`: call the new
  flow-wide function instead of the per-node one; no `wifiConfigId` property read any more.
- `nodes.ts` (Rete classes): `wifiConfigId` removed from `UdpSendNode`/`UdpReceiveNode`/
  `MqttPublishNode`/`MqttSubscribeNode`'s `properties`. `WifiStatusNode` unchanged.
- `PropertyPanel.vue`: WiFi `ConfigRefField` removed from udp_send/udp_receive/mqtt_publish/
  mqtt_subscribe's panel sections; hint text updated to point at the flow's wifi_status node.
  `wifi_status`'s own panel section unchanged.
- `test-flows/basic-mqtt.flow.json`: `wifiConfigId` removed from both mqtt node property
  blocks (now inert/unused had it been left) -- the flow already had its own `wifi_status`
  node referencing the same WiFi config, so no other change was needed for this file to keep
  compiling.
- Off-device tests updated across `node-udp-send.test.ts`, `node-udp-receive.test.ts`,
  `node-mqtt-publish.test.ts`, `node-mqtt-subscribe.test.ts`, `node-http-request.test.ts`:
  each gained a synthetic/real `wifi_status` node (direct-codegen tests use a
  `ctx.findNodesOfType` stand-in populated via a `wifiConfigId` convenience param on each
  file's own `node()` helper; full-`compile()` tests gained a real `thingstudio/wifi_status`
  GraphNode in their graph). Each file gained explicit "zero wifi_status nodes" and "more
  than one wifi_status node" CompileError tests. `node-wifi-status.test.ts` and
  `compiler.config-nodes.test.ts` needed no changes -- `wifi_status` itself, and the generic
  config-resolution mechanism, are both unaffected by this change.

## Not yet done / explicitly out of scope this pass

- **No real-hardware pass of this change yet.** It changes the WiFi-resolution codepath for
  every network node type, including the one (`basic-mqtt.flow.json`) Mike just confirmed
  working on real hardware today, before this fix landed. Needs a redeploy + retest before
  trusting this on a real board -- flagged, not silently assumed safe.
  **Update, 2026-09-04: that real-hardware pass happened, and it surfaced a confirmed bug** --
  see `wifi-status-mqtt-connect-ordering-race.md`. Making `wifi_status` mandatory in every mqtt
  flow (this fix) turned a previously-rare, unvalidated cross-node WiFi race into something that
  can hit every mqtt+wifi_status flow. Fix implemented same day; needs `tsc`/`vitest` plus real
  hardware re-verification -- **on RP2040 as well as ESP32** (Mike, 2026-09-04) -- see that file's
  own RP2040 note (the race-wait fix is ESP32-gated today, untested on RP2040 in either
  direction).
- **`udp_send`/`udp_receive`'s pre-existing "different nodes could reference different wifi
  configs" gap** (this file's own header note above) is now structurally impossible for
  every node type this fix touches, since none of them has a `wifiConfigId` of their own left
  to diverge with -- closes that gap too, not just the MQTT-specific one that surfaced it.
- **`http_request`'s canvas-wiring gap is untouched** -- still registry-only, no `ports`, no
  Rete class, no palette entry. Only its WiFi-credential source changed.
- **Multiple `wifi_status` nodes are a hard CompileError today, not a feature** -- per Mike's
  own "assume one interface for now," not an oversight.

## Follow-up discussion, same day: wifi_status vs. mqtt_as's own WiFi management

Mike asked, reasonably, why `mqtt_publish`/`mqtt_subscribe` need WiFi credentials at all --
his instinct was that a network node should only ever need to know *which interface* to use,
never credentials themselves. Investigating confirmed today's design still doesn't fully get
there: mqtt_as (the vendored library, `device-runtime/src/vendor/mqtt_as/`) manages its own
WiFi connect/reconnect loop internally (`_keep_connected()`, started from its own `.connect()`)
using `ssid`/`wifi_pw` baked into its own config dict -- that's the entire reason it was
vendored over `umqtt.simple` (real outage recovery), and it has no mode to accept "someone
else already brought the interface up, just use it." So MQTT nodes still need real
credentials today, sourced from the flow's one `wifi_status` node via
`resolveFlowWifiCredentials()` (this fix) rather than a config reference of their own -- an
improvement (can't disagree with wifi_status any more) but not the deeper "interface-only"
design Mike was picturing.

Follow-up question: could `wifi_status` instead reuse mqtt_as's (more robust) reconnect
logic, rather than each side having its own WiFi-management mechanism (wifi_status's plain
one-shot `.connect()` vs. mqtt_as's own retry/backoff loop)? Answer: not directly --
mqtt_as's WiFi handling isn't factored out as a standalone utility; it's entangled with the
broker session itself (keepalive, outbox replay, the queue) and only runs as part of an
actual `MQTTClient` connected to an actual broker. Symmetric constraint to the one above:
just as mqtt_as can't be told "don't manage WiFi, it's already handled," there's also no way
to get "just the WiFi part" out of it without constructing a real client against a real
broker -- wrong dependency direction for a flow with no MQTT nodes at all (udp/http-only, or
a bare wifi_status flow).

The real fix, if this becomes worth doing, would be porting the *pattern* mqtt-shared.ts
already has (`mqttWifiPrecheckStatement`/`mqttEnsureConnectedSnippet`'s bounded retry +
settle-wait) into `wifi_status`'s own generated code as ThingStudio's own small piece --
giving every network node (via the flow's one wifi_status) the same reconnect robustness
MQTT already has for itself, without wifi_status taking a dependency on the vendored MQTT
library. This would NOT fully unify the two mechanisms into one -- mqtt_as would still
insist on managing its own connection internally regardless -- just make both sides equally
robust instead of one dumb and one robust.

**Decision (Mike, 2026-09-04): leave this for later, revisit only if it turns out to be a
real-world problem** (i.e. wifi_status's plain one-shot connect actually causing missed
reconnects on real hardware, not just a theoretical asymmetry). Not scoped or started.

### Candidate fix found, same day, if/when this does become a real problem

Mike surfaced [zcattacz/mqtt_as](https://github.com/zcattacz/mqtt_as) -- a hard fork of the
upstream `mqtt_as` that removes WiFi/connectivity management from the module entirely,
rather than adding a flag for it. Confirmed by grepping its actual `mqtt_as.py`: zero
occurrences of `wifi_connect`, `ssid`, `wifi_pw`, `_keep_connected`, `network.WLAN`,
`.active(`, `isconnected`, `ifconfig`. Its README states this directly -- "drops wifi and
connectivity management," targets exactly the case of wanting to manage the interface
yourself. `connect()`/`disconnect()` become pure MQTT-session operations; the caller runs
its own connectivity loop and just re-calls `connect()` when the link comes back.

If ThingStudio ever switched to this (or an upstream equivalent), it would get us the rest
of the way to what Mike originally asked about in this thread: `mqtt_publish`/
`mqtt_subscribe` would no longer need `ssid`/`password` at all -- only `wifi_status` would
ever touch WiFi credentials, with mqtt nodes just reacting to "are we connected."

Real caveats, not a drop-in swap, recorded so they don't have to be re-discovered later:

- **Stale relative to upstream.** Its own `VERSION` constant is still `(0, 7, 0)` against the
  `(0, 8, 5)` ThingStudio vendored; last commit 2025-11-25; no evidence it ever merged
  anything from upstream after diverging (2023-11-24). Any upstream bugfixes since then
  (including, potentially, fixes to the ESP32 WiFi-race issues (peterhinch/micropython-mqtt
  #59, #61, #57) this file's own header already documents working around on our side) are
  not in it.
- **Removing WiFi management also removed mqtt_as's own auto-reconnect orchestration** -- the
  entire reason mqtt_as was chosen over `umqtt.simple` in the first place (see
  `device-runtime/src/vendor/mqtt_as/README.md`'s "Why this one over umqtt.simple"). Adopting
  this fork means ThingStudio takes on that reconnect-robustness itself -- which does line up
  with the "port the retry/backoff pattern into wifi_status" idea above, but turns it from a
  nice-to-have into a hard requirement of the switch, not an optional follow-up.
- **No LICENSE file in the fork's own repo** -- the MIT notice survives only as an inline
  comment header in the source (same style this project already relies on for the current
  vendored copy's own provenance, per that README's own honesty about what wasn't verified),
  and the commit history looks squashed/generic (most commits authored as
  `user <user@localhost>`) rather than a clean traceable lineage. Worth a closer look before
  vendoring, not necessarily disqualifying.

**Mike's stated plan, 2026-09-04: raise this with Peter Hinch (upstream maintainer) as a
possible official option on the real `mqtt_as`, rather than adopting the fork as-is.**
Nothing to build on ThingStudio's side unless/until that goes somewhere, or the "is this a
real problem" question above comes back yes independently. Recorded here so the candidate
fix isn't lost either way.
