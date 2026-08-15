# poc-rete: Rete.js vs. Litegraph.js canvas-feel spike

Tests the four checkpoints in `docs/working-notes/rete-spike-briefing.md`
(itself following on from `architecture-review-briefing.md`'s "Editor/DAG
canvas library" entry, 2026-08-15): does Rete.js hold up, hands-on, against
the specific claims that made it look promising on paper — and does it
integrate cleanly enough to be a real alternative to the working, hardware-
proven Litegraph integration in `editor/`.

Same shape as `pocs/poc-c/`: throwaway, mocked, 5 fake node types (inject,
function, gpio out, mqtt out, debug), no compiler, no real `msg` envelope, no
device. **Not a decision, not a migration** — see the briefing's own framing.

## Running

```
cd pocs/poc-rete
npm ci          # installs the packages listed below; not run from the agent
                # sandbox, per CLAUDE.md's node_modules note — this repo only
                # ships package.json/package-lock.json, no node_modules
npm run dev     # Vite dev server
```

Toolbar has "+" buttons per node type, a dock (bottom-left of the canvas)
you can drag node previews out of, "Load example flow" (wires inject →
function → gpio out / mqtt out / debug, same fan-out shape as poc-c's
example), and "Clear canvas". Property panel and debug sidebar live in the
right-hand column.

`node verify-checkpoint1.mjs` re-runs checkpoint 1's headless proof against
the real installed `rete` package with zero extra dependencies (see below).

## Packages (flagged and approved per `CLAUDE.md` before install)

Real npm packages this time, not a single vendored file like Litegraph/
Drawflow — Rete ships as several small interdependent ESM packages with
real peer dependencies, which doesn't suit hand-vendoring a UMD build the
way poc-c's single-file libraries did. Installed with `npm install
--ignore-scripts`; versions pinned exactly in `package.json`/
`package-lock.json`.

| Package | Version | License | Role |
|---|---|---|---|
| rete | 2.0.6 | MIT | headless core — graph, nodes, sockets, connections, pipes |
| rete-area-plugin | 2.3.2 | MIT | canvas rendering surface (pan/zoom/drag) |
| rete-connection-plugin | 2.0.5 | MIT | wire drag gesture |
| rete-render-utils | 2.0.3 | MIT | shared rendering utilities (peer dep of the renderer) |
| rete-vue-plugin | 2.1.3 | MIT | Vue 3 node/control renderer — chosen over React/Svelte/Angular/Lit per Mike's steer, not because the others were worse |
| rete-dock-plugin | 2.0.4 | MIT | checkpoint 3 — palette drag-and-drop |
| vue | 3.5.41 | MIT | peer dep of rete-vue-plugin |

`rete`'s postinstall script (`postinstall.js`) was inspected before deciding
`--ignore-scripts` was safe to rely on: it's a `console.log` banner (a
"Stand with Ukraine" message plus a README pointer), no network calls, no
filesystem writes. Harmless either way, but confirmed rather than assumed.

**Maintenance data point worth stating precisely** rather than repeating the
briefing's looser framing ("v2.0.6, June 2026, commits into July"): the
registry's own `time` field puts `rete@2.0.6` at **2025-06-30**, over a year
before this spike, and it's still the `latest` dist-tag — no newer core
release exists. The plugin packages around it are genuinely current
(`rete-area-plugin` 2026-07-08, `rete-vue-plugin` 2026-07-10), so the honest
read is "stable core, actively maintained ecosystem," not "actively
maintained core" as originally stated — a real, if minor, correction.

Not a package: the drag-to-splice mechanism (`src/insert-node.ts`) — see its
own header comment for why, and read it before trusting the "close to free"
framing at face value.

## Checkpoint 1 — mid-drag type rejection

**Confirmed, mechanism-level, with a real headless test against the actual
installed `rete` package** (`verify-checkpoint1.mjs`, no dependencies beyond
`rete` itself — run it yourself, it prints `CHECKPOINT 1 PASSED`). Rete's
`editor.addPipe` intercepts every `connectioncreate` message; returning
nothing from the pipe stops it before `editor.addConnection()` ever adds the
connection to the graph — the identical call a real drag's drop gesture
makes internally. A rejected connection is therefore never added and never
rendered, architecturally the same class of behavior as Litegraph's
`isValidConnection` ("can't drop it"), not Drawflow's hand-rolled
"flash then rip out." `src/validation.ts` implements this against the exact
socket contract poc-c used (gpio out's input is bool-only; inject's output
socket type swaps live with its `payloadType` property, same rule poc-c's
Litegraph version enforced via `disconnectOutput`).

**What's confirmed vs. what isn't:** the interception point and the "never
rendered" claim are proven programmatically, against the real library, not
assumed from documentation prose. What the headless test *can't* show is the
actual real-browser drag feel — does the cursor give any "can't drop here"
affordance, or does the wire just silently fail to attach on release? The
docs don't specify this either. That's a genuine open detail, and per this
project's own established pattern (POC-C, POC-D), it's Mike's hands-on call
to make in his own browser, not something to assume from the pipe
architecture alone.

## Checkpoint 2 — drag-to-splice

**Implemented, partially verified, provenance caveat worth reading.** The
briefing asked for this via Rete's official "Insert node" example
(`retejs.org/examples/insert-node`, `rete-kit`-scaffolded `insertableNodes`
source). That source is generated on demand by `npx rete-kit app` selecting
the insert-node feature — it isn't a browsable file in `retejs/rete` or
`retejs/rete-kit`'s own repos, GitHub code search for `insertableNodes`
didn't resolve through the tools available in this environment, and running
`npx rete-kit app` itself is exactly the kind of un-pinned `npx` invocation
`CLAUDE.md`'s npm rule says not to run for a one-off. So `src/insert-node.ts`
is a **same-behavior reimplementation** written from the documented
description ("replaces the connection with two new connections when the
selected node is dropped onto the connection"), not a copy of the official
source — flagged plainly in the file's own header, not glossed over.

What it does: on the area's `nodedragged` signal (fires at drag end),
computes the dropped node's center and tests it against every existing
connection's source→target segment (point-to-segment distance, 40px
threshold); on a hit, checks both new connections would be type-valid via
the same `canCreateConnection` checkpoint 1 uses, then swaps one connection
for two. The pure geometry function is unit-tested (point-to-segment
distance: 0 at the wire, correct offset near it, correctly clamped past an
endpoint) — real math, not assumed correct. What's **not** verified
headlessly: the DOM-dependent half (`area.nodeViews.get(id).position`,
whether `nodedragged` actually fires the way the API docs describe under a
real pointer drag) — that needs a real browser, same caveat as checkpoint 1.

The underlying claim this checkpoint is actually testing — is splice-onto-
wire reachable in Rete without building a large amount of custom canvas
code — holds regardless of the provenance question: the whole mechanism is
~90 lines built entirely from public `rete`/`rete-area-plugin` API (hit-
testing, connection removal, two new connections), comparable in shape to
what the design doc's own "case-by-case cost" framing was weighing against
Litegraph's zero support for this at all.

## Checkpoint 3 — palette drag-and-drop (`dock-plugin`)

**Wired per the official guide, not independently re-verified beyond that.**
`src/editor-setup.ts` registers all 5 node factories with `dock.add()`
exactly per `retejs.org/docs/guides/dock-menu` — a draggable preview per
node type, instantiating a fresh node at the drop location. This is the one
checkpoint with no headless verification story worth attempting (it's
purely a DOM drag gesture); confirming it actually works is a real-browser
check, `npm run dev` and drag a preview onto the canvas.

## Checkpoint 4 — property sheet separate from the canvas

**Confirmed, and the most clear-cut win of the four.** `src/PropertyPanel.vue`
is a plain Vue component living in the app shell (`App.vue`'s right-hand
column), entirely outside Rete's own node-rendering — it reads a shared
`selectedNode` ref (`src/store.ts`) that `editor-setup.ts` sets from the
area's `nodepicked` signal, and mutations write straight back onto the
node's own `properties` object. No Rete-specific plumbing was needed beyond
that one `nodepicked` hook. This matches
`architecture-review-briefing.md`'s prediction exactly: "falls out of
component-based rendering for free," versus Litegraph's only precedent being
the one-off `function`-node code modal (`window.openCodeEditor`, built
specifically for that one node type) that would need generalizing. A side
effect worth naming: because properties don't need inline node-body widgets
at all here, every node in this build is already closer to Node-RED's actual
compact pill shape than poc-c's Litegraph nodes were — not a feature built
for this spike, just a consequence of where property editing lives.

## Also worth recording

- **Real bundle size.** `npm run build` (Vite, no sourcemaps, real minified
  output): **178.51 KB JS + 2.29 KB CSS ≈ 181 KB total** (54.95 KB JS
  gzipped) across core + area-plugin + connection-plugin + render-utils +
  vue-plugin + dock-plugin + Vue itself. That's **~63% smaller than
  Litegraph's vendored 491 KB** (poc-c's number) — a genuinely surprising
  result given Rete is split across more packages; Vue's own runtime is
  smaller than expected to matter here, and none of these packages carry
  much dead weight. (insert-node's splice logic is our own ~90 lines, not a
  package, so it doesn't add to this number, matching the briefing's own
  expectation.)
- **Multi-select.** Native, `AreaExtensions.selectableNodes` +
  `AreaExtensions.accumulateOnCtrl()` — two lines, no hand-rolling, same
  outcome as Litegraph (Drawflow, for reference, had none at all per poc-c).
  Wired in `editor-setup.ts`.
- **Multi-output routing gap — confirmed Thingstudio's own, not Rete's or
  Litegraph's.** Headless check: a plain `ClassicPreset.Node` with two
  independently-typed, independently-keyed named outputs
  (`addOutput("true", ...)`, `addOutput("false", ...)`) works with zero
  extra plumbing — `router.outputs` has both keys, both connectable
  independently. This closes the question `architecture-review-briefing.md`
  flagged as a suspicion rather than leaving it open: the current
  single-output limitation (`NodeDefinition` has one output,
  `GraphLink.origin_slot` always `0`) is Thingstudio's own compiler/graph-
  model choice, not something either canvas library forces.
- **No dataflow engine included.** Unlike Litegraph, where `graph.start()` +
  `onExecute` drove poc-c's mock propagation for free, Rete's core ships no
  execution engine at all — that's a separate package (`rete-engine`, not
  installed here since none of the four checkpoints needed it). This build's
  "live" propagation (`editor-setup.ts`'s `propagate()`) is hand-rolled,
  walking outgoing connections on each inject fire — structurally the same
  shortcut poc-c's Drawflow build needed, not the zero-setup Litegraph had.
  Worth weighing against the bundle-size win above: a real build would
  eventually need `rete-engine` (or the same hand-rolled approach, indefinitely) for
  actual live-value propagation, which isn't reflected in the bundle number
  above.

## Verdict

On the four checkpoints the briefing set out to check, Rete holds up on
three cleanly (type rejection at the right architectural point, multi-output
sockets work natively, and the property panel is a genuine, low-effort win)
and one with a real caveat (drag-to-splice works and is cheap to build, but
this build's version is a documented reimplementation, not the official
example source, since that source wasn't retrievable in this environment).
Bundle size, multi-select, and the multi-output question all resolved in
Rete's favor or neutrally. The real cost the briefing asked to weigh
honestly — redoing a working, hardware-proven Litegraph integration, several
real npm packages instead of one vendored file, ongoing dependency surface —
is unchanged by any of this and isn't something a spike like this can net
against the wins on its own.

**Not a decision.** Per the briefing's own framing, this is where the paper
evaluation gets checked hands-on — the qualitative half ("does it feel at
least as good to build a small flow here as in Node-RED / the current
Litegraph editor") is inherently Mike's call in his own browser, same as
poc-c's own verdict noted for itself. If this is compelling enough to
warrant an actual migration decision, that's a separate, explicit
conversation — not something to slide into from this spike.
