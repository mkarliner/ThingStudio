# Node context parity (roadmap phase 2) — scoping

Status: scoping, 2026-10-15. Part of the node-format-parity work (`decisions/node-authoring.md`, "no difference
between custom nodes and builtin nodes"). Phase 1 (descriptor/UI parity) and phase 0 (one node class) are done.
This note scopes phase 2 — "context parity" — before any code, per the project's architecture-first rule. It
proposes; it does not commit. Every interface addition here needs Mike's explicit OK in the session that lands it.

## 1. The problem, stated plainly

A built-in's editor half is a descriptor + TypeScript **codegen hooks**; its generated Python is written by that
TypeScript, reading a compile-time `CodegenContext` (graph queries, the target board, wired-ness, the flow's GUI
layout, config nodes). A custom node's editor half is a **data-only descriptor** + opaque `.node.py`; the editor
never executes package code (Decision 5, `custom-node-authoring-scoping.md`) — a deliberate, permanent divergence
we are not reopening.

So "context parity" cannot mean "give packages codegen hooks." It means:

> Whatever compile-time knowledge a built-in's generated Python receives must be expressible as **data the generic
> custom-node codegen resolves and inlines into the `properties` dict** the package's Python already receives.

The `properties` dict is already the delivery vehicle (`custom-node.ts`'s `pyPropertiesLiteral`, and the `configRef`
case that inlines a resolved config). Phase 2 widens what can appear in it, plus (if needed) the on-device
`runtime.*` surface — which is a separate, version-bumped interface.

**The reviewer's test stays the same:** take a concrete built-in and show a custom package can reproduce it with no
loss. Every facility below is graded against that, not built on spec.

## 2. What exists today

- **Delivery.** `buildCustomNodeDefinition` (`custom-node.ts:546`) wraps `.node.py` in a per-instance closure;
  `pyPropertiesLiteral` (`:480`) builds the dict literal. The **only** compile-time resolution today is `configRef`
  → `ctx.resolveConfig(id)` inlined (`:500-503`); every other field is a literal property value.
- **Credentials.** A credential field stores only a **name**; `main.ts`'s `resolveConfigCredentials()` (`:485`)
  fetches the secret bundle from the backend and merges it into the *config node's* properties before compile, so
  built-in codegen reads it through `resolveConfig`. A node-level credential has no such path.
- **Runtime.** `interfaces/runtime-api/` exposes scheduler, fault boundary, keyed singletons (`shared`),
  `register_cleanup`, `report_status`. There is **no** on-device config or credential store; secrets are baked into
  generated Python as literals. Any new on-device facility is a **major** runtime bump (`AGENTS.md`).

## 3. Inventory — what built-in codegen reads

`CodegenContext` (`compiler/node-definition.ts:118`). Counts are `ctx.<x>` uses across `editor/src/node-library`.

| Facility | Used by (examples) | Reachable by a custom node today |
|---|---|---|
| `uniqueName` | all (63) | n/a — the generic codegen owns naming |
| `resolveConfig(id)` | 11 uses | **yes** — `configRef` inlines the config dict |
| `findConfigsOfType(type)` | `wifi-status.ts:251`, `i2c-shared.ts:108,115` | no |
| `findNodesOfType(type)` | `gui.ts` (many), `adc.ts:43`, `http-server-shared.ts:188`, `wifi-status.ts:335` | no |
| `isInputWired` / `isOutputWired` | `gui.ts:176,534`, `ntp.ts:262` | no |
| `findWiredTargets(nodeId)` | `gui.ts:88`, `orientation-shared.ts:131` | no |
| `screens` | `gui.ts:116,276,530` | no (GUI-specific) |
| `target` | `adc.ts:100` (ADC2-vs-WiFi) | partly — `requires` gates the node, but pins aren't checked |
| `claimResource` | `hardware-shared.ts:41` | no — a package uses `runtime.shared` with no conflict check |
| `warn` | 4 uses | no |

`resolveConfig` is done. The rest is the phase-2 surface. Note how much of it is **flow-shape** knowledge (other
nodes, wired-ness) that a package has no way to ask for today.

## 4. Workstreams (each independently valuable; each an interface addition)

Ordered by "no loss" payoff per unit of risk, and by how little new plumbing each needs.

**(a) Flow-singleton config reference.** A package wants "the flow's WiFi config," not "the config whose id I
happen to hold." Built-ins get it via `findConfigsOfType` (WiFi is a `singleton` config type). Proposal: let a
`configRef` field declare singleton intent (e.g. `configRef` with an empty/omitted reference meaning "the flow's
one config of `configType`"), resolved by the generic codegen through `findConfigsOfType` — same
zero/one/many error rules `resolveFlowWifiCredentials()` already applies. Smallest addition with the biggest reach
(every network package).

**(b) Resource claims + pin checks.** A package that touches a pin/bus should claim it at compile time
(`claimResource`) so a second node with different settings is a `CompileError`, and its `pin` fields should be
checked against the target board like a built-in's. Proposal: a descriptor `resources` list (data) the generic
codegen claims, and a generic pin-check pass over `pin` fields. This closes two `outstanding-items.md` gaps
(`hardware-singletons`, board pin checks) for packages.

**(c) Wired-ness for two-faced packages.** A package that is both a sink and a source needs to know whether its
input is wired. Proposal: a data field kind (e.g. `wired` with `side: input|output`) resolved by
`isInputWired`/`isOutputWired` and inlined as a bool. **Note:** the only built-in two-faced nodes are GUI
(`gui_button`/`gui_modal`), which are out of scope here (see (g)); a non-GUI two-faced package is currently
hypothetical, so this is opportunistic — defer until a concrete case appears. (`ntp` uses `isOutputWired` for a
warning only.)

**(d) Credential-by-name.** A node-level `credential` field (name + `credentialType`) resolved at compile time to
the secret bundle, the way a config's is. **Open question:** is this wanted at all, given `configRef` to the WiFi
config already delivers the secrets? See §8.

**(e) Board/target exposure.** Give a package the target's identity/capabilities as data (beyond
`requires.capabilities`). Only build if a concrete package needs more than capability gating.

**(f) Flow-node queries (`findNodesOfType`).** A general presence/count query ("is there an mqtt node in this
flow") — `adc.ts` uses it to detect WiFi, `wifi-status.ts` to decide who owns the connection. Niche; defer until a
real package needs it.

**(g) GUI — out of scope for node context parity, by architecture.** The GUI subsystem is orthogonal to the flow
programming paradigm (`gui-layout-widget-system-scoping.md`; `decisions/gui-layout.md`): it has its own model and
its own (future) editor view, and a widget manifests in the flow only *partially*, so the flow can interact with
it. That partial manifestation is a value-in (and, for interactive widgets, an event-out) node — which the package
format already expresses (ports, `eventSource`, properties). What a package cannot carry — the widget's drawing,
styling, layout slot and state rendering — is a **GUI-subsystem record**, not a flow/package one, and belongs to
the GUI subsystem's own authoring model. So "style an existing widget", "write a new widget" and the eventual
drag-and-drop layout editor are GUI-line work, not node-format-parity work; they should be scoped against the GUI
subsystem (which would also own whether a *custom widget* definition exists at all), not folded in here. This is a
boundary call, not a cost call: the GUI's `screens` layout model and per-widget draw routines have no clean data
form in a flow-node descriptor, and shouldn't be forced into one. Kept as a pointer here so the two lines don't
drift.

## 5. The mechanism — one vocabulary, resolved by the generic codegen

Two shapes were considered:

- **Option A — extend the field-kind vocabulary.** Each new facility is a serializable field kind (or attribute on
  an existing kind) that `pyPropertiesLiteral` resolves via `CodegenContext`, inlining the result into
  `properties`. Consistent with the one-vocabulary rule and the data-equivalent rule and with how `configRef`
  already works.
- **Option B — a `context` block** on the descriptor listing named facilities. More open-ended, but becomes a
  parallel vocabulary (§4's rules warn against exactly this).

**Recommend Option A.** Every addition is a field kind or attribute, validated in `custom-node.ts`, mirrored in the
schema, resolved in `pyPropertiesLiteral` with a `CompileError` naming the node and field on failure
(fault-handling priority — a missing config or unresolved credential must fail loudly at compile, not produce
Python that crashes on the board).

Example shapes (illustrative, not final): `configRef` gains singleton semantics (a); a `resources: string[]`
descriptor key (b); a `wired` field kind (c); a `credential` field kind with `credentialType` (d); a `board`/
`target` field kind (e). Final names are a design detail for the landing session.

## 6. Fault handling and one-way doors

- **Resolution failures are compile errors**, naming node + field + reason ("node 7 (custom/dht22) property
  \"bus\": the flow has two I2C bus configs"). Never silently `None`.
- **Secrets must not land in the saved flow file.** Today's model keeps `credentialName` in the file and resolves
  the secret at load/deploy, merging into in-memory config properties only
  (`outstanding-items/credential-free-committable-flows.md`). A node-level credential must follow the same split:
  name in `properties`, secret in a compile-time side channel. **One-way door:** where that side channel lives
  (a node-properties field the file never serializes, vs. a separate map threaded into `compile()`). Get this shape
  right before node-level credentials ship, or saved flows either leak secrets or need a breaking migration.
- **No new on-device lookup** unless a real need forces it — keep the existing "inline at compile time" model. A
  runtime credential store is a strictly bigger, separate question (and a runtime major bump).
- **`dynamicOutputs`** (already a data descriptor field) should join the custom schema in phase 3 (capability
  parity, dynamic ports) — not here.

## 7. Reference "no loss" targets

Close each workstream against a concrete built-in, hardest last:

1. **`i2c` / `bme280`** — config singleton (a) + resource claims/pin checks (b). Closest to done; `configRef`
   already inlines a bus. This is the natural first target.
2. **`wifi_status`** — singleton config (a) + `findNodesOfType(mqtt)` (f) + credential (d). The hardest; may
   legitimately not be reproducible as a package, which is itself a finding worth recording.

GUI is not a target: its only two-faced built-ins (`gui_button`/`gui_modal`) are out of scope per §4(g), so
workstream (c) has no non-GUI reference for now.

## 8. Open questions for Mike

1. **Credential-by-name (d) — wanted?** A package can already get WiFi/MQTT secrets by `configRef`-ing the flow's
   config. A node-level `credential` field only helps a package that wants a credential without a config node.
   Build it, or document configRef as the route and drop (d)?
2. **Flow-node queries (f) — in scope?** A general "does this flow contain type X" query (`adc`/`wifi-status` use
   it internally). Worth a data form for packages, or defer until a real package needs it?
3. **Board/target (e) — how much?** Capability gating already exists (`requires`). Is `adc`'s ADC2-vs-WiFi kind of
   check worth a generic data form, or does pin validation (b) cover the practical need?
4. **Ordering.** Confirm (a)+(b) as phase 2a, (c) as 2b, (d) only if wanted. Phase 3 (dynamic ports, multi-output
   sources, presets, native code) stays after.

## 9. Blast radius

- **Touched:** `interfaces/node-descriptor/{SPEC.md,custom-node.schema.json}` (new field kinds/attributes),
  `editor/src/node-library/custom-node.ts` (`PROPERTY_KINDS`, validator, `pyPropertiesLiteral`,
  `buildCustomNodeDefinition`), `editor/src/compiler/node-definition.ts` (`CodegenContext` likely unchanged —
  the facilities already exist), `editor/src/app/main.ts` (only if credential-by-name is built), tests
  (`custom-node.test.ts`, `node-descriptor-schema.test.ts`, new codegen tests).
- **Not touched:** the wire protocol; the runtime API (unless a facility moves on-device → **major** runtime bump).
- **Not a rewrite:** the `CodegenContext` already exposes `findConfigsOfType`, `findNodesOfType`,
  `isInputWired`/`isOutputWired`, `target`, `claimResource` — phase 2 routes package codegen through them; it does
  not add new compiler machinery.

## 10. First concrete step (if approved)

Land phase 2a against the `i2c` reference: (a) singleton `configRef` resolution + (b) resource claims and generic
`pin` checks for custom nodes, with schema/SPEC/conformance/tests in the same change, then verify a hand-written
`custom/i2c-like` package compiles to the same generated bus/`runtime.shared` calls a built-in `i2c` does.
