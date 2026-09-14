# Multi-output-port support (was "Connection-state gate/router nodes")

Status: reframed 2026-09-06, during Mike's item-by-item priority pass. General mechanism +
function-node UI **built 2026-09-12** (`decisions/editor-canvas.md`'s 2026-09-12 entry). The
pass-or-drop WiFi-link status gate (`thingstudio/wifi_gate`) **built 2026-09-14**, WiFi-link-only
scope (Mike's call -- see that date's entry below). The dedicated router/switch node is
deferred to **[POST-MVP]** (Mike's call, 2026-09-14) -- see that date's entry below.

## What this actually is now

Generalized past the specific two-output status router into real multi-output-port support across the editor,
Node-RED-style (https://nodered.org/docs/user-guide/writing-functions#multiple-outputs):

- Function-node UI to configure a node's output count (Node-RED's function edit dialog equivalent).
- Codegen for the return-value / `node.send()` array convention: a function returns (or sends) an array matching
  the output count -- `return [msg, null]` routes to output 1 only, `null` in a slot means nothing is sent out
  that output, and a nested array in a slot (`[[msg1, msg2], msg3]`) sends multiple messages out that one output
  in sequence, in order.
- Canvas wiring for N output ports on a node -- today's `ClassicPreset.Node` construction (`nodes.ts`) assumes a
  single named output per node type; needs a real multi-port contract in the compiler/graph model, not just the
  canvas class.

## Already anticipated

`decisions/node-authoring.md`'s 2026-08-20 entry deliberately caps custom-node output ports at 1 via *codegen
validation* (`validateCustomNodeDescriptor`), not the `.node.json` schema itself -- specifically so this "higher-
priority multi-output-routing roadmap item" wouldn't be compromised by the custom-node format choice. Confirmed
directly with Mike at the time ("multiple outputs is fairly high on the priority list... just don't do anything to
compromise it"). This item is that roadmap item.

## What it subsumes

The original ask here was narrower: a pass-or-drop WiFi/MQTT-status gate (cheap, no compiler change needed --
single boolean gate, buildable today independent of this) and a real two-output status router (genuinely needed
a multi-output-port contract that didn't exist). Both become straightforward once general multi-output support
exists, rather than needing their own bespoke multi-output mechanism. `mvp-feature-priorities.md`'s own reasoning
for the router shape still applies: worth designing as a generic switch/router primitive once multi-output exists,
not wifi/mqtt-specific.

## Built 2026-09-12

The general mechanism and the function-node UI described above are both built: `NodeDefinition.outputCount()`
(compiler contract), `compile.ts`'s per-output-slot routing (loose tolerance on a malformed return shape -- Mike's
call), and the function node's own output-count control/dynamic ports (grow-the-pill sizing, also Mike's call).
Full write-up: `decisions/editor-canvas.md`'s 2026-09-12 entry.

Per-output live-value streaming stays deferred (also Mike's call, same entry) -- this pass is routing only.

## Built 2026-09-14: pass-or-drop WiFi-link gate (`thingstudio/wifi_gate`)

The pass-or-drop half of the item's original narrower ask, built as a single-boolean-gate transform --
confirmed it needed no multi-output mechanism at all, same as this file already anticipated above. Scoped
to WiFi link state only (Mike's explicit call, asked via AskUserQuestion before implementing: "WiFi link
only" over a WiFi+MQTT-broker-aware version) -- an MQTT-broker-specific gate (WiFi up but a specific
broker unreachable) is a separate, still-open follow-up if finer granularity than link-level ever turns
out to matter, not built here.

New node type `thingstudio/wifi_gate` (`editor/src/node-library/wifi-gate.ts`): one input, one output,
passes `msg` through unchanged if `network.WLAN(STA_IF).isconnected()` is true at message-arrival-time, or
returns `None` (drops the message, same mechanism a `function` node's own `return None` uses) if not. No
properties of its own -- derives WiFi credentials from the flow's own sole `wifi_status` node via
`resolveFlowWifiCredentials()`, same pattern `udp_send`/`udp_receive`/`http_request`/`mqtt_publish`/
`mqtt_subscribe` already use, and independently calls `wifiSetupStatement()` with the same `deferToMqtt`
computation those nodes make, so the shared `wifi-sta` setup-statement dedup key can't disagree with
`wifi_status`'s own decision.

Checks live link state at message-arrival-time rather than a value carried on `wifi_status`'s own emitted
messages: `wifi_status` only emits on a connection-identity *change*, so a fast-firing source (a timer or
sensor) gated off its output wire could easily be checking stale state -- a direct hardware read is what
actually answers "is the link up right now."

Full canvas wiring, not registry-only: `registry.ts`, a `WifiGateNode` Rete class (`nodes.ts`), a palette
entry (teal-green, `group: "network"`, `priority: 11` -- right after `wifi_status`'s own 10), a hint-only
`PropertyPanel.vue` section (no configurable properties), `verify-flow-file.ts`'s `KNOWN_KINDS`, a vitest
suite (`editor/test/node-wifi-gate.test.ts` -- pass-through when connected, drop when not, both via real
generated Python run against pymock's `network.WLAN.CONNECTED` toggle, plus the same CompileError/
wifi-sta-sharing coverage `node-udp-send.test.ts` has for its own wifi_status dependency), and a user-guide
page (`docs/user-guide/nodes/wifi-gate.md`).

## 2026-09-14, Mike's call: dedicated router/switch node deferred to POST-MVP

A dedicated router/switch node (the item's original narrower ask -- e.g. a real two-output status/condition
router) isn't built, and Mike's call is that it doesn't need to be for now: a `function` node already has
multiple, configurable outputs (built 2026-09-12, above) and an `if`/`switch` written directly in its own
code covers the same routing need today -- "I don't see the need for a router node, at least now, I can
make a function node with multiple outputs and switch there." The general mechanism still makes a real
router node a much smaller addition than when this item was written (a `NodeDefinition` with a fixed
`outputCount()` plus ordinary `codegenTransform` routing, no compiler changes needed) -- worth revisiting
if a dedicated node (its own condition-editor UI, labeled outputs) turns out to earn its keep over a
function node doing the same job, but not before then.
