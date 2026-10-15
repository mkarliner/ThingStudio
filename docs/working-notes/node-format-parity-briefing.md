# Briefing: node format parity — built-in and custom nodes are one thing

Written 2026-10-15. This continues the node-descriptor work: the descriptor is unified and the
custom-format relaxation has begun. The deliverable of the next session is the next phase of the roadmap
in `decisions/node-authoring.md`, not a re-derivation of the shape or the direction.

## Where this comes from

- `decisions/node-authoring.md` (2026-10-15) — the directive (Mike: "no difference between custom nodes
  and builtin nodes", Node-RED, "eliminate all obstacles", "don't paint yourself into a corner"), the two
  binding rules, and the phase roadmap. Read this first; it is the source of truth.
- `AGENTS.md` — "Node format parity: built-in and custom nodes are one thing" (the rules, in the loaded
  rules file).
- `outstanding-items.md` [P3] "Custom node format parity with built-ins" — the gap list and what's landed.
- `custom-node-authoring-scoping.md` — WHY the custom path is shaped this way (esp. Decision 5: the editor
  never executes package code; that divergence is deliberate and stays).
- `interfaces/node-descriptor/SPEC.md` + `custom-node.schema.json` — the two shapes (canonical descriptor;
  the custom subset).
- `node-descriptor-migration-briefing.md` — the descriptor migration proper (nearly done; `function` and
  `gui_button` are the two still-bespoke nodes).

## The target (don't re-litigate)

A node is one package: a descriptor + device-side Python behavior, loaded from a folder. Core nodes ship in
a folder ahead of the user's; same format, copyable and editable (Node-RED's model). The reviewer's parity
test: "could a built-in be rewritten as a package with no loss." The one deliberate divergence — the editor
never executes package code — stays.

## What's done (2026-10-15, this and the immediately preceding session)

- **Descriptor unified.** One `NodeDescriptor` (`compiler/node-descriptor.ts`); the canvas, palette, panel
  and catalog read it. ~36 built-ins migrated; `function` and `gui_button` are the only two still bespoke.
- **Custom `.node.json` gained** (all with schema + SPEC + tests + user-guide updates): `configRef`
  properties (the picked config's properties are inlined into the node's Python `properties`; empty id →
  `None`), multi-output `transform`s (return a list), event sources (`"eventSource": true` + `async def
  wait(properties)` then `emit`), `description`, the `pin` field kind, the field attributes
  `help`/`placeholder`/`min`/`max`/`step`/`optional`, a data-driven `visibleWhen`, and the descriptor-level
  `title`/`hidden`/`presetType`/`screenOutline`.
- **The named corner is gone:** `visibleWhen` (serializable `FieldPredicate`) replaced the function-valued
  `showIf`; nine built-ins (adc/i2c/interrupt/filter/journal/startup) migrated to data.
  `FieldPredicate` + `evaluatePredicate` live in `compiler/node-descriptor.ts`.

## The mechanism in recon form

- **Descriptor:** `NodeDescriptor` (`compiler/node-descriptor.ts`). A built-in is a `NodeDefinition`
  (`compiler/node-definition.ts`) = descriptor + codegen hooks. A custom node is `<name>.node.json` (a
  strict subset of the descriptor) + `<name>.node.py` (opaque Python spliced into the flow in a
  per-instance closure).
- **Custom validation/builder:** `node-library/custom-node.ts` (`validateCustomNodeDescriptor`,
  `buildCustomNodeDefinition`, `mergeCustomNodeRegistry`); schema
  `interfaces/node-descriptor/custom-node.schema.json`; conformance `test/node-descriptor-schema.test.ts`
  (checks the schema's enums/pattern/required/requires against `custom-node.ts`'s exports).
- **Generic panel:** `PropertyPanel.vue`'s `v-else-if="nodeDescriptor"` branch renders every field kind and
  attribute (`text`/`password`/`number`/`boolean`/`select`/`pin`/`configRef`/`credential`/`palette`;
  `help`/`placeholder`/`min`/`max`/`step`/`optional`/`visibleWhen`/`retype`; `presetType`, `screenOutline`,
  `description`). Built-ins reach it via `buildDescriptorNodeClass`; custom via `CustomNode` (both in
  `app/rete/nodes.ts`). **Two class builders still exist** — unifying them is a Phase 0/1 task.
- **Palette:** `PaletteSidebar.vue` — built-in rows from `paletteStyleFor` ∪ `palette.ts`'s legacy rows;
  custom rows from `custom-nodes-store`, honoring `hidden`.
- **Backend/distribution:** `persisted_store.custom_node_dirs` (ordered, first-folder-wins with shadow
  reporting) + `PUT /api/custom-nodes/{name}` (`write_custom_node`) + client `writeCustomNode` (unused so
  far); loader `app/custom-node-loader.ts`.

## What's next, in order

1. **Finish the built-in migration (`function`, `gui_button`)** so `palette.ts`'s last two rows go and
   every canvas node is descriptor-driven. `function` needs a textarea field kind (its `code`), a dynamic
   `outputCount` (build N outputs; live resize via `setFunctionNodeOutputCount`), and its own height rule
   (`functionNodeHeight`). `gui_button` needs dynamic placeholders (`buttonDefault`) and per-mode hint
   paragraphs. Either add the missing widgets/attributes or record these two as the documented
   built-in-only residue.
2. **`credential`/`palette` field kinds for custom nodes.** `palette` is small (the generic panel already
   renders `PaletteField`). `credential` needs the Phase 2 runtime support to be useful.
3. **Unify the two node-class builders** (`buildDescriptorNodeClass` + `CustomNode`) into one
   descriptor-driven class (per-instance for custom descriptors).
4. **Phase 2 — context parity (the real work).** Expose what built-in codegen reads as package-visible
   facilities: config singletons + credential-by-name, `findNodesOfType`/`findConfigsOfType`, wired-ness,
   `screens`, `target`/board. Close each against a concrete built-in (the "no loss" test).
5. **Phase 3 — capability parity:** dynamic ports, multi-output sources, resource claims + a real checker,
   presets, native/viper code.
6. **Phase 4 — location parity:** a core packages folder ahead of the user folder, one load path, TS codegen
   retired or demoted to a build-time generator. **Needs Mike's decision first** — the behavior model
   (built-ins as packages) and codegen's fate (generate the core `.node.py` from the TS codegen, or
   re-author core nodes as Python packages). This is the one-way-door call.

## Constraints and gotchas

- **Data-equivalent rule + one-vocabulary rule** (`AGENTS.md`) bind every addition: prefer a serializable
  form over a JS function; keep the custom `.node.json` a strict subset of `NodeDescriptor` (never a
  parallel vocabulary). Remaining function corners: `PortType`-as-function and `outputCount`.
- Interface changes (the schema, `NodeDescriptor`, `SPEC.md`) need Mike's explicit permission; the
  conformance tests must stay green and the SPEC readable (plain language, tables, an example).
- `test/node-descriptor-schema.test.ts` compares the schema's `kind` enum to `PROPERTY_KINDS` — update
  `custom-node.ts` and the schema together.
- Delete stray compiled `.js` (`find editor/src editor/test -name "*.js" -type f -delete`) before trusting
  any `tsc`/`vitest` run; prefer `./node_modules/.bin/tsc --noEmit` (root `AGENTS.md`).
- `docs/user-guide/nodes-catalog.md` is drift-tested; regenerate after any built-in descriptor change
  (command in `test/cli-describe.test.ts`).
- Working-notes line width <120; keep `outstanding-items.md` [P3] and `decisions/node-authoring.md` current
  in the same change.
- No `device-runtime/src` change in the parity work so far → no runtime version bump. A change that alters
  what `deploy_runtime.py` pushes does need one (`AGENTS.md`).

## Git state

- `HEAD = 2dfbf2f` ("node parity: custom descriptors gain title/hidden/presetType/screenOutline"), pushed
  to `https/main`. Parity commits: `6b6f92c`, `39b8539`, `2dfbf2f` (on top of the custom-format work
  `6aae6ad`/`473a6fb`/`b5a2865`).
- `tools/build-thingstudio-firmware.sh`, `tools/install-build-tools.sh` are untracked from an earlier
  session — leave them alone.
- Pushing needs a PAT: `git push "https://x-access-token:<PAT>@github.com/mkarliner/ThingStudio.git" main`
  (the `https` and SSH remotes do not authenticate from this sandbox). If the remote has moved, fetch/rebase
  first. Rotate any PAT that was pasted into a session.
