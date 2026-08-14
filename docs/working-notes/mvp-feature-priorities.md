# Working note: MVP feature list, prioritized

Status: working note, 2026-08-11. Task 1 from `mvp-planning-briefing.md`.
Builds on `../thingstudio-design-doc.md` §10's rough v1 sketch, §15.5's
pipeline-proven-vs-v1-done gap list, and this session's §11 resolutions
(see design doc for the resolved text). Tiered by dependency and by how
central each piece is to §1's actual bet, not just copied from §10's list
in its original order. See `validation/mvp-validation-plan.md`
for how each tier actually gets confirmed done, not just built.

## Already decided, no work required

This session closed six of §11's open questions in a way that shrinks v1
scope rather than adding to it — worth stating plainly so they don't
resurface as work items: no CircuitPython spike (MicroPython, closed), no
function-node sandboxing, no simulation mode (out of the project entirely,
not just deferred), no node distribution/versioning system (node set ships
fixed inside the runtime image), no OTA mechanism (USB reflash only).
Generated code is human-readable Python (already the natural choice, just
now explicit).

## Tier 0 — foundations (block everything else; do first)

Everything here is "the real thing" replacing a POC shortcut. Building any
of the Tier 1 node set against the old shortcuts means redoing it once
these land, so this has to come first even though it produces nothing
end-user-visible on its own.

- **General graph → Python compiler (§6).** Replaces POC-D's
  `compiler.js`, which only knows exactly one hardcoded 3-node shape.
  Needs: a topological walk over arbitrary graphs, and a per-node-type
  codegen registry instead of one function that already knows every node
  type by name — the contract sketched in `node-definition-model.md`
  (type ID, ports, properties, a codegen hook emitting one of the three
  patterns already demonstrated: native-primitive call, folded-into-
  control-flow, or verbatim user code). Cheapest validation step: port
  POC-D's exact `inject → function → gpio_out` flow onto the new general
  compiler first, as a regression check, before adding new node types.
- **Real `msg` envelope + type system (§6).** The typed `payload`
  (`int`/`number`/`bool`/`string`/`bytes`/`any`), `topic`, and extra
  properties, plus wire-connect-time type checking in the editor. §6 is
  explicit this isn't a v1-only shortcut — every node built after this
  point depends on the envelope shape, and changing it later breaks every
  node already written. Has to be right before Tier 1 starts, not after.
- **Real wire protocol (§13).** Length-prefixed, CBOR-framed messages
  (`HELLO`, `DEPLOY`, `DEPLOY_ACK`/`DEPLOY_ERROR`, `VALUE_STREAM`,
  `NODE_ERROR`, `STATE_READ`/`STATE_WRITE`), replacing POC-A/D's ad hoc
  text/base64 protocol. `HELLO`'s major.minor.patch version check should
  gate whether the editor even attempts a `DEPLOY`, per §5/§13's own
  reasoning about avoiding a version-mismatch DEPLOY the device can't
  parse.
- **Fault isolation, both halves (§5).** Per-task exception boundary for
  deployed flow coroutines (catch at task completion, report via
  `NODE_ERROR`, rest of flow keeps running) — and, separately, the
  listener/transport task hardening POC-D's hardware run actually forced:
  the dispatch loop must never die from an unhandled exception, every
  blocking read must be time-bounded, and no protocol design should assume
  a specific-byte-count read (`read(n)`/`readexactly(n)`) is safe on an
  arbitrary port — verify per-port, ride binary payloads on `readline()`
  the way POC-D's fix does unless a given port proves otherwise. This is
  called out in the design doc as something to build in from day one, not
  bolt on later, precisely because POC-D hit it by surprise on real
  hardware after extensive off-device testing missed it.
- **Reserve an OTA-capable partition table on the ESP32 build.** Not
  implementing OTA in v1 (§11 — USB reflash only) is fine, but the
  partition layout is a one-way door: ESP-IDF's OTA mechanism needs two
  OTA-capable app partitions (`ota_0`/`ota_1` plus OTA-data) laid out from
  the very first flash. Shipping v1 without them means every device
  already in the field needs a manual USB reflash later just to become
  OTA-capable, before OTA itself is even turned on. Laying out OTA-capable
  partitions now is a build-config choice, not new engineering — cheap
  insurance against a future stranding cost. RP2040/RP2350 has no
  equivalent standard scheme in the Pico SDK, so this hedge is ESP32-only;
  Pico-family OTA remains a separate, harder problem for whenever it's
  scoped.

## Tier 1 — the v1 node set (§6/§10), built on Tier 0

Sequenced by risk and dependency, not just copied from §6's list order:

1. **Software-only nodes** — boolean/arithmetic logic, comparators/
   thresholds, variable get/set, inject, debug, the function node. No
   physical I/O, so they're the cheapest way to exercise the new general
   compiler against real variety (multiple types, non-trivial wiring)
   before anything hardware-dependent is in the mix. **Done as of
   2026-08-13** — inject/function were already ported from POC-D; boolean,
   arithmetic, comparator, variable get/set, and debug landed this
   session (`docs/working-notes/validation/mvp-validation-plan.md`'s
   dated Results entry). Variable get/set's state is in-RAM only for
   now, not yet the flash-backed store §5 describes — that's still Tier
   2's unbuilt "flow persistence" work, noted in each node file's own
   header rather than silently assumed done.
2. **GPIO/timers** — GPIO in/out + PWM, timers/intervals. Real I/O, but on
   exactly the mechanism POC-A/D already proved reliable on hardware.
   **Off-device done as of 2026-08-14** (`mvp-validation-plan.md`'s dated
   Results entry) — gpio_in, pwm_out, timer landed (gpio_out was already
   in from POC-D). **Hardware pass through the witness rig still
   pending** — this section's own validation bar treats that as
   non-negotiable for GPIO/PWM/timer nodes, not optional polish.
3. **I2C/SPI sensor nodes** — a handful of common sensors, each wrapping
   an existing MicroPython driver per §7. Gated on having the actual
   sensor hardware on hand for each one, not just a codegen exercise.
4. **Network nodes** — WiFi status/HTTP request, then MQTT publish/
   subscribe. Last within this tier since they carry the most external
   moving parts (radio bring-up, broker availability) relative to the
   node-authoring work itself. **Off-device done as of 2026-08-14**
   (`mvp-validation-plan.md`'s dated Results entry) — wifi_status,
   http_request, mqtt_publish, mqtt_subscribe all landed, tested against
   pymock and (http_request) a real local HTTP server. Vendored `mqtt_as`
   (MIT) for the MQTT nodes rather than hand-rolling or using blocking
   `umqtt.simple` — see `device-runtime/src/vendor/mqtt_as/README.md`.
   Required a real compiler change: transform/sink codegen now compiles to
   `async def`/`await` (was synchronous `def`) so http_request/mqtt_publish
   can await real non-blocking I/O without stalling the flow's one event
   loop — mechanical for every other node type, see `compile.ts`'s own
   header comment. **Hardware pass against a real local MQTT
   broker/HTTP test server still pending** — this section's own validation
   bar treats that as non-negotiable for network nodes, not optional
   polish; nothing here has touched a real device or a real broker yet.

## Tier 2 — the "feels like Node-RED" layer

This is half of §1's actual bet, not polish — worth pulling forward rather
than letting it trail behind finishing every node type in Tier 1. Live
values in particular can and should start as soon as Tier 0's protocol and
a handful of Tier 1 nodes exist, in parallel with the rest of Tier 1, not
strictly after it.

- **Live value streaming (§5/§13 `VALUE_STREAM`).** Throttled sampling of
  tagged node outputs back over the transport so wires light up with real
  data in the editor. POC-D explicitly deferred this ("success is 'it runs
  on-device,' not 'the editor shows live values'") — reasonable for a
  pipeline spike, not reasonable to defer to the end of v1.
- **Flow persistence (§5).** Two distinct stores: the last-deployed flow's
  bytecode/static data in flash (resumes after power loss with no editor
  attached — matches MicroBlocks' baseline behavior), and a separate
  flash-backed key/value store for runtime state (variable values,
  calibration constants), keyed by node ID, surviving redeploy by default
  with a per-node opt-out.

## Tier 3 — product shell

Makes this an actual tool someone can use end to end, versus a proven
pipeline driven by hardcoded buttons.

- **Git-friendly flow file format (§6).** The `nodes`/`edges` vs. `layout`
  split, deterministic serialization (stable ordering, zero-diff on an
  untouched re-save). Not built in any POC yet.
- **File save/load (§4).** File System Access API where available
  (Chrome/Edge), manual export/import fallback elsewhere (Safari/Firefox).
- **Real editor shell.** Connect + `HELLO` handshake, a Deploy flow that
  runs the pre-flight version/space check before sending `DEPLOY`, and the
  status/log/inspector panel from §8 — connection state, per-node errors
  surfaced from `NODE_ERROR`, live values from `VALUE_STREAM`. Replaces
  POC-D's "couple hardcoded buttons," which was correctly out of scope for
  a pipeline spike but isn't a v1 deliverable as-is.
  - 2026-08-14: a first **bare-minimum** pass now exists (`editor/index.html`
    + `editor/src/app/`) — real canvas (Litegraph, vendored into
    `editor/public/vendor/`), four real node types (inject/function/debug/
    gpio_out) wired to the actual node-library/compiler registry (not a
    hardcoded shape), real mpy-cross WASM cross-compile, real WebSerial
    `DEPLOY` via `transport.ts`. Deliberately still missing, by explicit
    scope choice for this first hands-on pass: the `HELLO`/version
    pre-flight gate (`version.ts` exists, not wired in — **landed, see
    the 2026-08-14 later-session bullet below**), file save/load, the
    git-friendly flow file format, and any inspector polish beyond a
    plain scrolling device console. This entry stays open until those land.
  - 2026-08-14 (same session, later): first real Connect/Deploy round-trip
    confirmed by hand against real hardware — inject → gpio_out (GPIO12,
    the onboard LED) deployed and ran correctly, including a fan-out case
    (inject wired to both gpio_out AND debug simultaneously). This was the
    open item this bare-minimum pass existed to prove; it's now proven.
    Still doesn't close this entry — HELLO/version gate, save/load, flow
    file format, inspector polish are all still missing, per above.
  - 2026-08-14 (same session, cosmetic question raised, not built):
    node-red-style compact node appearance (fixed-height pill shape, icon
    + label only, no inline config — properties edited in a separate
    panel/dialog instead) was asked about. Port placement itself needs no
    work — Litegraph's default `addInput`/`addOutput` rendering already
    puts slots as edge-of-box dots, left for inputs/right for outputs,
    matching Node-RED. The node *shape* is the real gap: current nodes
    (`editor/src/app/nodes.ts`) are tall cards with config as inline
    `addWidget` rows (`inject`'s type/value/repeat, `gpio_out`'s pin).
    Vendored Litegraph (`editor/public/vendor/litegraph`) does support
    what a compact look needs — `ROUND_SHAPE`/`CARD_SHAPE` node shapes,
    `onDrawForeground`/`onDrawBackground` override hooks — and the
    "config lives outside the node body" pattern already exists once,
    for `function`'s "edit code…" button opening `#code-modal`
    (`main.ts`). Making all four node types look like Node-RED would mean
    generalizing that one-off modal into a shared properties panel and
    stripping the inline widgets from `inject`/`gpio_out`. Contained to
    `nodes.ts` + a modest `main.ts` addition, no compiler/protocol
    changes. Deferred — cosmetic, not blocking the hardware-proof work
    above.
  - 2026-08-14 (same session, real gap hit hands-on, not built): a
    `function` node with invalid MicroPython produces an `mpy-cross`
    `SyntaxError` with only a raw line number in the generated source
    (`main.ts`'s device console just prints `mpy-cross`'s stderr
    verbatim) — nothing maps that back to which node on the canvas is
    actually broken. Fine with one function node, unworkable once a flow
    has several — this is squarely the "error attribution" case
    `CLAUDE.md`'s fault-handling priority already names as load-bearing,
    not polish, so it's worth taking seriously rather than filing as
    generic UI polish.
    - Ruled out: an embedded local variable (e.g. `_node_id = "42"`
      inside the generated function body) — useless, since a
      `SyntaxError` is a parse-time failure and no code ever executes to
      bind it; and it'd be redundant for real runtime errors anyway,
      since `nodeCallWithFaultBoundary` (`compile.ts`) already attributes
      those correctly via a literal node ID at the *call site*
      (`raise runtime.NodeError("${nodeId}", _e)`), independent of
      anything inside the function.
    - Ruled out as the attribution mechanism (though still worth adding
      for readability): a `# node:<id>` comment above each generated
      `async def`, resolved by scanning backward from the error line for
      the nearest marker. Works, but is at the mercy of the function
      node's body being *verbatim user-typed MicroPython* dropped in
      unmodified — a user comment that happens to collide with the
      marker format could misattribute. Low-probability, but avoidable.
    - Preferred approach: have `compile()` return a structured
      `{ nodeId, startLine, endLine }[]` table computed while it
      assembles the source, rather than parsed back out of generated
      text at read time. Cheap to add — `compile.ts`'s
      `transformCodegen`/`sinkCodegen` maps are already keyed by
      `node.id` in the same order `functionDefs` is built, so tracking
      cumulative line counts alongside that costs almost nothing, and
      it's precise regardless of what a user types inside their own
      function body (no text-parsing, no collision risk). Matches this
      codebase's existing preference for typed contracts over
      string-sniffing (the same reasoning `node-definition.ts`'s registry
      replaced POC-D's hardcoded compiler for). The `# node:<id>` comment
      is still worth emitting too, purely as human-readable documentation
      in the "Compiled source" preview panel — just not relied on for the
      actual attribution logic.
    - Once the line→node mapping exists, `main.ts` would parse
      `mpy-cross`'s `File "/in.py", line N` out of its stderr, look up the
      owning node ID, and flag that node on the canvas — Litegraph nodes
      already support recoloring at runtime (`node.color`/`node.bgcolor`,
      same mechanism each node type's default color already uses in
      `nodes.ts`), so highlighting it red is a small addition once the ID
      is known.
    - Not started.
  - 2026-08-14 (later session, editor-hands-on continuation): `HELLO`/
    version pre-flight gate wired in (`main.ts`), closing that item from
    this bullet's "deliberately still missing" list above. Real gap hit
    while wiring it: `device-runtime/src/listener.py` sends `HELLO`
    exactly once, from a task spawned at listener *boot*, with no
    periodic resend and nothing that re-triggers it on a new client
    connection — opening a WebSerial port doesn't reset the board, so a
    device already running when Connect fires (the normal case, since a
    deployed flow persists across power cycles per §5) has no fresh
    `HELLO` for that connection to see; only a physical reset produces
    one. Decided (Mike, asked directly rather than assumed): editor-only
    fix, not a device-runtime protocol change. The gate is soft on
    absence, hard on mismatch — no `HELLO` seen yet allows Deploy with a
    visible "unverified" warning (`main.ts` waits `HELLO_WAIT_MS=3000`ms
    after Connect before logging that warning, then re-warns on every
    Deploy attempt made without one), while a real `HELLO` reporting an
    incompatible major version blocks Deploy outright before any compile
    work runs, via the already-built `decideDeploy` (`version.ts`,
    unchanged — this session only wired its existing, already-tested
    logic in). A real fix — an explicit `HELLO_REQUEST` message the
    editor could send on connect instead of depending on a maybe-reset —
    would touch `messages.ts`/`messages.py`/`listener.py` and need a
    hardware pass; flagged here, deliberately not built this session.
    `tsc --noEmit` clean; hands-on confirmation (does the warning/block
    actually fire correctly against real hardware, both with and without
    a reset after Connect) still Mike's to do, same as this session's
    other device-touching changes.

## Explicitly still out of v1 (§10, unchanged by this session)

Incremental/diffed redeploy (full-flow redeploy only), BLE and WiFi
transport, config nodes with per-device override, a catch/error node, Home
Assistant auto-discovery, a self-hosted dashboard, multi-device flows, a
companion server. All v2/v3 per §10's existing phasing — nothing here
changes that.

Added 2026-08-13, flagged during Tier 1 node-set planning rather than
built: **stateful nodes and cross-message synchronization** — a
Node-RED-style `join` node that buffers messages arriving on separate
wires and fires once N of them have arrived (or once a
correlating key's whole set has), and the broader class of node holding
state *across separate trigger events within one deployed flow's
lifetime* (not to be confused with §5's already-real flash-backed
variable store, which persists a single node's value across redeploys
and power cycles, keyed by node ID -- this is a different thing: e.g. "AND
of live wire A's last value and live wire B's last value," or "don't fire
until both a motion sensor and a door sensor have each reported once").
Real fan-in (this session, see `node-definition-model.md`) makes the
wiring shape expressible -- multiple upstream nodes CAN already feed one
downstream node -- but the downstream node re-firing once per independent
arrival, with no memory of what arrived before, is Node-RED's own basic
fan-in semantics, not a join. A real join/synchronization primitive is
its own design problem (buffering semantics, timeout/partial-set
behavior, what "N" means when wiring is edited) worth scoping properly
whenever it's picked up, not bolted onto a single node type ad hoc. Not
blocking Tier 1's software-only node batch (boolean/arithmetic/
comparator/variable-get-set/debug all ship stateless for now), but worth
tracking here so it doesn't get rediscovered from scratch later.

**Addendum, 2026-08-14 (editor hands-on session):** a concrete, simpler
motivating case for part of the gap above, distinct from the join/
synchronization problem — worth tracking separately so the two don't get
conflated into one harder design than either actually is. Hit hands-on:
"why doesn't an `inject` → invert-payload `function` → `gpio_out` flow
flash the LED" — it can't, because `inject` rebuilds the same literal
payload from scratch every tick, so a downstream function always inverts
the same starting value to the same result. The `timer` node (added this
session) works around it for that one case (a real incrementing counter,
`global`-scoped per node instance), but that's a single hardcoded
mechanism baked into one node type, not something a flow author can reach
for generally. Node-RED's answer to this whole class of problem is
[context](https://nodered.org/docs/user-guide/context): `context`/`flow`/
`global` objects with `get(key)`/`set(key, value)`, available directly
inside a Function node's own code, at three scopes (node-private,
flow-wide, global-across-flows), backed by a pluggable store (in-memory
by default, optional persistence). Worth building something shaped like
that here rather than one-off state hacks per node type.

This is NOT starting from nothing: `variable_get`/`variable_set`
(`node-library/variable-{get,set}.ts`) already implement almost exactly
Node-RED's *flow* scope — a single flow-wide in-RAM dict (`_flow_vars`),
keyed by a user-chosen name string, shared between a set node and a get
node anywhere in the flow. What's missing against the Node-RED shape:
(1) no *node* scope (state private to one node instance, e.g. a counter
a single function node keeps entirely to itself, no risk of a name
collision with an unrelated node elsewhere in the flow); (2) no way for a
`function` node's own verbatim code to reach the store directly —
today only the dedicated `variable_get`/`variable_set` node types touch
`_flow_vars` at all, `function`'s generated code has no `context`/`flow`
object available, so the flashing-LED case can't be solved inside a
single function node the way a real Node-RED user would reach for
(`flow.get('count')`/`flow.set('count', ...)` directly in Function node
code) without wiring three separate nodes (get → function → set) around
it. Closing that second gap is probably the smaller, higher-value half:
expose `context`/`flow` objects with `get`/`set` methods to `function`'s
generated code, backed by the same dict-per-scope mechanism
`variable-set.ts` already established, plus a second node-instance-keyed
dict for `context` scope. `global` scope is moot for now (§6: single flow
per device in v1, nothing to be global *across*), so this really only
needs two scopes to start, not three.

Relationship to already-tracked work, so this doesn't get scoped as
bigger than it is: the *persistence* half (surviving redeploy/power
cycle) is already Tier 2's flash-backed state store (§5), unchanged by
this — Node-RED's own context is in-memory-by-default with optional
pluggable persistence too, same shape, not a new idea. The *buffering/
timeout/N-way* half (the join node, "wait until both branches have each
fired once") is the harder, separate problem the entry above already
flags — plain `get`/`set` context access doesn't need any of that
machinery, it's just "read a value, write a value, the flow author's
code decides when and why." Not started, not scoped as a real design
(exact API shape inside generated MicroPython, how node-scope keys avoid
colliding with `variable_get`/`variable_set`'s flow-scope dict, whether
`variable_get`/`variable_set` become redundant once `function` can do
this directly or stay as a convenience GUI-only path the way Node-RED
keeps both its Change node UI and raw Function-node context access).

**Resolved 2026-08-14 (later the same session).** The smaller,
higher-value half above is built: `function-node.ts` now exposes
`context` (node-instance-private, a fresh dict per instance keyed via
`ctx.uniqueName`, same collision-avoidance mechanism `timer.ts` already
uses) and `flow` (flow-wide, backed by the exact same `_flow_vars` dict
`variable_get`/`variable_set` read/write — not a second store, so a
function node's `flow.get('x')`/`flow.set('x', ...)` interoperates
directly with a `variable_get`/`variable_set` node named `"x"`). Both
exposed as a small shared `_Store` class (`get`/`set`, matching
Node-RED's own API shape), deduped once regardless of function-node
count, bound as plain local names at the top of the generated function
body (no `global` needed — nothing rebinds the module-level object,
only calls methods on it). Confirmed hands-on: `inject` → `function`
(`context.set('on', not context.get('on', False))`) → `gpio_out` flashes
the LED on repeated manual redeploys, the original motivating case,
without `timer`'s workaround. Tests: `editor/test/node-function.test.ts`
(context persistence across repeated calls, per-instance isolation,
both directions of `flow`/variable-node interop) — `tsc --noEmit` clean,
`npm test` still Mike's to run per `CLAUDE.md`'s sandbox/vitest note.
`variable_get`/`variable_set` were left as-is, not redesigned — still a
convenience GUI-only path onto the same flow-scope dict, per the "stay
as a convenience" option flagged above; revisit only if that turns out
wrong in practice. The API-shape open questions from the paragraph above
are answered by the actual implementation now, not just proposed.

Added 2026-08-14, flagged during network-node review rather than built:
**connection-state gate/router nodes.** Raised as a possible answer to
"how does a flow author explicitly react to WiFi/MQTT not being ready
yet," distinct from the lazy-connect-and-lock handling already built into
`http_request`/`mqtt_publish`/`mqtt_subscribe` (`mqtt-shared.ts`'s
`mqttEnsureConnectedSnippet`, verified under real concurrent contention --
see `mvp-validation-plan.md`'s 2026-08-14 addendum) -- that mechanism
makes network nodes correct with nothing extra wired, this is about
giving a flow author visibility/control on top of that, not a
prerequisite for it. Two shapes, different cost:

- **Single-output pass-or-drop gate** (`wifi_status`/`mqtt_status` as a
  *transform* rather than only a source): checks `.isconnected()` and
  either returns `msg` unchanged or `None` to drop it. Effectively free --
  `compile.ts` already supports a transform returning `None` to stop
  propagation (the function node's `return None` case, exercised by
  `compiler.general.test.ts`), so this needs no compiler change, just a
  new node (or a second codegen mode on the existing `wifi_status` node)
  and its off-device tests.
- **Two-output status router** (route to one of two wires depending on
  connected/not-connected, rather than pass-or-drop on one wire): a
  materially bigger feature, not a bigger version of the gate above.
  Nothing in the current model supports it -- every `NodeDefinition`
  produces exactly one output; fan-out (already built, see the DAG work
  above) *broadcasts* the same message to every wire a node's output
  feeds, it doesn't *route* to a specific wire based on a condition.
  `node-definition.ts`'s `SourceCodegenResult`/`TransformCodegenResult`/
  `SinkCodegenResult` and the graph model (`graph.ts`'s `GraphLink`,
  which already carries an `origin_slot` -- currently always `0`) would
  need a real multi-output-port contract. Worth designing as a generic
  switch/router primitive (Node-RED's own `switch` node is the obvious
  precedent) rather than something wifi/mqtt-specific, since "route by a
  condition" is a need that'll recur (comparator results, HTTP status
  codes, anything) -- building a one-off wifi/mqtt version now would
  likely need redoing once a real router exists.

Neither started. Listed here for prioritization, not scoped as a design
yet.

**Refinement, same day:** the motivating use case is a stream of
hardware-event messages (a GPIO/timer/sensor source firing repeatedly)
with no network connection available yet -- and "drop" is only one of
three real policies worth wanting for what happens to a message that
arrives while disconnected:

- **Drop** -- the pass-or-drop gate above covers this exactly, as
  described.
- **Keep only the latest** -- coalesce to one slot: each new message
  overwrites whatever's held, and the held value gets sent once the
  connection returns. Cheap, fixed (one message's worth) memory --
  the natural default for something like "publish current sensor
  reading," where only the most recent value matters.
- **Save all, bounded** -- queue up to N messages while disconnected,
  flush in order once reconnected, drop-oldest (not drop-newest, not an
  unbounded grow) once full. The vendored `mqtt_as`'s own `MsgQueue`
  (`device-runtime/src/vendor/mqtt_as/`) already implements exactly this
  eviction shape for *inbound* subscribed messages waiting to be read --
  a validated precedent for the bounded-ring-buffer pattern, though it
  isn't directly reusable here: that queue holds messages arriving from
  the broker waiting to be consumed by our code, this would hold
  outgoing messages waiting to be sent -- same shape of solution, not the
  same data path.

Both "latest" and "save all" are a bigger step than the plain gate: a
gate only needs to look at current status on each incoming message: pass
or drop, no memory between calls, so a `msg -> msg|None` transform already
covers it. Buffering to replay later needs actual state that outlives a
single message -- which node-instance-scoped state under redeploy do we
even have today? None of the flash-backed per-node state §5 describes
covers "arbitrary in-RAM buffer, cleared or not on redeploy," so this is
a real *instance* of the "stateful nodes and cross-message
synchronization" gap already flagged above (2026-08-13), not a separate
problem -- worth designing together with a join/synchronization node
rather than bolted onto a wifi/mqtt-specific node ad hoc, per that
entry's own reasoning. One wrinkle specific to this use case, beyond
plain state-holding: something has to actually notice the connection
coming back and trigger a flush -- none of the three sources currently
in the node set (polling, a repeat interval, an inbound wire) obviously
fits "fire once, exactly when a status transition happens," so that's
worth treating as an open sub-question of its own, not assumed solved by
"just add a buffer."

## One sequencing call worth flagging rather than assuming

Tier 1 and Tier 2 are written as separate tiers for clarity, but they
shouldn't be strictly serial in practice — live value streaming only needs
Tier 0 plus a handful of working node types to start being useful, and
building it early gives every subsequent Tier 1 node type a working
inspector to validate against as it's added, rather than validating nodes
blind until Tier 2 finally lands.
