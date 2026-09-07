# Multi-output-port support (was "Connection-state gate/router nodes")

Status: reframed 2026-09-06, during Mike's item-by-item priority pass, **[P2]**.

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

## Not scoped

The compiler/graph-model side of "N output ports, real multi-message-per-output semantics" is real design work,
not a small addition -- needs its own scoping pass (how the wire-protocol/live-value-streaming side interacts with
multiple outputs, how `compile.ts`'s per-source synchronous-downstream-chain model handles fan-out to N outputs
each potentially firing 0-or-more messages) before it's buildable.
