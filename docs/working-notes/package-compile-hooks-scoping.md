# Package compile hooks (a sandboxed compile-time half for packages) -- scoping

2026-10-18. **Status: direction approved 2026-10-18, gated on the spike (§8).** Mike's call after
`reviews/2026-10-18-node-parity-architecture.md`: option 3 is the intended direction, contingent on a timeboxed
interpreter spike with explicit go/no-go criteria; option 2 is the fallback if it fails. This reopens the scope of
Decision 5 (`custom-node-authoring-scoping.md`) and adds a cross-subsystem interface (`AGENTS.md`, "Interface
specs") — approved. The amendments agreed with the approval are recorded in §10.

Read first: `reviews/2026-10-18-node-parity-architecture.md` (the findings this answers),
`node-context-parity-scoping.md` (the vocabulary approach, §1/§3/§5), `builtins-as-packages-scoping.md` (option A,
location parity), `custom-node-authoring-scoping.md` Decision 5.

## 1. The problem

A built-in node has a compile-time half (TypeScript against `CodegenContext`, `compiler/node-definition.ts`) and a
runtime half (the Python it emits). A package has only a runtime half (`.node.py`) plus a data descriptor, because
the editor never executes package code. Every compile-time behaviour a built-in has must therefore be re-expressed
as descriptor vocabulary in the core. That has added roughly fifteen interface items in three days, several for one
node, and the 17 remaining convertible built-ins need more (the review, §2). It contradicts the extensibility
measure (how long the core can go without a change) and leaves users' custom nodes behind core packages.

## 2. The reframe: parity is one context interface, not one language

Built-ins already have compile hooks; they are just internal. `CodegenContext` is an unversioned TypeScript
interface whose members are optional so test mocks compile. If that context became a **published, versioned
interface**, and a package could implement the same hook, parity would be structural rather than something earned
node by node:

- a core node = descriptor + compile hook in TypeScript (trusted, bundled) + generated or hand-written Python
- a user's node = descriptor + compile hook in MicroPython (sandboxed) + `.node.py`
- one context contract, one set of rules for what a hook may return

"Built-ins as packages" (`builtins-as-packages-scoping.md`) then becomes literal without porting every built-in's
compile-time logic into data. The data vocabulary that exists stays: it is the cheap path for common cases and keeps
packages analysable by the catalog and AI authoring. The hook is for what the vocabulary can't say.

## 3. Options

### Option 1 -- continue the vocabulary (status quo)

Each remaining capability becomes a field kind or descriptor key, resolved by the generic codegen. Next in line: a
flow-query facility (`findConfigsOfType`/`findNodesOfType` for the network family), a property-dependent port type,
nested-config resolution, a node-specific target query, and whatever `display_spi`'s geometry needs.

- For: no new machinery; every capability is reviewed; packages stay pure data plus device code.
- Against: the core grows with each new kind of node, each addition is a one-way door, and third-party nodes needing
  anything new still need a core change. The registry-repos direction (hundreds of nodes) makes this worse over time.

### Option 2 -- a runtime flow manifest (Node-RED's model)

The compiler embeds a small, read-only, secret-free description of the flow in the generated file (node ids and
types, config ids and types, this node's wiring), and the runtime exposes it, e.g. `runtime.flow.nodes_of_type(t)`,
`runtime.flow.config_of_type(t)`, `runtime.flow.is_wired(node_id, port)`. Packages make flow-dependent decisions on
the board.

- Covers: the network family's WiFi derivation and `wifi_gate`'s `deferToMqtt` decision; `adc`'s ADC2-vs-WiFi guard.
- Doesn't cover: editor-side port types; `display_spi`'s compile-time geometry (moving it to run time costs speed on
  the viper path); compile-time claims and dedup.
- Costs: a runtime-API addition (major bump, `AGENTS.md`); a little flash/RAM per flow; errors that are compile-time
  today move to boot and surface as `NODE_ERROR`/`report_status`, against the fault-handling priority of failing
  loudly at compile (`node-context-parity-scoping.md` §6).

### Option 3 -- a sandboxed compile hook (recommended)

A package may ship an optional `<name>.compile.py` defining `def compile(ctx, properties)`. It runs at compile time,
in a MicroPython interpreter built to WebAssembly, in the two places the compiler already runs (the browser editor
and `thingstudio-compile`), alongside the existing `mpy-cross` WASM. It never reaches the board.

**What the hook sees (`ctx`), read-only and JSON-shaped,** derived from today's `CodegenContext` inventory
(`node-context-parity-scoping.md` §3):

- this node: id, type, properties, which ports are wired and to what types
- the flow: nodes (id, type, non-secret properties), configs (id, type, non-secret properties)
- the configs this node references, **with** their resolved secrets (the existing `configRef` rule); other configs'
  secrets are redacted, so a hook can't lift credentials it wasn't given
- the target: processor, board, pin table

**What the hook may return, all data the core validates:**

- extra properties to inline into the `properties` dict the `.node.py` receives (computed constants, e.g.
  `display_spi`'s MADCTL/stride, or the flow's WiFi credentials for a network node)
- resource claims, checked by the existing `claimResource`/pin-check machinery
- warnings and errors, surfaced as `CompileResult.warnings` and `CompileError` naming the node
- optionally a setup-dedup key, so two instances sharing a resource emit setup once

The hook never returns Python source: the core keeps sole ownership of the generated code's shape, and the
`properties` dict stays the one delivery vehicle, as today.

**Editor-side half (later, optional).** The same interpreter could answer a synchronous `ports(properties)` call when
a property changes, covering property-dependent port types (`inject`, `startup`, `variable_get`). The data forms
already cover most editor behaviour, so this is a second step, not a requirement.

## 4. Security

Decision 5 keeps stranger code out of the editor, where it would have the page's privileges (the backend admin API,
credentials, the user's files). A compile hook as specified above has none of those:

- it runs inside a WASM interpreter with no host imports beyond `ctx` and its return channel: no network, no files,
  no DOM, no clock or randomness
- its output is data, validated by the core before use; it cannot inject Python into the generated flow
- it sees only the secrets the node already receives on the board through `configRef`

The marginal risk is small next to what is already accepted: a package's `.node.py` runs on the device with full
trust (design doc §9). The residual risks to design for:

- **Denial of service** (an infinite loop): `compile()` is synchronous (`compiler/compile.ts`), so the interpreter
  needs an instruction or time budget it can enforce in-process, or compile becomes async and the hook runs in a
  Worker (browser) / `worker_threads` (CLI) that can be terminated. Open technical question; see §7.
- **Interpreter escape**: a bug in the interpreter is confined to WASM linear memory unless host functions expose
  more; keep the host surface to `ctx` only.
- **Secret leakage through output**: covered by redaction plus the existing rule that secrets land in generated
  Python only via the node's own config references.
- **Output size** (added 2026-10-18): cap the returned `properties` blob and statement/claim counts, so a hook
  cannot exhaust editor memory even without an infinite loop. Same "validate the output as data" rule, with limits.

This is a deliberate reopening of Decision 5's scope, not a quiet change. The marketplace/sandboxing trigger Decision
5 names (installing third-party packages) is unchanged by this proposal and still a separate call.

## 5. Coverage of the remaining nodes

| Node(s) | Option 1 needs | Option 2 | Option 3 |
|---|---|---|---|
| `timer` | nothing | n/a | n/a |
| network family (9) | flow-query vocabulary | yes, at run time | yes, at compile time |
| `inject`, `startup`, `variable_get` | port-type data form | no | with the editor-side `ports()` step |
| `adc` | target/flow query kind | yes | yes |
| `touch_i2c` | nested-config resolution | partly | yes (`ctx` has the configs) |
| `display_spi` | a geometry facility | poorly (speed) | yes (constants inlined; viper loops stay in `.node.py`) |
| `variable_set` | context model Q3 | -- | -- (not a parity question) |

## 6. Costs of option 3

- **Interpreter size and load time** in the editor bundle and CLI. MicroPython's WebAssembly port is the natural
  choice (same language as `.node.py`, built like `mpy-cross-wasm/`, 348 KB today for comparison); its size and
  per-call cost are unmeasured. Load lazily, only when a flow uses a package with a hook.
- **Version coupling**: another WASM build to redo on each MicroPython bump, as with `mpy-cross`.
- **A new interface to keep stable**: a compile-context spec under `interfaces/` with conformance tests. Built-ins
  would be held to it too, which is the point, and also work: the optional members of `CodegenContext` become
  required in the spec.
- **Author experience**: hook errors need a traceback in the compile output naming the package and line; the
  `thingstudio-flow-author` skill and `docs/user-guide/custom-nodes.md` gain a section.
- **Determinism**: no clock or randomness in the sandbox, so the same flow always compiles to the same output.

## 7. Open questions

1. Is reopening Decision 5 for this acceptable (§4)?
2. Synchronous budgeted interpreter, or make `compile()` async and use a terminable worker? Answer by spike.
3. Do built-ins adopt the published context in TypeScript (making core nodes literally "packages with a TS hook"),
   or stay internal with the spec applying to packages only? The former is what makes parity structural.
4. Does the editor-side `ports()` hook land with the compile hook, or wait for a real need beyond the three nodes?
5. What happens to the core-only vocabulary (`resources`, `lessThan`, ...)? Proposal: keep it as sugar, promote to
   the custom schema only where it is still the clearer form once hooks exist.

## 8. Suggested sequence, if approved

1. **Spike the interpreter — done 2026-10-18, `package-compile-hooks-spike.md`.** Size 371 KB raw / 164 KB gzip;
   ~5–10 ms per hook with a fresh instance; hook body ~0.1–2.4 ms. **The synchronous budget the note assumed does
   not exist in JS-hosted WASM**: a runaway hook can only be stopped by terminating a worker, which makes the call
   (and `compile()`) async. Recommendation: go, amended to async `compile()` + a persistent hook worker with a
   wall-clock budget; browser shim and worker cold-start still to measure. If async is rejected, option 2.
2. **Async containment — accepted 2026-10-18.** Refined in implementation: an async pre-pass runs the hooks in a
   worker and passes validated results to the synchronous `compile()`; `compile()` itself does not change shape.
3. **Measure the browser path**: a WASI preview1 shim in the editor, same size/latency numbers, before committing.
4. **Draft the context spec** (`interfaces/node-compile-context/`) — first draft written 2026-10-18
   (`SPEC.md` + `api.json`), pending Mike's review. It defines the `<name>.compile.py` hook, the context (node, flow,
   referenced configs, target), the validated result (properties, claims, warnings, errors), limits and
   fault behaviour.
5. **First real target — done 2026-10-19:** `wifi_status` is a core package with a hook, plus `ts_wifi` for the
   shared, idempotent bring-up. The remaining network nodes can use the same hook; `http-in` still needs a sibling
   scan and a shared server/queue.
6. Then the rest of the network family, `touch_i2c`, `display_spi`, and the question of built-ins adopting the spec.

Unaffected meanwhile: convert `timer` (done). Held until decided: the flow-query vocabulary and promoting
core-only vocabulary into `custom-node.schema.json`. **Not held:** the port-type data form (§10 item 4), `ts_wifi`.

## 9. Blast radius

- New: a MicroPython WASM build and loader beside `mpy-cross-wasm/`; a hook runner in `editor/src/node-library/`;
  the compile-context spec and conformance test under `interfaces/`.
- Changed: `custom-node.ts` (load and call the optional hook, validate its output), `custom-node.schema.json` and
  `interfaces/node-descriptor/SPEC.md` (declare the hook file), possibly `compile.ts` (async, if the spike says so;
  every caller of `compile()` then changes).
- Docs: `docs/user-guide/custom-nodes.md`, the flow-author skill, `decisions/node-authoring.md` once decided.
- No device-runtime change, no wire-protocol change, no runtime version bump.

## 10. Decisions agreed 2026-10-18

Mike approved option 3 as the direction, with these amendments (all from the architecture review session):

1. **Spike-gated (spike run 2026-10-18; async accepted the same day).** Interpreter cost is fine; synchronous
   budgeting is unavailable, so containment is a worker terminated on timeout. **Mike accepted that** on
   2026-10-18; the implementation refined it to an async pre-pass feeding the synchronous `compile()` (the hook
   result is data). Remaining: the worker runner and the context spec. If the
   browser path fails, option 2 is still the fallback for the network family, with the honest statement that parity
   then stays partial.
2. **Data is the default; the hook is the escape hatch.** Hooks do not remove the need for declarative shapes — the
   palette, property panel, catalog, AI authoring and static analysis all read data. A new capability is data unless
   it genuinely cannot be expressed as data, and that exception is stated in the change.
3. **Built-ins adopt the published context too (open question 3: yes).** A TypeScript adapter rather than a rewrite
   of the 15 existing core packages. If only packages use the spec, two vocabularies return — the one-vocabulary
   rule.
4. **The property-dependent port type stays vocabulary (open question 4: no editor-side `ports()` for now).** A port
   type that follows a property is bounded (three nodes), inherently editor-side, and a poor fit for a compile hook
   running on every keystroke. Added as an explicit exception to the hook direction. The editor-side `ports()` step
   is deferred until a real need beyond those three nodes appears.
5. **Parity test restated (review open question 2):** no loss of **on-device behaviour**; a compile-time check may
   move or be dropped only when that move is recorded in the conversion note. "No loss" as originally stated is
   retired.
6. **`ts_wifi` is orthogonal** to the hook decision: a package still needs the on-device WiFi bring-up with
   `deferToMqtt` semantics, whether the credentials come from vocabulary or a hook. Approved as a flow dependency;
   it lands with the network flips.
7. **`wifi_status` is the first "no loss" target**, not the last: it is the hardest network case, so success there
   validates the model.
