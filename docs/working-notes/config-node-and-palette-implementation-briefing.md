# Briefing: config-node system + network-node palette wiring — implementation

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` before assuming anything below is committed.** This
session's own output (the UDP send/receive nodes, the WiFi-bringup fix on
them, `deploy_runtime.py`, `udp-echo-tester.flow.json`, this briefing) was
handed to Mike as finished files, not a diff — should already be committed
if you're reading this, but confirm rather than assume.

**This session's own settled decision, stated plainly so it isn't
re-litigated:** Mike's own words, verbatim, are the mandate for this
session — *"Write a briefing note for a session to implement config nodes
and fix the palette. Entering ssid credentials multiple times is not
acceptable even for an mvp."* That is a real, explicit override of
`docs/thingstudio-design-doc.md` §6's own line ("config nodes with
per-device override... deferred past v1") and §10's v2-candidates list,
which still name config nodes as post-v1 work as of this writing. Don't
treat that design doc text as still-current scope — it's stale the moment
this briefing lands, and this session should update it (see "Housekeeping"
below), not silently work around it. Whether to build the config-node
system at all is **not** an open question for this session to leave
undecided the way `docs/working-notes/config-node-system-scoping.md`
(previous session, superseded on this one point) deliberately did — Mike
already answered it: yes, mandatory, even for MVP.

Read, in this order, before writing any code:

1. `docs/working-notes/config-node-system-scoping.md` — previous session's
   scoping pass. Its "what it would take" 5-area breakdown and its
   confirmed prerequisite ("no network node is palette-wired — verified via
   grep, zero hits in `app/rete/nodes.ts`/`palette.ts`") are still accurate
   background. Only its "should we build this" framing is superseded — by
   the decision above, not by anything in that note itself.
2. `docs/working-notes/wire-type-system-scoping.md` in full — the palette-
   wiring half of this session depends entirely on the mechanism this note
   designed and a prior session already built: real socket classes
   (`editor/src/app/rete/sockets.ts`), a `ports` field on `NodeDefinition`
   (`editor/src/compiler/node-definition.ts`), and `rete/nodes.ts`'s
   `portSocket()` helper reading that field to construct each port. Every
   node type wired onto the canvas so far (`inject`/`function`/`debug`/
   `gpio_out`/`timer`/`interrupt`) declares real `ports`, not
   `AnySocket` — the six network node types this session wires need the
   same treatment, not a shortcut back to untyped ports.
3. `docs/thingstudio-design-doc.md` §6 (flow/graph representation — read
   the config-nodes paragraph and the 2026-08-17 addenda) and §7
   (extensibility) in full.
4. `editor/src/compiler/node-definition.ts`, `editor/src/compiler/compile.ts`,
   `editor/src/compiler/graph.ts`, `editor/src/flow-file/flow-file.ts`,
   `editor/src/app/rete/{nodes,palette,sockets,graph-adapter}.ts` and
   `editor/src/app/rete/PropertyPanel.vue` — the concrete files this
   session touches. `editor/src/node-library/interrupt.ts` is still the
   freshest "how a node type actually gets wired onto the canvas" worked
   example; `editor/src/node-library/{wifi-status,http-request,mqtt-shared,
   mqtt-publish,mqtt-subscribe,udp-send,udp-receive}.ts` are the six node
   types (well, six types plus the shared MQTT module) actually being
   wired this session.

## What kind of session this is

Two pieces of work that are one session because the second genuinely needs
the first, not because they're naturally the same size: (1) a new
subsystem — Node-RED-style config nodes, referenced by ID from ordinary
nodes' properties instead of duplicated as raw values — and (2) wiring six
existing registry-only node types (`wifi_status`, `http_request`,
`mqtt_publish`, `mqtt_subscribe`, `udp_send`, `udp_receive`) onto the
canvas, following the wire-type-system's now-established pattern. (2) is
mechanical and has a direct precedent (`interrupt`'s own wiring). (1) is
real, new design surface with no direct precedent in this codebase, closer
in kind to the wire-type-system session than to the interrupt session.
Config nodes have nowhere to attach their dropdown/pencil/add-new UI
without at least one live network node on the canvas to attach it to,
which is why these can't be split into two separate sessions the way the
UDP/TCP batch split cleanly from the interrupt node.

## Two different "config node" ideas — pick the Node-RED one, name the other explicitly

Worth disambiguating before writing a data model, because the design doc
and Mike's screenshot are describing two different things that happen to
share a name:

- **Design doc §6's original vision**: "a shared template plus small
  per-device values" — a config that's *mostly* shared across a fleet's
  flow files, with small per-device overrides (a per-device topic prefix,
  a calibration constant), fitting the git-friendly multi-flow-file layout
  §6 describes. This is a multi-file, multi-device concern.
- **Mike's actual ask, from the Node-RED screenshot**: one config object,
  defined once *within a single flow*, referenced by ID from every node
  in that same flow that needs it — the "Server" dropdown + pencil-edit +
  "+"-add-new pattern. This is a single-file, single-flow concern, and
  it's what actually fixes "entering ssid credentials multiple times."

**Build the second one.** It's smaller, it's what was asked for, and it
directly fixes the concrete pain (`udp-echo-tester.flow.json`'s three
duplicated `YOUR_WIFI_SSID`/`YOUR_WIFI_PASSWORD` placeholders — see that
file and `test-flows/README.md`'s note on it). Per-device override across
multiple flow files stays out of scope, explicitly, not silently dropped
— see "Not in scope" below. It's a plausible later layer on top of what
this session builds (a config's `properties` are still just per-flow-file
values), not something this session's data model should try to
preemptively support.

## Recommended data model

This is a recommendation, not a mandate the way the "build it" decision
above is — if the design below hits a real blocker once code is in front
of you, reconsider it, but the reasoning is laid out so a change is a
deliberate call, not a shortcut.

**Configs are not graph nodes.** They don't have ports, aren't wired, and
(per the Node-RED pattern) don't appear as canvas boxes at all. Keeping
them structurally separate from `GraphData.nodes`/`FlowFile.nodes` avoids
touching `compile.ts`'s DAG walk (reachability, cycle detection, source/
sink rules) at all — a config sitting in that array would need every one
of those checks taught to skip it, for no benefit. Concretely:

- **`editor/src/compiler/graph.ts`**: add `GraphConfigNode = { id: string;
  type: string; properties: Record<string, unknown> }` and `configs?:
  GraphConfigNode[]` on `GraphData`. String IDs deliberately, not the
  existing numeric node-ID space — configs and nodes are different
  entities with different identity, and reusing the numeric space would
  invite an accidental collision check that doesn't need to exist.
- **`editor/src/compiler/compile.ts`**: build a `configsById: Map<string,
  GraphConfigNode>` up front, alongside `nodesById` — but never register
  configs in `nodesById`/`childrenOf`/`sources`/`reachable`. Extend
  `CodegenContext` (currently just `uniqueName`) with a `resolveConfig(id:
  string): Record<string, unknown>` method that throws `CompileError`
  (`"referenced config \"<id>\" not found"`) on a missing ID — fault-
  handling priority, same reasoning `nodes.ts`'s `portSocket()` throws
  loudly on a missing port rather than falling back to something silent.
  Node codegen hooks call `ctx.resolveConfig(node.properties.wifiConfigId)`
  themselves and validate the shape they get back (see per-node-type
  section below) — the compiler's job is just handing back the right
  bucket of properties, not validating what's inside it.
- **`editor/src/flow-file/flow-file.ts`**: add the equivalent `configs?:
  FlowFileConfig[]` (same `{id, type, properties}` shape, string id) to
  `FlowFile`, and thread it through `buildFlowFile`/`parseFlowFile`/
  `serializeFlowFileText` the same deterministic way `nodes`/`edges`
  already are (sorted by id, so re-saving an untouched flow stays a
  zero-diff — §6's git-friendliness requirement applies to configs exactly
  as much as it does to nodes).
- **Editor-side storage**: configs aren't Rete graph nodes, so
  `editor.getNodes()` never sees them and `graph-adapter.ts`'s
  `toGraphData()` can't just walk the live Rete graph the way it does for
  everything else. This needs a **new store** — a plain reactive
  collection (`app/rete/store.ts` is the existing home for this kind of
  thing, e.g. a `configs: Map<string, {id, type, properties}>` keyed by
  type, or one flat map with `type` inside each entry) populated when a
  flow file loads and mutated by the add/edit UI (below). `toGraphData()`
  and `buildFlowFile()`'s call sites both need to read this store directly
  and fold it into `GraphData.configs`/`FlowFile.configs` — genuine new
  plumbing, not a couple of extra fields on something that already walks
  the canvas.
- **No new `NodeKind`.** Configs don't produce code themselves and never
  appear in the codegen `kind` switch (`"source"|"transform"|"sink"`) —
  they're pure data, resolved by whichever real node references them.
  There's no need for a `NodeDefinition` entry per config type on the
  compiler side either; a config type's "descriptor" only matters to the
  editor (see UI section), so it doesn't belong in
  `compiler/node-definition.ts` at all. A small, editor-only descriptor
  (label + property field list per config type) living in
  `app/rete/` somewhere is enough — this is the kind of thing worth
  keeping in the editor layer specifically, matching how `NODE_PALETTE`
  (`palette.ts`) already keeps per-kind editor metadata separate from the
  compiler's own registry.

**Config types needed for this session's success bar (see below): one —
`thingstudio/config/wifi`, properties `{ ssid: string; password: string
}`.** A second type, `thingstudio/config/mqtt_broker` (`{ broker: string;
port: number }`), would let `mqtt_publish`/`mqtt_subscribe` stop
duplicating broker identity too — genuinely the same shape of problem,
already partly mitigated today by `mqtt-shared.ts`'s by-value dedup, so
it's real but lower-stakes than the SSID case Mike actually named. Build
it if time allows; treat it as optional, not required, for this session's
own success bar — don't let it become scope creep that crowds out the
SSID fix Mike actually asked for.

## Editor UI: the dropdown/pencil/add-new widget

Mike's screenshot is the reference. The concrete ask: any property field
that references a config shows (a) a dropdown of existing configs of the
matching type, (b) a pencil icon that opens an editor for whichever config
is currently selected, (c) a "+" icon that opens the same editor empty and
assigns the new config's freshly-generated id back into the property on
save.

Build this as **one generic, reusable component** (e.g.
`app/rete/ConfigRefField.vue`), parameterized by config-type string and
field list, not a wifi-specific one-off — a second config type (`mqtt_
broker`, or anything later) should cost a parameter, not a new component.
The actual "edit one config's properties" surface can be as simple as an
inline expand/modal with a couple of text inputs — this project's own
"cheapest implementation that's actually correct" principle applies
directly here; don't over-build the editing chrome.

`PropertyPanel.vue` changes: each of the six network node types' current
raw `ssid`/`password` fields (and, if the second config type gets built,
`broker`/`port` on the two MQTT types) get replaced with the
`ConfigRefField` widget bound to a `wifiConfigId` (or `mqttBrokerConfigId`)
property instead. This is the actual fix for the duplication Mike named —
everything upstream of this (data model, compiler resolution) exists to
make this one property-panel change possible and correct.

## Per-node-type codegen changes

Once `ctx.resolveConfig()` exists, each of the six node types' own
`codegen*` hook needs a small, mechanical change — read the config instead
of the raw property:

- **`wifi-status.ts`, `http-request.ts`, `udp-send.ts`,
  `udp-receive.ts`**: currently call `wifiSetupStatement(node.properties.
  ssid, node.properties.password)` directly. Change to resolve
  `node.properties.wifiConfigId` via `ctx.resolveConfig()` first (when
  present), then feed the resolved `{ssid, password}` into the *same*
  unchanged `wifiSetupStatement()` — that function's own dedup (`"wifi-
  sta"` key) doesn't need to change at all, it already doesn't care where
  its two arguments came from. **Judgment call, not resolved here**:
  keep the config reference optional (no `wifiConfigId` → same "just
  bring the interface up, no connect" behavior these four nodes already
  have today with an empty ssid) rather than making it mandatory — smaller
  behavior change, and it keeps a config-less flow compiling exactly as it
  does today. Flag this choice in the node's own header comment either
  way, the way every other real decision in this file already is.
- **`mqtt-shared.ts`'s `parseMqttBrokerProps`**: today requires `ssid`
  directly on the node's properties (throws `CompileError` if absent —
  already mandatory, unlike the four nodes above). Change it to resolve
  `ssid`/`password` from a referenced `wifiConfigId` instead — this is a
  **non-breaking tightening**, not a new requirement: it's already
  required today, this just relocates where it's entered. `broker`/`port`
  stay direct properties unless the optional second config type (above)
  gets built.

## Fixing the palette: six node types

Follow `interrupt.ts`'s own wiring exactly (that file's own comment
history in `nodes.ts`/`palette.ts` is the worked example) for each of
`wifi_status`, `http_request`, `mqtt_publish`, `mqtt_subscribe`,
`udp_send`, `udp_receive`:

1. **`ports` field** on the type's `NodeDefinition` (in its own
   `node-library/*.ts` file), using real socket types from
   `sockets.ts` — not `AnySocket` as a shortcut. Per-type judgment calls,
   deliberately left open rather than dictated, per
   `wire-type-system-scoping.md`'s own "ship narrow and loose, tighten
   later" governing call — when a payload's real shape is genuinely mixed
   or type-dependent, prefer `any` over guessing wrong and creating
   wire-refusal friction nobody asked for:
   - `wifi_status` (source): output `msg`, type `bool` (the payload is
     always `_wifi_connected`; `ip` is envelope metadata, not the typed
     payload — same "only the payload gets a socket type" treatment
     `gpio_out`'s `signal` input already gets).
   - `http_request` (transform): input `msg` type `any` (body accepts
     bytes/str/anything, per its own codegen's `isinstance` chain);
     output `msg` — its own codegen always does `.decode()` on the
     response body, so `string` is defensible, but flag this as a
     judgment call, not a certainty.
   - `mqtt_publish` (sink): input `msg` type `any` (same
     `payloadToBytesSnippet` bytes/str/other handling `udp_send` has).
   - `mqtt_subscribe` (source): output `msg` type `any` — its own codegen
     only decodes the incoming payload to `str` *if* it's bytes, otherwise
     passes it through unchanged, so it's not reliably `string`.
   - `udp_send` (sink): input `msg` type `any` (same
     `payloadToBytesSnippet` reasoning as `mqtt_publish`).
   - `udp_receive` (source): output `msg` type `bytes` (payload is always
     the raw `_udp_data` from `recvfrom()`, never decoded).
2. **Rete node class** in `app/rete/nodes.ts` — `properties` matching
   exactly what the node's codegen reads (including the new
   `wifiConfigId`/`mqttBrokerConfigId` property replacing raw `ssid`/
   `password`), constructor wiring ports via `portSocket()`, added to
   `NODE_FACTORIES`.
3. **`palette.ts` entry** — extend the `NodeKind` union, pick an unused
   color (every existing kind's color is listed in that file's own header
   comment) and a one-glyph icon, matching that file's established
   convention.
4. **`PropertyPanel.vue` section** — the node's own fields (host/port/
   topic/qos/etc, whatever isn't now a config reference) plus the
   `ConfigRefField` widget for whichever config(s) it references.

**Order of operations, recommended not mandated**: build the config-node
plumbing (data model + compiler resolution + the generic UI widget)
against **one proof case first** — `wifi_status` is the simplest of the
six (one source node, one existing poll property, one new config
reference) — verified genuinely end-to-end: compiles through the real
`compile()`, round-trips through `FlowFile`'s parse/serialize, loads and
saves in an actual browser. Only then mechanically repeat the same
four-step pattern for the other five. This mirrors how the interrupt node
and the wire-type system itself both got built (one real worked example
before scaling a pattern), and it means a design problem in the config
mechanism itself surfaces on the cheapest possible node type, not the
most complex one.

## Success criteria — restated from Mike's own words, not softened

The concrete, non-negotiable bar: **by the end of this session, entering
WiFi credentials more than once in one flow is no longer possible for the
node types that need it.** Concretely, `wifi_status`, `udp_send`, and
`udp_receive` — the three node types in `test-flows/udp-echo-tester.
flow.json`, Mike's own actual hardware-test flow, currently stuck with
three duplicated `YOUR_WIFI_SSID`/`YOUR_WIFI_PASSWORD` placeholders that
have to be kept byte-identical by hand — must be wired onto the canvas,
share one `thingstudio/config/wifi` config object, and that flow file must
be rewritten to reference it once instead of duplicating the values three
times. That flow file becoming loadable through the browser's real "Open
Flow" for the first time (instead of needing the `GraphData`/
`compile-flow.ts` alternate path — see `test-flows/README.md`) is a real,
checkable proof this landed, not just a nice side effect.

`http_request`, `mqtt_publish`, and `mqtt_subscribe` getting the same
treatment is the fuller target and should be attempted — but if the
session runs long, landing all three of `wifi_status`/`udp_send`/
`udp_receive` cleanly and leaving the remaining three as an explicit,
flagged follow-up (not a silent scope cut) satisfies Mike's stated bar.
Say so plainly in whatever gets handed back, the same way the UDP/TCP
batch's own briefing left TCP send/listen-receive as an explicit
follow-up rather than forcing everything into one sitting.

Beyond that: `./node_modules/.bin/tsc --noEmit` clean (direct binary, not
`npx` — see `CLAUDE.md`'s stray-`.js` note, and check for stray compiled
`.js` before trusting any test/tsc run either way), off-device tests
updated for every node type whose properties/ports changed
(`editor/test/node-*.test.ts`), a real browser pass (Mike's own hands-on
check, same as every prior canvas-wiring session) confirming the dropdown/
pencil/add-new widget actually works, not just compiles.

## Worth flagging explicitly, not resolving silently

- **The two "config node" ideas, disambiguated above** — don't let the
  design doc's original per-device-override framing leak into this
  session's data model. That's explicitly not what's being built now.
- **Whether a `wifiConfigId` reference is mandatory or stays optional**
  for the four non-MQTT node types (recommended: optional, see above) is
  a real behavior decision, not a default to sleepwalk into.
- **The second config type (`mqtt_broker`) is optional for this session**
  — don't let it displace the SSID fix if time runs short.
- **Config objects live in a genuinely new store**, not folded into the
  existing Rete-graph-walking code path — this is real net-new plumbing
  in `graph-adapter.ts`/`store.ts`/wherever `main.ts` currently loads and
  saves flow files, not "add a field or two."
- **Per-node-type port-type calls above are judgment calls**, deliberately
  left open rather than dictated, consistent with
  `wire-type-system-scoping.md`'s own governing call to ship loose and
  tighten later — don't spend session time trying to derive a provably
  "correct" answer for `http_request`'s response-body type; `string` or
  `any` are both defensible, pick one and move on.
- **`docs/working-notes/config-node-system-scoping.md` is superseded on
  the "build or not" question only** — its technical analysis (5-area
  breakdown, the palette prerequisite) is still accurate background, not
  wasted work.

## Housekeeping

Once this lands, `docs/thingstudio-design-doc.md` §6's "config nodes with
per-device override... deferred past v1" line and §10's v2-candidates
listing are both stale. Add a dated addendum (matching the doc's own
established style — see the 2026-08-17 addenda already in §6) noting the
promotion and pointing at this briefing, rather than silently rewriting
the original paragraph out from under its own history.

## Stop conditions

- The config-resolution mechanism turns out to need `compile.ts`'s DAG
  walk (reachability/cycle detection/source-sink rules) to know about
  configs at all, contradicting this briefing's "configs never enter
  `nodesById`" premise — stop and reconsider the data model rather than
  bolting a special case onto the walk.
- `PropertyPanel.vue`'s plain reactive-mutation model turns out not to
  support one config being edited from multiple nodes' panels cleanly
  (e.g. a rename needing every referencing node to visually update) —
  investigate before assuming; referencing configs by a stable ID that
  itself never changes may already sidestep this (only the config's own
  `properties` change, not its id), worth confirming rather than assuming.
- Any existing test suite needs modifying (standing condition every prior
  session in this repo has used).

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always** — standing sandbox
  bug, unchanged.
- **`npm test`/`vite build`/`npm run dev` still can't run from the
  sandbox** (Mac-only native bindings) — `tsc --noEmit` is the sandbox-
  side check, Mike's own build-and-run pass is the real one.
- **Check for stray compiled `.js` before trusting any test/tsc run** —
  `CLAUDE.md`'s own dedicated section on this, added the same session
  this bit twice.
- **Six node types is genuinely a lot of mechanical repetition** — budget
  session time for it; the "one proof case first" ordering above exists
  specifically to catch a data-model problem before it's been copy-pasted
  six times.
- **`test-flows/udp-echo-tester.flow.json` is real, queued, concrete
  validation** — Mike has a Pico W and an ESP32-C3 ready for it. Don't
  lose track of updating that file (and `test-flows/README.md`'s section
  on it) once the config-node mechanism exists.

## Not in scope for this chat

- Per-device config override / multi-flow-file template sharing — design
  doc §6's original vision, a plausible later layer, not this session's
  job.
- A general structural/object payload type — `wire-type-system-scoping.md`
  already covers why the fixed scalar type set stays as-is.
- `tcp_send`/`tcp_listen_receive` — already tracked separately
  (`docs/working-notes/mvp-feature-priorities.md` item 5 point 3's own
  scope-split note), unrelated to this session.
- Any node type beyond the six network types named above.
- Proactive (idle-closes) connection expiry, mDNS, on-device HTTP server,
  file ops — all resolved away or deferred elsewhere already.

## Git

Same standing rule as every other session: git writes (`add`/`commit`) go
to Mike as exact commands to run himself in a real Terminal, not run from
the sandbox. Read-only git commands are fine.
