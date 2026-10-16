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

## 10. Refinements 2026-10-15 (from starting §9)

- **Bundling (settled):** core packages are **bundled TS modules** — a descriptor object + a Python-source
  string — imported statically, so Vite, the headless CLI and any Node consumer all get them with no fs or
  network. `buildRegistry()` builds their definitions via a `buildCoreNodeDefinition` (the generic wrapper, but
  spreading the full descriptor so palette/catalog metadata survives). The backend `custom_node_dirs` core folder
  later holds an inspection-only copy. This is required because the headless compiler (`cli/check-flow.ts`) has
  no backend and no package loader.
- **"Generate from TS" is really a per-node hand-port.** The TS codegen is imperative string-assembly, not a pure
  function of properties, so no automatic generator can turn it into a static `.node.py`. Under A each built-in's
  device logic is ported to Python once (TS as the reference and no-loss target); A's edge over B is keeping TS
  as source-of-truth and not committing generated files, not free generation. The effort estimate should read
  accordingly.
- **`nodeId` field kind landed** (2026-10-15): a package's Python key receives the instance's own node id, so it
  can `runtime.report_status(...)` about itself — the NODE_STATUS gap that otherwise makes `i2c` (and every
  status-reporting built-in) unportable without loss. With it, the `i2c` end-to-end proof is the next step.

## 11. Progress 2026-10-15

- **`buildCoreNodeDefinition` landed** (`custom-node.ts`): the generic package wrapper, but spreading the *full*
  descriptor so palette/catalog metadata survives. `buildCustomNodeDefinition` now shares the wrapper
  (`packageCodegen`).
- **The `i2c` proof landed**: `node-library/core-packages/i2c.ts` (the built-in's descriptor + a ported `.node.py`)
  and `test/core-packages.test.ts`, which drops the core definition into the registry *in place of* the TS one
  and compiles a real `inject -> i2c -> debug` flow: the shared bus (`runtime.shared('i2c'`), the transfer, and
  the status report via the `nodeId` field all appear, and the generated Python parses. Two documented
  deviations from the TS codegen (the generic codegen can't see inside the Python): property ranges are checked
  at runtime, not compile time; and the bus pins aren't compile-checked (that stays in `i2c-shared.ts`).
- **Still to do:** flip `buildRegistry()` to build `thingstudio/i2c` from the core package (retire the TS one);
  the generator (a per-node hand-port, TS as reference); then widen to the other leaf nodes. `function`/`gui_*`
  remain built-in-only.

## 12. The i2c flip landed 2026-10-15

`thingstudio/i2c` is now built from the core package, end to end: `buildRegistry()` and the editor's `I2cNode`
use `core-packages/i2c.ts`, and the TypeScript `node-library/i2c-generic.ts` is **deleted** -- one producer. The
catalog filters the internal `nodeId` field, and the node's behavior tests were ported to the package (running
its generated transform against a fake bus). To keep i2c's compile-time errors, the generic codegen now
**enforces number `min`/`max`** and a new **`integer` attribute** parses a text field (hex/decimal) to a
range-checked number at compile time. The one residual deviation: a *missing* address/bus is a runtime error, not
compile-time, because conditionally-required fields aren't expressible yet (tracked).

Next: the per-node port of the other leaf built-ins (the "generator" is a hand-port with TS as reference), then
the remaining flow-dependent ones as the format grows. `function`/`gui_*` stay built-in-only.

## 13. Second leaf node: delay

`thingstudio/delay` is now a core package too (`core-packages/delay.ts`, `delay.ts` deleted) -- a trivial
transform, so it also proves the simplest case: a `.node.py` that just uses `asyncio` (already a generated-flow
global) with no setup. Its `delayMs` `min` is enforced at compile time by the generic codegen. The pattern per
node: write the descriptor + `.node.py`, flip `registry.ts` and the editor class, delete the TS node, retarget its
test.

## 14. Third leaf node: gpio_out, and a package-vs-builtin difference

`thingstudio/gpio_out` is a core package too (`core-packages/gpio-out.ts`; `gpio-out.ts` deleted). Finding worth
recording: a built-in deduped its setup at compile time (two `gpio_out` on one pin shared one `_gpio_5 = ...`
statement, keyed by pin); a package emits a per-instance setup closure, so it calls `runtime.shared('pin', ...)`
once per instance and relies on the **on-device singleton** to hand back one `Pin`. Behaviour is the same (one
Pin), the generated code is a little larger, and the error messages a package produces differ in wording from a
built-in's (`node <id> (...) property "pin" 5 doesn't exist ...` vs `gpio_out pin 5 doesn't exist ...`). Both are
acceptable under the no-loss test, but they mean tests that asserted the built-in's exact code/text need
retargeting per node. Error-message wording is a candidate for a small compatibility pass (label a field's check
with the node's palette id) if the churn proves annoying.

## 15. Fourth leaf node: debug

`thingstudio/debug` is a core package too (`core-packages/debug.ts`; `debug.ts` deleted). It needed an internal
`nodeId` field for "DEBUG node=<id>"; the catalog filters it like the other internal fields. A widely-used sink,
so this was a good stress test: only the tests asserting the built-in's exact generated function name (`_debug`)
needed a one-word regex relaxation; the behaviour tests (running the generated flow) passed unchanged.

## 16. bme280 blocked: a shared-resource facility is needed first

Attempting `bme280` surfaced the real next gap. Its codegen calls `resolveI2cBus` (i2c-shared.ts), which does
three things a package cannot reproduce from descriptor data today: compile-time validation (a missing bus, or a
bus config with no SCL/SDA pin, is a `CompileError`), detection of two in-use configs claiming the same bus, and
compile-time dedup of the shared bus setup statement (so a display and a sensor emit one `machine.I2C`). A
package would build the bus with `runtime.shared('i2c', ...)` itself -- one `Pin`/object on the device, but two
setup statements and none of those three compile-time checks. So `bme280` stays a built-in until the package
format gains a **shared-resource / bus facility** (a descriptor-declared shared bus that the generic codegen
validates, claims and dedups). That is a phase-3 capability, not a per-node hand-port.

(The numeric-select fix that this attempt produced is kept: the generic codegen now inlines a numeric `select`
option value as a number, matching the canonical `PropertyFieldOption`. A custom `.node.json` still only uses
string option values.)
