# Review: node-format parity, the architecture

2026-10-18. Reviewer: Claude, in a session with Mike. **Status: review** -- findings and a recommendation, no
decision taken. Repo state reviewed: v0.3.0 (`11da98a7`).

The goal under review: "no difference between custom nodes and builtin nodes" (`AGENTS.md`, "Node format parity";
`decisions/node-authoring.md`, 2026-10-15), with the reviewer's test "could a built-in be rewritten as a package with
no loss", and the extensibility measure set the same day: how long the core can go without a change.

Read for this review: `AGENTS.md`, `docs/thingstudio-design-doc.md`, `decisions/node-authoring.md` (2026-09-30
onward), `outstanding-items.md` [P3] "Custom node format parity", `node-parity-remaining-nodes-briefing.md`,
`node-context-parity-scoping.md`, `builtins-as-packages-scoping.md`, `custom-node-authoring-scoping.md` (Decision 5),
`interfaces/node-descriptor/SPEC.md` and `custom-node.schema.json`, `editor/src/node-library/registry.ts`,
`editor/src/compiler/node-definition.ts` (`CodegenContext`).

The proposed way forward is scoped separately: `../package-compile-hooks-scoping.md`.

## 1. Where parity stands

Parity has three axes, at different stages.

**Axis 1 -- built-ins expressible as packages: 15 of 32.** The registry holds 42 built-ins. Ten are residue by design
(`function`, and the nine `gui_*` nodes, `node-context-parity-scoping.md` §4(g)). Of the other 32, 15 are core
packages (`i2c`, `delay`, `gpio_out`, `debug`, `bme280`, `filter`, `journal`, `http_response`, `pwm_out`,
`neopixel`, `interrupt`, `eswitch`, `ebutton`, `encoder`, `display_i2c`). The 17 left, by blocker:

| Blocker | Nodes |
|---|---|
| none | `timer` |
| context-model Q3 (`context-model-scoping.md`) | `variable_set` |
| no data form for a property-dependent port type | `inject`, `startup`, `variable_get` |
| a package can't query the flow (its WiFi config, whether it has mqtt nodes) | `http_in`, `http_request`, `mqtt_publish`, `mqtt_subscribe`, `ntp`, `udp_send`, `udp_receive`, `wifi_gate`, `wifi_status` |
| hardware design work | `touch_i2c` (nested config), `display_spi` (compile-time geometry), `adc` (ADC2-vs-WiFi query) |

`wifi_status` is missing from the remaining-nodes briefing's list; it belongs in the flow-query row (it is the flow's
WiFi-connect step and reads `findConfigsOfType`/`findNodesOfType`).

**Axis 2 -- a user's custom node can do what a core package can: behind, and diverging.** The vocabulary that let
the core conversions happen is core-only by deliberate staging: `resources`, `lessThan`, `dynamicOutputs`,
`placeholderWhen` are canonical `NodeDescriptor` fields absent from `custom-node.schema.json`. The `credential` and
`palette` field kinds, multi-output sources and native code are also not in the custom format. A user cannot today
write their own `bme280` with the core one's compile-time bus checks.

**Axis 3 -- one load path and location: partial.** Core packages and custom nodes share one wrapper
(`buildCoreNodeDefinition`/`buildCustomNodeDefinition`) and the generic compile path. Core packages are still TS
modules bundled into the editor, not a folder loaded ahead of the user's. Viewing and copying a built-in's generated
Python works.

## 2. Finding 1 -- the root cause: a built-in has two phases, a package has one

A built-in is a TypeScript program run at **compile time** against `CodegenContext` (`node-definition.ts`):
`resolveConfig`, `findConfigsOfType`, `findNodesOfType`, wired-ness, `target`, `claimResource`, `warn`, `screens`. It
validates, deduplicates setup, computes constants, and *then* writes Python. A package has only a **runtime** half
(`.node.py`) plus a static descriptor, and Decision 5 forbids package code running in the editor, so it has no
compile phase at all. `node-context-parity-scoping.md` §1 states this plainly and chose to close the gap with
vocabulary ("Option A": each compile-time facility becomes a field kind or attribute the generic codegen resolves).

The consequence is that every compile-time behaviour of a built-in must become a keyword the core understands. The
record from 2026-10-15 to 2026-10-17, each an interface change needing Mike's OK, with the node that drove it:

- `nodeId` (i2c, debug), `integer` (i2c), singleton `configRef` and `pinUse`/`pinPull` (i2c, bme280), `target`
- `visibleWhen` (replacing `showIf`), `placeholderWhen`, `dynamicOutputs` and `textarea` (`function`)
- `resources` (bme280 and the I2C/SPI/pin family), canonical `eventSource` (interrupt)
- `pullProperty` (eswitch/ebutton), `lessThan` (ebutton only), `fallback` and per-field `hidden` (display_i2c only)

Roughly fifteen additions in three days, several serving exactly one node. This is the inner-platform effect: the
descriptor is acquiring a programming language one keyword at a time, and it is a weaker language than the TypeScript
it replaces. The remaining nodes need more of the same: a flow-query vocabulary (9 nodes), a property-dependent port
type (3), nested-config resolution (`touch_i2c`), compile-time geometry (`display_spi`), a node-specific target
query (`adc`). The editor-side half has the same shape: a port type that follows a property is a UI hook with no
data form.

## 3. Finding 2 -- it works against the extensibility measure

The stated measure (`decisions/node-authoring.md`, 2026-10-15) is how long the core can go without a change, so that
"send us a node" becomes "publish a package". Today each core conversion *requires* a core change, and so would any
third-party node that needs a compile-time behaviour the vocabulary lacks -- which is a PR to core, the outcome the
goal exists to avoid. The registry-repos direction (hundreds of nodes, manufacturers' own registries) makes that
pressure larger, not smaller.

## 4. Finding 3 -- the two parity axes are pulling apart

Core-only staging is individually reasonable (prove a shape on core before making it user-facing). Its aggregate
effect is that every core conversion widens the gap between what a core package can do and what a user's node can
do. Axis 1 is being bought with axis 2. Each later promotion into the custom schema is another interface change.

## 5. Finding 4 -- "no loss" has drifted to "agreed loss"

Each conversion's deviations were agreed and are defensible, but together they redefine the test:

- dropped compile checks: `encoder`'s start-value range, `display_i2c`'s height-multiple-of-8; `i2c`'s missing
  address/bus moved from compile time to run time
- `encoder`'s `vmin`/`vmax`/`mod` became text fields (the format has no optional number)
- setup dedup lost: per-instance setup statements relying on `runtime.shared` (one object on the board, more code)
- package error wording differs from the built-in's; tests asserting exact text or names were relaxed

Either restate the test honestly (e.g. "no loss of on-device behaviour; compile checks may move or go") or treat
these as debt. The code-size cost of per-instance setup is unmeasured; it matters on flash-tight display boards
(`cyd-touch-gui-flash-budget-briefing.md`).

## 6. Why Node-RED does not hit this

Node-RED has no compile step. A node's runtime half sees the whole flow and its config nodes at run time
(`RED.nodes.getNode`), and its editor half is JavaScript that runs in the editor. Thingstudio copied Node-RED's
package *shape* but not its *execution model*; the compile step is exactly where they differ. The compile step is
sound for this project (design doc §5: no on-device compiler, compile-time resource claims, fail loudly before the
board), so the answer is not to drop it, but either to give packages a compile phase or to move flow decisions to
run time.

## 7. Options

Detailed in `../package-compile-hooks-scoping.md`; in brief:

1. **Continue adding vocabulary.** No new machinery and everything stays analysable data, but the core keeps growing
   and every addition is a one-way door.
2. **Runtime flow manifest (Node-RED's model).** The compiler embeds a small read-only description of the flow in
   the generated file; packages query it through `runtime.flow.*`. Covers the network family and `adc` with one
   runtime addition. Costs a runtime major bump, moves some errors from compile to boot, and does nothing for editor
   port types or `display_spi`.
3. **A sandboxed compile hook for packages.** An optional `compile(ctx)` in MicroPython, run in a capability-free
   WASM interpreter wherever `mpy-cross` WASM already runs, against the same context a built-in's hook sees and
   returning only data the core validates. One core change, after which the core can stop growing and both axes
   converge. Reopens Decision 5's scope and makes the context a versioned interface.

## 8. Recommendation

Option 3, scoped and spiked **before** building the flow-query vocabulary for the network family
(`node-parity-remaining-nodes-briefing.md`, suggested step 2), since that vocabulary would otherwise become the next
permanent interface. Option 2 is the fallback if the sandbox cost proves too high. Meanwhile:

- `timer` is unaffected: convert it.
- Hold the flow-query vocabulary and the property-dependent port-type data form until this is decided.
- Keep the core-only vocabulary core-only; don't promote it to the custom schema until the hook question is settled,
  since a hook would make some of it redundant for users.

## 9. Questions for Mike

1. Is reopening Decision 5 acceptable for a sandboxed, I/O-free compile hook whose output is validated data? (The
   device-side `.node.py` already runs with full trust; the scoping note argues the marginal risk is small.)
2. Which test is parity measured by: "no loss", or "no loss of on-device behaviour"?
3. Should the compile context (today's `CodegenContext`) become a published, versioned interface under
   `interfaces/`, used by built-ins and packages alike?
