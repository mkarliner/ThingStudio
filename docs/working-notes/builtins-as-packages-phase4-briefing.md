# Briefing: built-ins as packages (node-format parity, phase 4)

Written 2026-10-16. Continues `node-format-parity-briefing.md`; the model is decided and the first conversions
are done. Read `builtins-as-packages-scoping.md` (decided: option A), `decisions/node-authoring.md` (2026-10-15
entries: the goal, the security policy, the flips), and `node-context-parity-scoping.md` first. This brief is the
end-of-session handoff: what landed, and the next deliverable (a shared-resource facility) in recon form.

## Where this comes from

- `decisions/node-authoring.md` — the goal ("maximize node capability added without changing the core";
  extensions as packages → a marketplace), the security policy (the editor never executes package code; the
  device is looser, caveat emptor, mitigated by auditable packages), and the phase-4 decision (option A).
- `builtins-as-packages-scoping.md` — the model, the trade-off, §9 the first work item, §10–16 the run.
- `node-context-parity-scoping.md` — phase 2 (context parity), mostly landed.
- `docs/user-guide/custom-nodes.md` — the package format users write.

## The target (don't re-litigate)

A built-in is authored in TypeScript; a build step generates its package (its `NodeDescriptor` + a `.node.py`
from the codegen), and every node — built-in or installed — compiles through the one generic path
(`buildCustomNodeDefinition` / `buildCoreNodeDefinition`), so the TS codegen becomes a build-time generator.
"Generate from TS" is really a **per-node hand-port** of the device logic to Python (TS stays the reference);
there is no free generator. One load path (core folder ahead of the user's). Residue stays built-in-only:
`function` (verbatim user code) and `gui_*` (`screens` model).

## What's done (2026-10-15 → 16)

- **Phase 2 context parity:** singleton `configRef`, pin checks + claims (`pinUse`/`pinPull`), `target` (board
  identity), `nodeId` (a package can `report_status` about itself). GUI out of node-format scope by architecture.
- **One node class:** `DescriptorNode` backs built-ins and custom nodes; `AnyThingstudioNode` = `DescriptorNode`.
- **Package codegen:** `buildCoreNodeDefinition(descriptor, python)` (full descriptor + the shared `packageCodegen`
  wrapper). `buildCustomNodeDefinition` now shares that wrapper.
- **Format additions:** `nodeId` field kind; `integer` text field (hex/decimal, range-checked at compile, inlined
  as a number); number `min`/`max` enforced at compile; numeric `select` option values.
- **Four built-ins flipped to core packages** (`core-packages/*.ts`; the TS nodes deleted): `i2c`, `delay`,
  `gpio_out`, `debug`. Recipe: descriptor + `.node.py`, flip `registry.ts` + the editor class, delete the TS file,
  retarget its test; the catalog filters the internal `nodeId` field.
- **IMU example** (`st/lsm6ds3`, `st/lsm6ds3_int`): the interrupt node (`eventSource` + `ThreadSafeEvent` +
  `Pin.irq`), presets (`presetType`), named-pin fields (`pin` kind, `pinUse` opt-in for the claim). IRQ docs in
  `custom-nodes.md` fixed. Double-tap register fixes (416 Hz ODR, `TAP_CFG` `0x8E`, `WAKE_UP_THS` `0x80`) await a
  real-hardware pass.
- **Distribution direction recorded** (`decisions/node-authoring.md`): custom nodes may live in separate registry
  repos the backend queries; the search path is a list. Orthogonal to phase 4; re-raises the deferred marketplace.

## The next deliverable — a shared-resource / bus facility

**The gap found flipping `bme280`:** hardware nodes build on `i2c-shared.ts` / `hardware-shared.ts`, which do
three things the package format can't express yet — compile-time validation (missing bus, missing pins), conflict
detection (two nodes on one resource, two configs on one bus), and setup dedup (one shared object across nodes).
A package can share on the *device* via `runtime.shared(...)`, but loses those compile-time checks. So the whole
hardware family (adc, encoder, neopixel, eswitch, ebutton, interrupt, touch_i2c, display_*, bme280) is blocked.

**Sketch:** let a core/package descriptor declare a shared resource — the kind (`pin`/`i2c`/`spi`/`pwm`/`adc`),
the key, the settings (from properties/config), and the Python object to build — and have the generic codegen
validate it, claim it (`claimResource`), and dedup the setup statement, exactly as `hardware-shared.ts` does for a
built-in. Then `bme280` and the rest flip like the four that already did. This is a phase-3 capability (new
descriptor data + generic resolution + tests), not a per-node port — scope it (SPEC + custom schema if it should
be user-visible, or core-only at first) before coding.

**Also open (smaller):** port the pure-software nodes that need no facility — `filter` (a property-dependent
hand-port), `journal` (two outputs), `wifi_gate`, `http_response`. And the two package-vs-built-in differences to
expect each time: setup is deduped by the on-device `runtime.shared` singleton, not at compile time; and a
package's check-message wording differs from a built-in's (tests asserting exact generated text need relaxing —
a candidate for a small compatibility pass labeling a field's check with the node's palette id).

## The per-node recipe (settled)

1. `editor/src/node-library/core-packages/<name>.ts`: `descriptor` (the TS node's data half) + `python` (its
   device logic ported; `nonlocal` for per-instance state; add a `nodeId` field if it reports status).
2. `registry.ts`: `buildCoreNodeDefinition(descriptor, python)` in the list; `nodes.ts`: the class uses
   `descriptor`; delete the TS node-library file.
3. Retarget the node's test if it imported the TS `NodeDefinition` — keep a local
   `const xNode = buildCoreNodeDefinition(descriptor, python)` so most of the test is untouched; relax
   assertions on exact generated names/messages.
4. Catalog: the internal `nodeId` field is filtered in `cli/describe.ts`; regenerate `nodes-catalog.md` only if a
   user-visible descriptor field changed.

## Constraints and gotchas

- Interface changes (the schema, `NodeDescriptor`, SPEC, runtime API) need **Mike's explicit OK**; run the
  conformance tests and keep the SPEC readable. The `nodeId`/`integer`/`target`/`singleton`/`pinUse` additions all
  had it.
- `find editor/src editor/test -name "*.js" -delete` before trusting any `tsc`/`vitest` run; prefer
  `./node_modules/.bin/tsc --noEmit`.
- Working-notes line width <120; keep `outstanding-items.md` [P3] and `decisions/node-authoring.md` current.
- Pushing: `git push origin main` over SSH now works (a deploy key is installed; no PAT). Backend tests:
  `../.venv/bin/python -m pytest` from `backend/`.
- No `device-runtime/src` change in this work → no runtime version bump. The IMU example's `.node.py` is
  device-side Python (a package), not `device-runtime/src`.

## Git state

- `HEAD = 6dd90e2` ("node parity: numeric select option values; defer bme280"). Pushed to `origin/main`.
- This session's commits, `d749fa2..6dd90e2` (21): see `git log --oneline d749fa2..HEAD`. The phase-4 thread:
  `3c0d5e0` (decide) → `af6cae7` (i2c) → `2abaf99` (delay) → `48ccbb3` (gpio_out) → `e92c6df` (debug) →
  `6dd90e2` (numeric select + bme280 deferred).
- The sandbox `~/.thingstudio/custom-nodes/` has the example packages (dht22, doubler, lsm6ds3, lsm6ds3_int).
