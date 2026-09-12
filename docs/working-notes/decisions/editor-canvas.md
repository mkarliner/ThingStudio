# Decisions — Editor / canvas

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-16 — Rete migration: an adapter over `compiler/graph.ts`,
  not a rewrite of its accepted shape.** Keeps the tested compiler-input
  contract unchanged; `graph-adapter.ts` translates Rete's graph into the
  existing `{nodes, links}` shape. `rete-migration-decision.md`.
- **2026-08-16 — Hand-rolled palette drag-and-drop, not
  `rete-dock-plugin`.** Sub-decision 2, same note.
- **2026-08-16 — Wire-type system deliberately NOT bundled into the Rete
  migration** — kept as its own, immediately-following task so any
  regression stays attributable to one or the other. Sub-decision 3, same
  note.
- **2026-08-16 — Wire-type system: ship narrow and loose, tighten later
  if real use shows real pain.** Three-bucket coercion matrix (truthiness
  into `bool` always allowed; numeric widening allowed, narrowing
  refused; `bytes`↔`string` and `any`-into-concrete-types refused, need an
  explicit conversion node). No conversion node built yet — nothing in
  the current node set needs one. `wire-type-system-scoping.md`.
- **2026-08-14 — Compiler emits `async def`/`await` uniformly for every
  transform/sink node**, not an opt-in per-node flag or blocking sockets
  with no compiler change — avoids stalling the flow's one event loop
  during real network I/O, mechanical for every other node type.
  `mvp-validation-plan.md`, 2026-08-14 network-batch Results entry.
- **2026-08-17 — Debounce uses the cooldown algorithm** (ignore
  transitions within N ms of the last accepted one), not
  settle-and-confirm — the cheap version, per `CLAUDE.md`'s
  premature-optimization principle. `tier1-interrupt-node-implementation-briefing.md`.
- **2026-08-14 — Vendor `mqtt_as` (Peter Hinch, MIT), not `umqtt.simple`.**
  Non-blocking I/O and built-in WiFi/broker reconnection, worth the
  vendoring cost over the more commonly-cited blocking library.
  `mvp-validation-plan.md`, 2026-08-14 network-batch Results entry.
- **2026-09-04 — Stable node IDs: a node's own Rete canvas identity
  (`crypto.randomUUID()`) is now its compiler-facing/wire-protocol/
  flow-file id too, passed through everywhere unchanged instead of
  recomputed fresh every compile/save.** Raised by Mike asking why a
  console `NODE_ERROR`/`DEBUG` message couldn't be clicked to jump to its
  canvas node; investigating that surfaced that a prior session's claimed
  "node-ID refactor from numeric to UUID" (`continue-on-bigmac-brief.md`)
  had never actually landed (same audit that found inject's click-fire
  missing, `inject-click-fire-missing.md`) — so the reasoning for wanting
  it in the first place had been lost too. Reconstructed here: the old
  scheme (Litegraph-style auto-incrementing integers, recomputed fresh by
  `graph-adapter.ts`/`main.ts` on every compile/save, "no persistent
  numbering across calls" by original design) meant a node's id could
  silently point at the wrong live node once you edited the flow between
  a deploy and a device response, and gave Tier 2's planned flash-
  persisted per-node state nothing stable to key on. Mike's explicit
  choice (over "keep wire ids compact, renumber never" and "defer,
  console-mapping doesn't strictly need it"): full UUID identity
  end-to-end, since wire bandwidth isn't a real constraint here and it
  removes one prerequisite blocker for a persisted flow running
  standalone/disconnected from the editor (inject firing without a fresh
  redeploy after a reset) -- though that scenario also needs Tier 2's
  flash persistence itself, separately, still unbuilt.
  Turned out to need **zero wire-protocol changes** -- `messages.ts`/
  `codec.ts`/device-runtime's `_expect_string` already treated `nodeId` as
  an opaque string everywhere; the change is confined to
  `compiler/graph.ts`, `flow-file/flow-file.ts`, `app/rete/graph-
  adapter.ts` (which drops its old sequential-id-assignment entirely --
  now a pure pass-through, no more `reteIdByNodeId`/`nodeIdByReteId`
  mapping to compute or return), `app/main.ts`'s save/load/highlight code,
  `node-library/inject.ts` (had to stop deriving a Python *variable name*
  from the raw id -- a UUID's hyphens aren't valid in a Python identifier;
  fixed by sanitizing a separate `pyId` for that one use, keeping the raw
  id for the actual `runtime.register_trigger` wire value), and existing
  `test-flows/*.flow.json` sample files (migrated in place -- old integer
  ids fail the new "id must be a string" validation otherwise). Direct,
  load-bearing side effect: `main.ts`'s `highlightNode()` (console-message-
  to-canvas-node attribution, NODE_ERROR/DEBUG/compile-error) no longer
  needs any lookup table at all -- `editor.getNode(nodeId)` directly --
  which is also what makes a click-to-navigate console UI (the original
  ask) a small addition rather than a new mechanism. See
  `outstanding-items/console-node-id-mapping.md` for the corrected
  current-state audit (some of Phase 3's attribution work was already
  built, contrary to that file's prior claim) and what's still open
  (DEBUG-line attribution, the actual click UI) -- done as phase 2,
  deliberately separated from this id-stability change so `tsc`/`vitest`
  can gate each independently.

- **2026-09-04 — UI cleanup pass: panels collapse to a thin rail rather than fully disappearing, collapse state is session-only (not persisted), and the node palette gained a `group` dimension.** Three sub-decisions, all Mike's explicit call during this session:
  1. Property panel (auto, driven by node selection) and node palette (manual toggle) both collapse to a ~28px icon rail when out of the way, not zero width — keeps the panel's presence and re-open affordance visible rather than requiring the user to remember it exists. `PropertyPanel.vue`/`PaletteSidebar.vue`.
  2. Collapse/expand state resets to sensible defaults every page load rather than persisting via localStorage — simpler, no storage plumbing, revisit if Mike finds the reset annoying in practice.
  3. `palette.ts`'s `KindStyle` and `custom-node.ts`'s `CustomNodeDescriptor` both gained a `group` field (a plain string, not restricted to the three defaults) so the palette can render grouped sections (general/network/hardware for built-ins) with a custom node free to name its own new group instead of being forced into one of the three. Per-kind group assignment itself is a small judgment call documented in `palette.ts`'s own header, not indexed here (see this file's "What this list doesn't include").
  "Compiled source (preview)"/"Device console" became native `<details>`/`<summary>` disclosures instead — no JS collapse state needed for those two, source closed by default (rarely interesting), console open. `docs/ui-cleanup-and-collapsing-panels-brief.md`.

- **2026-09-06 — Hide `variable_get`/`variable_set` from the canvas again, same day they were given canvas presence; keep the function node's `flow.get`/`flow.set` as the working mechanism.** Given real Rete classes/palette entries/`PropertyPanel.vue` sections earlier the same session (`b046af1`), then walked through with Mike: the only clean no-code use case is decoupling a producer and a consumer on independent triggers sharing a value by name (e.g. a `timer`-fed `variable_set` and an `mqtt_subscribe`-fed `variable_get`) -- anything involving actual computation on the value needs a `function` node regardless, since the two nodes only copy `msg.payload` verbatim. Judged too narrow to keep visible as a dedicated pair without a real design behind it. Mike's reference point: Node-RED's own context system (node/flow/global scope, pluggable storage backends, a generic Change-node-style node rather than one narrow single-purpose pair per operation) -- `outstanding-items/context-model-node-red-style.md` carries the reference material forward. Reverted: `nodes.ts`'s `VariableGetNode`/`VariableSetNode` classes and their `palette.ts`/`PaletteSidebar.vue`/`PropertyPanel.vue`/`verify-flow-file.ts` wiring. **Not reverted:** `node-library/variable-get.ts`/`variable-set.ts` (codegen + `ports` declarations, unchanged), `registry.ts`'s registration of both (a flow file referencing either type still compiles), and the function node's `flow.get`/`flow.set` (reads/writes the exact same `_flow_vars` store) -- all fully working. `pwm_out`'s own canvas-presence closure, given in the same original commit, is unaffected.

- **2026-09-10 — Connection-status-indicator design: a new dedicated `NODE_STATUS` §13 message type, a small fixed `{nodeId, state, text?}` shape (not Node-RED's free-form fill/shape/text), every status cleared on redeploy, scoped to `wifi_status`/`mqtt_publish`/`mqtt_subscribe` only.** Four sub-decisions, all Mike's explicit call:
  1. New message type (type byte 11) rather than reusing the already-scaffolded-but-unused `VALUE_STREAM` -- a connection status isn't a port's value, and forcing it into `VALUE_STREAM`'s `(nodeId, portId, payload, timestampMs)` shape via a synthetic `portId` would misuse an already-defined contract meant for the still-unbuilt full live-value-streaming feature (`tier2-live-streaming-persistence.md`).
  2. `state` is a small fixed enum (`connected`/`disconnected`/`connecting`/`error`), not Node-RED's per-node free-form fill/shape/text -- the canvas owns one shared state-to-color mapping (`ThingstudioNode.vue`'s `STATUS_DOT_CLASS`) rather than pushing that choice onto every node type's own codegen. `text` is optional supplementary detail (e.g. an IP address), absent (not null) when a node type has none, matching this protocol's existing "missing key means not provided" convention.
  3. Every node's status resets to `null` ("never heard from") on every redeploy attempt, not just a successful one -- `main.ts`'s `clearNodeStatuses()`, called at the same point `clearNodeHighlights()` already resets error attribution, avoiding a stale "connected" surviving a flow that no longer wires that node up the same way, or reuses an id for a different node.
  4. Scoped to `wifi_status`/`mqtt_publish`/`mqtt_subscribe` for v1, not every node type generically -- `nodes.ts`'s `status`/`statusText` fields exist on every node class (mirroring `highlighted`'s own universal-but-not-always-populated precedent, so `ThingstudioNode.vue` renders generically with no per-kind branching), but only those three node-library codegens actually call the new `runtime.report_status()` device-side function; no other kind's fields are ever mutated from `null`. `http_request` explicitly excluded (not a persistent connection, per the original ask). Full write-up: `outstanding-items/node-status-indicators.md`.
