# Decisions — Node ↔ board mapping

Status: detail file, started 2026-10-14. See `decisions.md` for the index, the log's scope boundary, and its
maintenance rule. Plan and full recon: `../node-board-capability-mapping-briefing.md`.

- **2026-10-14 — A node can declare what hardware it needs, and the compile checks it.** This resolves Mike's
  "no acknowledgement of node-board mapping" concern (some nodes are only valid on certain boards/processor
  families — ESP-NOW on ESP32, PIO on RP2040/RP2350). Model, Mike's confirmed call: an explicit `capabilities`
  set on processor and board definitions, and `requires: { capabilities: [...] }` on the node descriptor; a central
  compile-time check (sibling of `pin-check.ts`) compares them and fails with a `CompileError` naming node, target
  and the missing capability. Central, not per-node codegen, so custom nodes are covered too. No target known →
  a warning, never a block.
- **2026-10-14 — Palette greys out unmet nodes rather than hiding them.** When a target is known and a node's
  capability requirement isn't met, the palette row is disabled with a tooltip but stays visible; with no target,
  everything is shown normally. (Chosen over hiding, which is the separate, later "board-specific node collections"
  item; over "rely on the compile error alone", which hides the problem until deploy.)
- **2026-10-14 — `board.wifi` folds into the capability vocabulary.** The existing `wifi: boolean|null` field
  (WiFi-transport readiness) becomes one capability among others, reconciled in `Target.capabilities`, so there is
  one notion of "has a radio". The tri-state is preserved: `false` denies, `true` adds, unstated defers to the
  processor.
- **2026-10-14 — Node→board mapping goes first, on the current two descriptor shapes.** `requires` lands on
  `NodeDefinition` (built-in) and `CustomNodeDescriptor` (custom) now; the later descriptor unification absorbs it.
  Rationale: smaller, and it makes ESP-NOW-class nodes expressible and correctly gated sooner.
- **2026-10-14 — Built-in/custom unification: metadata-first, self-documenting, relaxed — not the plugin model.**
  Mike's direction for the second concern: one canonical `NodeDescriptor` driving class/panel/palette/catalog/docs
  (built-ins keep TS codegen); custom packages carry their own docs; relax the custom-node restrictions (multi-
  output, config refs, event sources) so more built-ins can be cloned. The full plugin model (built-ins as loaded
  packages) stays the one-way door, not taken. A memory / custom-firmware review precedes settling it.

## Built (2026-10-14)

Phase 1 landed on the two existing descriptor shapes, as planned:

- **Capability vocabulary** -- `capabilities: string[]` on processor and board JSON (`ProcessorDef`/`BoardDef`,
  `PROCESSOR_KEYS`/`BOARD_KEYS`), reconciled into `Target.capabilities` by `effectiveCapabilities()`, which folds
  `board.wifi` in (false denies "wifi", true adds it). Built-in values: ESP32/S3/C3 get `wifi`/`ble`/`espnow`,
  S2 `wifi`/`espnow` (no Bluetooth), RP2040/RP2350 `pio`; WiFi boards are the `wifi: true`/`false` boards.
- **Node `requires`** -- `requires: {capabilities: [...]}` on `NodeDefinition` and a custom `.node.json`
  descriptor, carried by `buildCustomNodeDefinition`.
- **Central check** -- `definitions/capability-check.ts`, called once per node from `compile()`. Known target
  missing a capability: `CompileError` naming node, target and what's missing. No target: a warning, never a
  block.
- **Palette** -- `PaletteSidebar.vue` greys out and disables a row whose capability the target lacks, keeping it
  visible with a tooltip; everything shows with no target.
- **Catalog / CLI** -- `requires` surfaces in `describe.ts`/`nodes-catalog.md`; `--board-info` lists the target's
  `capabilities`.
- **ADC2 migration** -- `adc.ts`'s hardcoded `ADC2_PINS` moved to an `adc2` pin list on each ESP32-family
  processor file, parsed into `ProcessorDef.adc2`
  (`outstanding-items/adc-esp32-adc2-pins.md`, closed).

No built-in node declares `requires` yet: ESP-NOW/PIO nodes are the point of the mechanism, not part of it. The
interface change (board/processor descriptor `capabilities`/`adc2`, node `requires`) was the permission Mike gave
the 2026-10-14 session (`interfaces/board-descriptor/`, `interfaces/node-descriptor/`).
