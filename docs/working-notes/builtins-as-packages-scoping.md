# Built-ins as packages (roadmap phase 4, location parity) — scoping

Status: **decided 2026-10-15 (Mike): option A** — see "Decision" below. Part of the node-format-parity work;
see `decisions/node-authoring.md` (2026-10-15) for the goal and security policy, and `node-format-parity-briefing.md`
for the roadmap. Read those first.

## 0. Decision (2026-10-15)

Mike chose **A: built-ins keep the TypeScript codegen; a build step generates each built-in's package from it**.
One load path (a core packages folder ahead of the user's); the generated `.node.py` is not committed; the
residue (`function`, `gui_*`) stays built-in-only; the marketplace is deferred. Full rationale in
`decisions/node-authoring.md` (2026-10-15, "phase 4 model decided"). The rest of this note is the scoping that
led to it; §8's questions are answered below, and the first work item is §9.

## 1. The decision

The end state (briefing, "The target"): a node is one package — a descriptor + device-side Python — loaded from a
folder; core nodes ship in a folder ahead of the user's, same format. Phase 4 is what turns that from a parity test
into the actual distribution and load model. Two questions, both one-way doors:

1. **How is a built-in authored and shipped?**
   - **A. Generate from the existing TypeScript codegen.** The built-in stays in `editor/src/node-library/*.ts`; a
     build step emits its package (`<name>.node.json` + `<name>.node.py`). The TS codegen is demoted to a
     build-time generator.
   - **B. Re-author as hand-written Python packages.** Drop the TS codegen; write each built-in's behavior as a
     `.node.py`, its compile-time decisions as descriptor data.
2. **What is the load model?** A core packages folder placed ahead of `custom_node_dirs`, one registry merge, one
   compile path — so a built-in and a user package are indistinguishable at load/compile time.

## 2. The goal that decides it (2026-10-15)

Maximize how much can be added **without changing the core codebase** (extensions as packages → a marketplace, not
PRs), with the user's computer sacrosanct — the editor never executes package code. Both options are **data-only for
external authors**; neither opens codegen to the community (that path is explicitly not taken — it is editor-executed
stranger code; `decisions/node-authoring.md`). So the choice here is only about *how the core's own nodes are
authored and shipped*, not about the extension surface.

## 3. The trade-off

Both keep the trust boundary identical (generation happens at build time, never in the browser; Python runs on the
device after an explicit deploy).

| | A — generate from TS | B — re-author in Python |
|---|---|---|
| Effort now | Low incremental; ~40 files kept | High; ~40 rewrites, several complex |
| Hardware-validated behavior | Preserved exactly (the Python that survived the display/mqtt bugs) | Regenerated; every quirk re-verified on hardware |
| Flow-dependent codegen (graph, configs, target) | Must still move into descriptor data, or it is not really a package | Becomes descriptor data by construction — but needs a data form for imperative codegen |
| Proves the format is complete | No — only the flattened subset; a codegen producer can stay latent in the build | Yes — the reviewer's "no loss" test is exercised |
| Copy-a-built-in-as-a-starting-point | Emitted Python is machine-shaped (clunkier to read) | Natural Python, written to be read |
| Reversibility | Reversible | One-way toward the pure format |

The catch in A, stated plainly: much built-in codegen is *flow-dependent* — it reads the graph (`gui_*`,
`wifi_status`), the target, configs. A static `.node.py` cannot capture that, so A still needs phase-2/3 work to
move those decisions into descriptor data for the nodes it flattens. A does not dodge parity; it keeps TS as the
authoring layer and generates the artifact. It also never proves the format for the residue.

## 4. Recommendation — A, honest about what it proves

Use A as the mechanism, extend the format (phases 2/3) driven by converting real built-ins, and accept a documented
**residue** that stays built-in-only: `function` (its body is verbatim user code) and `gui_*` (needs the `screens`
layout model, out of node-format scope by architecture — `node-context-parity-scoping.md` §4(g)). This gets the
cheap path *and* proves the format for everything except cases we have deliberately excluded. B would prove the
residue too, at the cost of re-authoring and re-hardware-validating the whole library for nodes we have already
decided cannot be general packages.

The mitigation for A's one real risk: keep the "no loss" test as the **gate per node**, so the generator cannot
silently paper over a format gap by leaving a codegen hook behind and quietly becoming a permanent second producer.

## 5. Mechanism sketch (A)

- **A built-in becomes a package** when its codegen has flattened to (descriptor data + a generic Python body): the
  descriptor is the `NodeDefinition`'s data half (already serializable — `NodeDescriptor`); the Python body is what
  its `codegenSource`/`codegenTransform`/`codegenSink` emits *minus* the flow-dependent parts, which become
  descriptor fields the generic codegen resolves (phase 2/3).
- **The generator** is a build step: run each built-in's codegen against a synthetic instance, emit `<name>.node.py`
  (and derive `<name>.node.json` from the descriptor). It runs on the developer machine/CI, never in the editor.
- **The load path**: `custom_node_dirs` already exists (ordered, first-folder-wins with shadow reporting,
  `persisted_store`). Add a core folder before the user's; merge built-in and package definitions into one registry
  (`mergeCustomNodeRegistry` already does the merge for one compile). The compiler's one codegen engine
  (`buildCustomNodeDefinition`) is what runs every package at compile time; the TS hooks become build-time-only.
- **The residue** (`function`, `gui_*`) keeps a codegen hook — a documented, revisitable divergence, the same shape
  `PortType`-as-function was kept as.

## 6. The gauge

The reviewer's test, made executable per node: `i2c` first (closest), then the leaf hardware/network nodes, then the
flow-dependent ones as the format grows. `function` and `gui_*` are the named exceptions, not goals.

## 7. Blast radius

- **Touched:** a new build step (generator); `interfaces/node-descriptor/` (already the shape); the load path
  (`persisted_store.custom_node_dirs`, `app/custom-node-loader.ts`, `mergeCustomNodeRegistry`); the compiler registry
  construction; docs (built-ins and packages as one thing).
- **Not touched:** the wire protocol; the runtime API (unless a built-in's flattened `.node.py` needs a new
  `runtime.*` call — a version-bumped interface).
- **Not a rewrite under A:** the ~40 `node-library/*.ts` files keep working as the authoring layer.

## 8. Questions — answered 2026-10-15

1. **A or B** — **A** (generate from the TS codegen), with the residue.
2. **Residue** — stays built-in-only (`function`, `gui_*`), documented; not a goal.
3. **Generator timing** — build-time, into the shipped artifact; the generated `.node.py` is **not committed**
   (one source in-repo: the TS). The compiled-source preview already serves the "view/copy a built-in" goal.
4. **Marketplace timing** — deferred; a separate deliberate call (Decision 5's sandboxing trigger).

## 9. First work item

Prove the model end to end on one node, before generalizing: **`st/lsm6ds3` already shows the custom path;
`i2c` is the built-in to convert.** Two coupled pieces, one change:

1. **One load path.** A core packages folder placed ahead of `custom_node_dirs` (the backend already searches an
   ordered list; `persisted_store`), and one registry merge (`mergeCustomNodeRegistry` already merges a package
   into the built-in registry for one compile). The built-in being converted is removed from `buildRegistry()`
   and loaded as a core package instead, so there is exactly one producer for it.
2. **The generator, for one node.** A build step that runs `i2c`'s codegen and emits its package
   (`<name>.node.json` from the descriptor + `<name>.node.py`), which then compiles through the *same* generic
   path a user package uses. Gate it on the no-loss test: the generated Python must match what the built-in
   produces today for the same flow.

Only then widen to the leaf hardware/network nodes and, as the format grows, the flow-dependent ones. `function`
and `gui_*` stay built-in-only.

**Note:** the generator can only flatten a built-in whose codegen is flow-independent; anything reading the graph
(`gui_*`, `wifi_status`) needs its decisions moved into descriptor data first (phase 2/3) or stays residue. `i2c`
is flow-independent (config + pins), so it is the honest first case.
