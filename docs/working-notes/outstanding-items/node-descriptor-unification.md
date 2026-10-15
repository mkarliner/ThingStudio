# Node descriptor: unify built-in and custom node handling — Mike's concern, not scoped

Raised by Mike during the 2026-10-14 architecture review: built-in nodes and custom nodes are handled as two
different systems, and "they should all be implemented the same so users can modify them."

Today (see `interfaces/node-descriptor/SPEC.md` §4):

- A **built-in** node is TypeScript: a `NodeDefinition` (`editor/src/compiler/node-definition.ts`) with Python
  codegen, a bespoke class in `editor/src/app/rete/nodes.ts`, a palette row in `palette.ts`, a bespoke
  `v-else-if` block in `PropertyPanel.vue`, a `PROPERTY_NOTES` entry, a docs page and tests — up to seven places
  per node, all in code.
- A **custom** node is data: `<name>.node.json` + `<name>.node.py`, one generic property-panel block, loaded from
  `~/.thingstudio/custom-nodes/`. The custom format deliberately can't express codegen (a browser-loaded editor
  can't safely execute arbitrary codegen), config references, dynamic/multi ports, event sources, or resource
  claims.

So the custom path is already the data-driven ideal; the built-in path is the outlier. There is no bridge — a
built-in can't be forked into a custom node.

Options, none chosen (from the review discussion): (a) expand the custom descriptor so built-ins can be
re-implemented on it; (b) expose each built-in's descriptor and generated Python and add a "clone to custom node"
that seeds an editable package; (c) move the per-node property UI into the descriptor so `PropertyPanel` renders
every node generically; (d) a full plugin model where built-ins load through the same package path as custom nodes
(the real one-way door — it makes node codegen loaded code, with the trust implications `custom-node.ts` currently
rejects).

The decision to surface: converge on the *data* format (achievable now, cheaply) or on the *execution* model
(a security/architecture change). Related: the node→board applicability gap
(`board-specific-node-collections.md`, `editor-board-awareness.md`), which also needs a home on whatever descriptor
becomes canonical.

**2026-10-14:** the node→board part is built (`decisions/node-board-mapping.md`): `requires` now lives on both
descriptor shapes, so the canonical one only has to absorb an existing field. The memory/firmware review that was
to precede settling this is written (`custom-firmware-tier-note.md`): a firmware tier is a device-packaging
decision and does **not** gate any node work, because node descriptors/panel/docs are editor-side only (only the
compiled flow and its imported libraries reach a board). What remains here is the built-in/custom split itself.
**Scoping brief to start it:** `../node-descriptor-unification-briefing.md` (the settled direction, the shape
questions to answer, the seven places a built-in lives, and the first actions).

**2026-10-14 (continuation), option (a)+(c) chosen and started:** metadata-first convergence, built
(`decisions/node-board-mapping.md`'s "descriptor unification, family 1"). The canonical `NodeDescriptor`
(`compiler/node-descriptor.ts`) exists, `NodeDefinition` composes it, one generic descriptor-driven class +
property-panel path + palette/catalog lookups read it, and **`debug` is migrated** (option (c): the per-node
property UI now comes from the descriptor; option (a): the custom `.node.json` is to become the same shape,
minus codegen). `interfaces/node-descriptor/SPEC.md` is now v2. Remaining work, in order:

1. Move the remaining built-in families onto the descriptor, per the briefing. Done: `debug`, then `timer`/
   `delay` and `gpio_out`/`pwm_out` (the latter added the generic `pin` field, wrapping `PinField`), then
   `touch_i2c`, `i2c`, `bme280`, and the whole network family -- `udp_send`, `udp_receive`, `http_request`,
   `http_in`, `http_response`, `mqtt_publish`, `mqtt_subscribe`, `ntp` (new 2026-10-14, replaces `clock`). The
   generic panel gained `configRef` (wrapping `ConfigRefField`), `credential`/`password`, a `placeholder` field,
   and two shape changes Mike approved 2026-10-15: `PropertyFieldOption.value` widened to `string | number`
   (`bme280`'s address, mqtt `qos`), and a field with no `name` is **info-only** (renders the widget, binds to
   no property -- the display-only WiFi picker on every network node). The GPIO cluster
   (`interrupt`/`eswitch`/`ebutton`/`adc`/`encoder`/`neopixel`) is done too -- it needed no new widget
   (`select`/`boolean`/`showIf`), only a catalog regeneration for two nodes whose descriptor order follows the
   panel rather than the old class order. Then `filter`/`journal`/`wifi_status`/`wifi_gate` (a third shape
   change Mike approved 2026-10-15: `step` widened to `number | "any"` for fractional fields); the generic
   class now also grows taller for a multi-output node, matching journal's old height. Still bespoke, needing
   the dynamic-ports mechanism (an output whose socket type follows a property): `inject`/`startup`
   (`payloadType` retypes the output) and `function` (dynamic `outputCount`). Also still bespoke: `display_spi`/
   `display_i2c` (use `PresetRefField`, which the generic panel doesn't render yet) and the nine `gui_*` nodes.
   Then make `palette.ts`'s rows go away.
2. Relax the custom `.node.json` format (multi-output, `configRef` properties, event sources) so more built-ins
   can be cloned, and add the package's own docs (`description`/`.node.md`, sanitized).
3. Still out: dynamic ports and arbitrary codegen stay built-in-only; compile-time resource claims stay a
   documented limit; the plugin model (option (d)) remains the one-way door, not taken.

**Per-family handoff for picking this up:** `../node-descriptor-migration-briefing.md` (the mechanism in recon
form, the per-family loop, the `configRef`/info-only wrinkle, and the git state).

