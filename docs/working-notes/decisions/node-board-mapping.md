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
