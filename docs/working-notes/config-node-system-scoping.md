# Working note: shared network config nodes — scoping, 2026-08-18

> **Status: fully resolved/superseded as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** The "build or not" question
> this note deliberately left open was answered by Mike
> (`config-node-and-palette-implementation-briefing.md`: yes, mandatory).
> This note's technical analysis (the 5-area breakdown, the canvas-wiring
> prerequisite) is still accurate background, not wasted work — kept for
> historical reference, not active reading.

Status: scoping note, not a decision, not an implementation briefing. Written
mid-session during the UDP/TCP batch's hardware bring-up, after Mike asked
directly whether the WiFi-credentials sharing built for `udp_send`/
`udp_receive` was meant to be Node-RED's config-node pattern. It isn't —
this note is the honest gap analysis and a sketch of what closing it would
actually take, for a future session (or Mike) to pick up and decide, not
something resolved here. Per `CLAUDE.md`'s own opening line, whoever
pursues this should read `docs/thingstudio-design-doc.md` §6/§7 in full
first, not treat this note as a substitute.

## The problem, concretely

Every network-capable node type — `wifi_status`, `http_request`,
`mqtt_publish`, `mqtt_subscribe`, and now `udp_send`/`udp_receive` — carries
its own `ssid`/`password` (or, for MQTT, `broker`/`port`/`ssid`/`password`)
properties, duplicated per node instance in the editor's property panel.
Any "sharing" that happens today is a **compile-time accident, not an
editor-level relationship**: `compile.ts`'s `mergeSetup` dedups generated
setup code by a fixed string key (`"wifi-sta"` for the plain-socket network
nodes, a broker+port-derived key for MQTT) *only when two nodes' configured
properties happen to produce byte-identical generated code*. If two nodes
disagree — a typo'd password on one of them, say — the mismatch is
invisible in the editor and silently resolved by "whichever node's codegen
runs first wins" at compile time. Not a new discovery: `wifi-status.ts` and
`mqtt-shared.ts` both already document this exact gap in their own header
comments. It just went from "known but abstract" to "concretely annoying"
the moment real hardware bring-up needed the same WiFi credentials typed
into two separate UDP node property panels with no indication if they'd
drifted.

Node-RED's answer, which Mike pointed at directly (see his screenshot: an
`mqtt out` node's "Server" field is a dropdown referencing a separately-
configured broker object, with inline pencil-to-edit and +-to-add-new): a
**config node** — configured once, referenced by ID from every node that
needs it. Change the password once, every referencing node picks it up;
disagreement is structurally impossible rather than silently tolerated.

## What Node-RED's pattern actually is, concretely

- Config nodes are a distinct node category: not wired into the flow graph
  (no input/output ports, don't appear on the canvas as boxes), just live
  in the flow's node list with their own `id`/`type`/`properties` (e.g.
  `type: "mqtt-broker"`), referenced by *other* nodes' property values
  (e.g. `mqtt out`'s `"server"` property holds the broker config node's
  `id`, not inline credentials).
- The property-panel field for a config-node-typed property renders as:
  dropdown (pick an existing config node), pencil icon (edit the selected
  one inline, opening its own small edit dialog), + icon (add a new one) —
  the exact three-icon affordance in Mike's screenshot.
- Config nodes can be scoped to one flow/tab or marked global (usable
  across every tab) — Node-RED supports both; a flow's config nodes travel
  with it when exported/imported.

## What it would take here, concretely (sketched, not decided)

1. **Graph/data model** (`editor/src/compiler/graph.ts`, `editor/src/
   flow-file/flow-file.ts`). Today `GraphNode` is `{id, type, properties}`,
   and everything with a `type` is assumed wire-connectable — one of
   `node-definition.ts`'s three `NodeKind`s (`source`/`transform`/`sink`).
   A config node fits none of them: no ports, no codegen output of its
   own, its only role is being referenced by ID from another node's
   property. Two live options, not chosen between here:
   - A 4th `NodeKind` (`"config"`?) — never wired, no `ports`, no
     `codegenSource`/`codegenTransform`/`codegenSink`/`codegenEventSource`
     hook, invisible to `compile.ts`'s DAG walk (reachability/cycle
     checks) entirely.
   - A wholly separate array in the flow-file format's top-level shape
     (today: `nodes`/`edges`/`layout` — could grow a 4th `configs` array)
     so the compiler's "is this a graph node" logic never has to special-
     case config nodes out of the wired-node list at all.

2. **`node-definition.ts` contract.** A network node's property (e.g. a
   new `wifiConfig`) would hold a config-node ID rather than inline
   `ssid`/`password`. `codegenSource`/`codegenTransform`/`codegenSink`
   hooks currently only receive `(node, ctx)` — no way to resolve "the
   config node with this ID" into its actual properties. Needs a new
   lookup mechanism threaded through `CodegenContext` (or a new parameter
   entirely), touching every existing codegen call site in `compile.ts`
   even though only network nodes would use it. Worth checking whether
   that's a clean, generically-useful addition (config nodes could serve
   non-WiFi purposes later — an MQTT broker config node is the obvious
   second case, already half-real via `mqtt-shared.ts`'s `MqttBrokerConfig`
   shape) or a leaky one-purpose abstraction before committing to it.

3. **Compiler dedup.** Today `wifi-sta`'s dedup is by-*value* (byte-
   identical generated code). With a real config-node reference, dedup
   becomes by-*identity* (the config node's own ID) — arguably strictly
   simpler and more correct: two nodes referencing the same config node ID
   trivially share one setup statement with no string-comparison needed,
   and disagreement becomes structurally impossible (there's only one
   password field to edit) rather than silently tolerated. This is the
   real payoff of doing this work, not just editor UX polish.

4. **Editor UI** (`app/rete/nodes.ts`, `app/rete/palette.ts`, the property
   panel). The dropdown+pencil+add-new affordance itself is genuinely new
   UI, not a small tweak — and Node-RED's dropdown has to list every
   existing config node of the right type (in-flow or global), which
   means somewhere to actually track/browse them; nothing like that
   exists in this editor today.

5. **Scope: per-flow vs. global.** Node-RED supports both. Design doc §6's
   "one flow, not several" v1 scoping note (multi-flow bookkeeping already
   deferred to v2 elsewhere in this project) suggests per-flow-only is the
   natural v1 answer here too, but that's an inference, not something this
   note confirms against the actual design doc text — check §6 directly.

## Prerequisite worth flagging explicitly, not assumed away

**None of the network node types are wired into the canvas palette yet.**
`wifi_status`, `http_request`, `mqtt_publish`, `mqtt_subscribe`, and the
new `udp_send`/`udp_receive` are all registry-only — no `ports` field in
their `NodeDefinition`, no Rete node class, no palette entry. Confirmed by
grep: zero hits for any of the six across `app/rete/nodes.ts` and
`app/rete/palette.ts`. A config-node system's entire value proposition is
UI-visible — the dropdown/pencil/add-new affordance lives inside a real
node's real property panel — so there's no live surface to attach it to
until at least one network node type is actually palette-wired first.
Whoever picks this up needs to either (a) wire at least one network node
type onto the canvas as an explicit prerequisite step, or (b) fold
canvas-wiring all six network node types into the same piece of work, not
silently assume it's already done or someone else's separately-scoped
problem.

## Not decided here

- Whether to build this at all vs. living with today's per-node
  duplication + value-based dedup. That's a real, defensible "cheapest
  thing that works" v1 choice on its own terms (CLAUDE.md's "no premature
  optimization" framing) — not obviously wrong, and not this note's call
  to make unilaterally. Mike's explicit decision, when there's time to
  make it deliberately rather than mid-hardware-bring-up.
- The data-model shape (4th `NodeKind` vs. a separate `configs` array) —
  sketched as two live options above, neither chosen.
- Per-flow vs. global config-node scope.

## Stop conditions for whoever picks this up

- Read `docs/thingstudio-design-doc.md` §6/§7 in full before proposing a
  data-model shape — this note is informed by `node-definition-model.md`
  and `wire-type-system-scoping.md`'s already-decided contracts (both
  referenced above) but does not re-verify neither of those two documents'
  existing calls forecloses one of the two model options sketched here.

## Not in scope for this note

- Actually implementing anything — scoping only.
- The six network node types' canvas wiring itself, beyond flagging it as
  a dependency above (that's its own piece of work, not free-standing
  scope of this note).
