# Briefing: node→board capability mapping (Mike's two concerns) — 2026-10-14

Handoff for whoever picks this up next (Mike is changing machines). This session started from the architecture
review's two open concerns and its recommendations; the interface work is committed, and this note carries the
plan for the concerns themselves so the next machine doesn't re-derive any of it.

## Where this came from

`architecture-review-continuation-briefing.md` (the review) and then Mike's own two concerns, raised at the start
of the session:

1. **Node palette handling** — built-in and custom nodes are handled as two different systems; "they should all be
   implemented the same so users can modify them." A built-in is described in up to seven places (code + docs); a
   custom node is two files plus one generic UI block.
2. **No node→board mapping** — some nodes are only appropriate on certain boards or processor families (ESP-NOW on
   ESP32, PIO on RP2040/RP2350). Nothing on a node says what hardware it needs; the palette offers everything
   everywhere and a mismatch fails only at deploy.

## Decisions Mike confirmed (2026-10-14)

- **Order:** node→board mapping first, done on the two *existing* descriptor shapes (`NodeDefinition` and
  `CustomNodeDescriptor`). The full descriptor unification can later absorb `requires`.
- **Model:** explicit `capabilities` on processor/board definitions + `requires` on nodes; a central compile-time
  check (not per-node codegen). This is the general mechanism that lets a custom node participate too.
- **Palette:** when a target is known and a node can't run on it, grey/disable it but keep it visible; show
  everything when no target is known.
- **Fold `board.wifi` into the capability vocabulary** (recommended, accepted) so there aren't two notions of
  "has a radio".
- **Concern 1 (later):** metadata-first descriptor unification + a relaxed, self-documenting custom package — *not*
  the full plugin model. Custom node packages carry their own docs; relax custom-node restrictions so more built-ins
  can be cloned; do a memory / custom-firmware review before settling the approach.

Recorded in `decisions/node-board-mapping.md` and indexed in `decisions.md`.

## Phase 1 — node→board mapping (planned, **no code written yet**)

1. **Capability vocabulary.** Add `capabilities: string[]` to processor and board JSON, parsed into
   `ProcessorDef`/`BoardDef` (`editor/src/definitions/definitions.ts`; add to `PROCESSOR_KEYS`/`BOARD_KEYS`).
   Add `capabilities: ReadonlySet<string>` to `Target`, computed by `effectiveCapabilities()` in
   `editor/src/definitions/target.ts` = union(processor, board), then applied against the existing `board.wifi`
   tri-state (`wifi === false` removes "wifi"; `wifi === true` adds it). Suggested built-in values:
   esp32 / esp32-s2 / esp32-s3 / esp32-c3 → `["wifi","ble","espnow"]`; rp2040 / rp2350 → `["pio"]`; `pico-w`
   already sets `wifi: true` (adds it), `pico`/`pico-2` set `wifi: false` (denies it).
2. **Node `requires`.** Add `requires?: { capabilities?: string[] }` to `NodeDefinition`
   (`editor/src/compiler/node-definition.ts`) and `CustomNodeDescriptor` (`editor/src/node-library/custom-node.ts`
   + its validator), and carry it through `buildCustomNodeDefinition`.
3. **Central check.** New `editor/src/definitions/capability-check.ts` (sibling of `pin-check.ts`), called from
   `compile()` for every node. Target known + a required capability missing → `CompileError` naming node, target
   and the capability. No target → a warning via `ctx.warn` (deduped), never a block. Because it is central,
   custom nodes are covered even though their Python can't call it.
4. **Palette grey/disable.** `editor/src/app/rete/PaletteSidebar.vue` reads each row's `requires` (from
   `buildRegistry()` for built-ins, `descriptor.requires` for custom) and `activeTarget` (`store.ts:212`); unmet →
   `disabled` row with a tooltip; no target → enabled. This is the first palette consumer to read a node descriptor
   rather than `NODE_PALETTE`, so it is a small down-payment on Phase 3.
5. **Catalog / CLI.** Surface `requires` in `editor/src/cli/describe.ts` (`NodeInfo`) and the generated
   `nodes-catalog.md`; include it in the CLI `--board` check.
6. **Interface artifacts + conformance.** Extend `interfaces/node-descriptor/` (SPEC + `custom-node.schema.json`)
   and `interfaces/board-descriptor/` (SPEC + `board.schema.json`/`processor.schema.json`) for `requires` /
   `capabilities`; extend `editor/test/node-descriptor-schema.test.ts` and `board-descriptor-schema.test.ts`; add a
   capability-check test.
7. **ADC2 migration (included).** Move `adc.ts`'s hardcoded `ADC2_PINS` into the ESP32-family processor JSON
   (`adc2` pin list), parse it in `definitions.ts`, have `adc.ts` read `ctx.target.processor.adc2`. Closes
   `outstanding-items/adc-esp32-adc2-pins.md`. ADC2 is a pin-group + WiFi interaction (not a boolean capability),
   so it stays a codegen rule reading target *data* — but the data belongs in the definitions.

ESP-NOW itself is out of scope: Phase 1 is the mechanism that makes such a node expressible and correctly gated.

## Recon facts (so the next session doesn't re-read all of this)

- **`definitions.ts`** — `PROCESSOR_KEYS`/`BOARD_KEYS` (now exported for the schema test), `parseProcessor`,
  `parseBoard`, `parsePinSpec`, `pinList`, `pinReasons`, `subset`, `buildDefinitionSet`. `BoardDef.wifi` is
  `boolean | null` (null = not stated) at line ~73.
- **`target.ts`** — `Target` (processor, board, label, gpio, inputOnly, noPull, reserved, avoid, pinLabels);
  `buildTarget(processor, board)` is where `capabilities` goes; `detectFromChipType`, `resolveTarget`.
- **`pin-check.ts`** — the model for a compile-time target check: `checkPin`/`checkSpi`/`checkI2c`, `ctx.target`,
  `ctx.warn` for the no-target case. Mirror this shape.
- **`compile.ts`** — `ctx` is built around line 225 (`target: options.target ?? null`, `warn` dedupes into a Set);
  per-node checks sit at ~94 (`unknown node type`) and ~214 (`disconnected`). Put the capability check after `ctx`
  exists so it can warn.
- **`custom-node.ts`** — `PAYLOAD_TYPES`, `NODE_KINDS`, `PROPERTY_KINDS`, `TYPE_ID_RE` (now exported for the
  schema test), `validateCustomNodeDescriptor`, `buildCustomNodeDefinition`, `mergeCustomNodeRegistry`.
- **`palette.ts`** — `NODE_PALETTE` (KindStyle: color/bgcolor/icon/label/group/priority/hidden).
  **`PaletteSidebar.vue`** — `allRows`/`groupedRows`/`onRowClick`/`onRowDragStart`. **`store.ts:212`**
  `activeTarget = shallowRef<Target | null>`.
- **`describe.ts`** — `buildCatalog()` reads `NODE_FACTORIES` + `buildRegistry()` + `NODE_PALETTE` + `PROPERTY_NOTES`.
- **`adc.ts`** — `WIFI_NODE_TYPES`, `flowUsesWifi(ctx)`, `ADC2_PINS` (the stopgap), `processorId = ctx.target?.processor.id`.
- **Interface dirs** — `interfaces/node-descriptor/{SPEC.md,custom-node.schema.json}`,
  `interfaces/board-descriptor/{SPEC.md,board.schema.json,processor.schema.json}`; conformance/runner list in
  `interfaces/README.md`. Per the project rule, changing these descriptor shapes needs Mike's explicit permission —
  this plan is that permission, already given.
- Built-in definition files: `editor/src/definitions/processors/*.json` (6), `boards/*.json` (7).

## Phase 2 — memory / custom-firmware review (concern 1 input)

`frozen-firmware-spike-briefing.md` already answers most of it (spike closed, 2026-10-08):

- Freezing saves ~75% of the heap those modules use (unix port; `mqtt_as`, GUI, fonts dominate), and a pushed
  `/lib` copy can override a frozen one if `/lib` precedes `.frozen` on `sys.path`. So an optional firmware tier is
  feasible without forcing a reflash on every runtime change.
- Deferred as an optional, supported-boards-only tier. ROMFS is the build-once alternative (off in stock builds).
- `tools/build-thingstudio-firmware.sh` (untracked, Mike's) builds a MicroPython image with the runtime + `mqtt_as`
  frozen.

What the review still needs to say: moving node descriptors / adding docs is **editor-side only** — only the
compiled flow (with `.node.py` spliced in) and per-deploy libraries reach a board, so it has no device-memory
impact. The one real device lever is what a node *imports*, already scoped by flow-dependencies. Deliverable: a
short decision-ready note on what a "Thingstudio firmware" tier contains and how the node work relates.

## Phase 3 — unify built-in & custom (concern 1), shaped by Mike's notes

Direction: metadata-first `NodeDescriptor` unification + a relaxed, self-documenting custom package. Relaxation
feasibility:

- multi-output (the ≤1 cap) — relaxable; the compiler already supports it (`function`).
- config references — relaxable; add a `configRef` property kind (precedent: `app/rete/config-types.ts`).
- event-driven sources — relaxable with a defined contract.
- dynamic ports (`function`'s `outputCount`) — leave; genuinely special.
- compile-time resource claims (`claimResource`) — a custom node can only use `runtime.shared`; documented limit.
- executable codegen — stays out (that is the plugin model / one-way door).

Docs in the package: a `<name>.node.md` (or a descriptor `description`), shown in the editor, sanitized. One
canonical `NodeDescriptor` drives the class factory, panel, palette, catalog and docs; `requires` becomes a field on
it; custom `.node.json` is a serialization of the same shape. Migrate family by family, no behavior change. Full
write-up of the divergence: `outstanding-items/node-descriptor-unification.md`.

## Git state

- `HEAD = 22ba7d0`, working tree clean except two untracked pre-existing scripts (`tools/build-thingstudio-firmware.sh`,
  `tools/install-build-tools.sh`) — not ours, leave them.
- Committed this session: `1c96358` protocol spec+vectors, `7aceeb8` runtime-api spec, `dff9e8a` node/board
  descriptor specs, `117685c` boundary enforcement, `22ba7d0` cbor.py float fix. (Plus Mike's own `2f275d9`.)
- No Phase 1 code is committed yet; start at step 1 above.

## First action next session

Phase 1, step 1: add `capabilities` to `definitions.ts` + the processor/board JSON, add `Target.capabilities` via
`effectiveCapabilities()`, then `requires`, then the central check, then the palette. Verify with `npm test`,
`./node_modules/.bin/tsc --noEmit`, and the descriptor-schema conformance tests. Environment: `mpy-cross` /
`micropython` are not built here (only needed if `device-runtime/src` changes — Phase 1 doesn't).
