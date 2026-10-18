# Briefing: node-format parity — remaining built-ins

Written 2026-10-17. Continues `builtins-as-packages-phase4-briefing.md` and `builtins-as-packages-scoping.md`.
Read `shared-resource-facility-scoping.md` §9 first: it is the facility + per-node status. The model (option A)
and the security posture are decided — don't re-litigate.

## What landed this session (2026-10-17)

- **The shared-resource facility** (`NodeDescriptor.resources` + `node-library/resource-check.ts`): a core package
  declares an `i2c` bus (from a configRef, with an optional node-pin `fallback`), an `spi` bus (from properties),
  or a claimed `pin` (direction/pull, role/use text, optional derived device claim + `pullProperty`). The generic
  package codegen validates and claims it; the package's own `.node.py` still builds the object through
  `runtime.shared(...)` (Option 2). Core-only, not in the custom schema.
- **Other canonical additions** (all core-only, Mike-approved): `eventSource` on `NodeDescriptor` (so a core
  package can be a non-polling source); `PropertyFieldDescriptor.lessThan` (cross-field numeric constraint);
  `PropertyFieldDescriptor.hidden` (read but not shown); `I2cResourceSpec.fallback`.
- **15 built-ins are core packages** (`node-library/core-packages/`): `i2c`, `delay`, `gpio_out`, `debug` (prior
  session) + `bme280`, `filter`, `journal`, `http_response`, `pwm_out`, `neopixel`, `interrupt`, `eswitch`,
  `ebutton`, `encoder`, `display_i2c`. (`interrupt` also lost its `debounce` — Mike: eswitch/ebutton own debounce.)
- **GUI size coupling fixed**: a `gui_screen` now takes width/height/frameFormat from the wired `display_spi`
  (its own are hidden fallback fields); the screen-vs-display size check is gone. `decisions/gui-layout.md`
  2026-10-17.
- **Two project rules** added to `AGENTS.md`: "Everything is a plugin" (default, with named exceptions) and
  "Read the user manual before the code"; the plugin rule also logged in `decisions/node-authoring.md`.

## Git state

- `HEAD = 4c74acc`. All of this session's commits are local; **not pushed** (`git push origin main` over SSH
  works). Full editor suite green (90 files, 1089 passed / 2 skipped); `./node_modules/.bin/tsc --noEmit` clean.

## The per-node recipe (settled)

1. `core-packages/<name>.ts`: `descriptor` (the TS node's data half + any `resources`) + `python` (its device
   logic ported; `nonlocal` for per-instance state; `runtime.shared(...)` for shared objects; a `nodeId` field if
   it reports status).
2. `registry.ts`: `buildCoreNodeDefinition(descriptor, python)`; `nodes.ts`: the class uses `descriptor`; delete
   the TS node-library file; retarget its test (keep a local `const xNode = buildCoreNodeDefinition(...)`;
   relax assertions on exact generated names/messages and on dropped compile-time checks).
3. Regenerate the catalog if a user-visible field changed:
   `cd editor && npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown > ../docs/user-guide/nodes-catalog.md`.
4. Update the user docs (`docs/user-guide/nodes/<node>.md`) and the `decisions`/`outstanding-items` logs, same change.

## Remaining built-ins, by blocker

Portable now (no blocker — do these first):
- ~~`timer`~~ — **done 2026-10-18** (`core-packages/timer.ts`; counter lives in the setup closure). No catalog
  change.
- **`variable-set`** — a plain `any`-in/out transform (`_flow_vars` store). **Not on the portable list any
  more:** its fate is the context model's no-code-path question (Q3), still open; that model now follows the
  device settings store (`device-settings-store-scoping.md`, `context-model-scoping.md` §12/§13).

Blocked on a **data form for a property-dependent port type** (the data-equivalent rule; `PortType`-as-function is
the last built-in-only corner besides `dynamicOutputs`):
- **`inject`**, **`startup`** (their single output tracks `payloadType`), **`variable-get`** (`outputs[0].type` is a
  function of `payloadType`).

Blocked on **flow-query context parity** (they derive WiFi from the flow — `resolveFlowWifiCredentials` /
`flowHasMqttNodes`, not from their own properties): **`http-in`**, **`http-request`**, **`mqtt-publish`**,
**`mqtt-subscribe`**, **`ntp`**, **`udp-send`**, **`udp-receive`**, **`wifi-gate`**. Scoped 2026-10-18 in
`network-family-flow-context-scoping.md`: WiFi credentials already arrive via a singleton `configRef`; the real gaps
are a `hasNode` presence field, a shared device-side WiFi bring-up library, and (for `http-in` only) a
`nodesOfType` sibling scan plus a runtime.shared server/queue. Needs Mike's OK on those forms.

Hardware, each its own design/verification task (see `shared-resource-facility-scoping.md` §9):
- **`touch-i2c`** — nested config (`touch-panel` → `i2cConfigId`); not a small change (config field kinds live in
  `app/rete/config-types.ts`, behind the layering boundary; `ctx.resolveConfig()` returns no type). Options: a
  facility extension passing a resource-built object into a package (Option 1), moving config-type metadata to a
  shared module + threading the type through the codegen context, or a resource-declared rule naming the nested
  field. Plus the panel single-use check and reset-pin claim.
- **`display-spi`** — large and hardware-critical: compile-time MADCTL/stride geometry + the `@micropython.viper`
  expansion loops must become runtime Python. Do it only with a real-hardware pass; consider whether the geometry
  belongs in a small facility instead.
- **`adc`** — a node-specific compile-time context query (its ESP32 ADC2-vs-WiFi guard reads `findNodesOfType`).

Residue (built-in-only by design, not goals): **`function`** (verbatim user code) and the **`gui_*`** family (the
`ScreensSection` layout model; `gui.ts`).

## Suggested next-session order

1. ~~**`timer`** — done 2026-10-18.~~ (Regenerate the catalog only if a field changed — it didn't.)
   **`variable-set` is no longer on this list:** its fate is the context model's no-code-path question (Q3), still
   open, and that model now follows the device settings store (`device-settings-store-scoping.md`,
   `context-model-scoping.md` §12/§13).
2. **Package compile hook: spike done 2026-10-18** (`package-compile-hooks-spike.md`). Interpreter cost is
   acceptable (371 KB raw, ~5–10 ms/hook), but JS-hosted WASM has no synchronous budget: containment needs a
   worker terminated on timeout, so `compile()` becomes async. **Accepted by Mike 2026-10-18:** async
   `compile()` + a persistent worker. Next: the browser WASI-shim measurement, then the context spec.
3. **Flow-context vocabulary for the network family — held, not dropped.** `network-family-flow-context-scoping.md`
   is the inventory; if the hook goes ahead, most of it is replaced by the hook (`wifi_status` is the first target).
   If not, the `hasNode`/`nodesOfType` forms in that note are the fallback.
4. **A data form for property-dependent port types** (unblocks `inject`/`startup`/`variable_get`). **Not held**
   (Mike, 2026-10-18): bounded, editor-side, a poor fit for a hook — an explicit exception to the hook direction.
5. Then the hardware remainder (`touch-i2c`, `display-spi`, `adc`) as separate, ideally hardware-verified tasks.

## Constraints and gotchas

- Interface changes (`NodeDescriptor`, the custom schema, the SPEC, the runtime API) need **Mike's explicit OK**;
  run the conformance tests and keep the SPEC readable.
- `find editor/src editor/test -name "*.js" -delete` before trusting any `tsc`/`vitest` run; prefer
  `./node_modules/.bin/tsc --noEmit`.
- The generic package codegen's errors/wording differ from a built-in's (tests asserting exact text need
  relaxing) and a package emits per-instance setup (the on-device singleton shares the object) — the accepted
  package-vs-built-in differences, `builtins-as-packages-scoping.md` §14.
- No `device-runtime/src` change in this work → no version bump (packages are inlined into the generated flow).
- Working-notes line width <120; keep `outstanding-items.md` [P3] and `decisions/node-authoring.md` current.
