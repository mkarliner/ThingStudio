# Briefing: node descriptor migration — continue family by family

Written 2026-10-14. This continues the scoping brief's work
(`node-descriptor-unification-briefing.md`): the shape is settled, the mechanism is built, and five node
families are migrated. The deliverable of the session that picks this up is more families migrated with no
behavior change, in the order below — not a re-derivation of the shape.

## Where this comes from

- `node-descriptor-unification-briefing.md` — the scoping brief (the shape questions, the seven places a
  built-in used to live, the migration order). Read it first; this file assumes it.
- `decisions/node-board-mapping.md` — the direction ("descriptor unification, family 1" section has what
  landed).
- `outstanding-items/node-descriptor-unification.md` — the live checklist; keep it current as you go.
- `interfaces/node-descriptor/SPEC.md` — now **v2**: the canonical `NodeDescriptor`, worked example, and what's
  still coming. Interface shape is settled; changing it again needs Mike's permission.

## What's done (don't re-litigate)

The canonical `NodeDescriptor` (`editor/src/compiler/node-descriptor.ts`) exists; `NodeDefinition`
(`compiler/node-definition.ts`) composes it with the codegen hooks. One generic Rete class
(`nodes.ts`'s `buildDescriptorNodeClass(descriptor)`) and one lookup
(`app/rete/node-descriptors.ts`'s `descriptorFor`/`paletteStyleFor`) drive the canvas, palette, property panel
and catalog. Migrated families: **`debug`, `timer`, `delay`, `gpio_out`, `pwm_out`, `touch_i2c`, `i2c`,
`bme280`, the whole network family (`udp_send`, `udp_receive`, `http_request`, `http_in`, `http_response`,
`mqtt_publish`, `mqtt_subscribe`, `ntp`), the GPIO cluster (`interrupt`, `eswitch`, `ebutton`, `adc`,
`encoder`, `neopixel`), and `filter`/`journal`/`wifi_status`/`wifi_gate`**. The generic property panel gained
`configRef` (wrapping `ConfigRefField`), `credential` (wrapping `CredentialRefField`), `password`,
`placeholder`, a numeric `select` option (`PropertyFieldOption.value: string | number`), `step: "any"`, and an
**info-only field** (a field with no `name` renders its widget but binds to no property -- the display-only
WiFi picker on every network node). The generic class also grows taller for a multi-output node (journal's old
height). Mike approved the `placeholder`, numeric-option, info-only and `step: "any"` shape changes
2026-10-15. No behavior change (node-<name> tests + the catalog are the guard; full `npm test` green).

`palette.ts`'s per-kind rows are optional during migration: a descriptor with a `paletteId` is "migrated" and
`paletteStyleFor` reads it; one without still falls back to `palette.ts`. `NODE_PALETTE` is now
`Partial<Record<NodeKind, KindStyle>>`, so `palette.ts` can simply omit a migrated kind's row.

## The mechanism in recon form (so you don't re-read everything)

- **Descriptor metadata** lives on the `NodeDefinition` in `editor/src/node-library/<name>.ts`:
  `paletteId`/`label`/`group`/`priority`/`color`/`bgcolor`/`icon`/`width`/`description`, plus `properties`
  (`PropertyFieldDescriptor[]`: `{name?,label,kind,default?,options?,configType?,credentialType?,help?,
  placeholder?,optional?,min?,max?,step?,showIf?}`; `options[].value` is `string | number`, `step` may be
  `"any"`). A field with no `name` (and no `default`) is info-only. Copy the values from the old `palette.ts`
  row and the old `PropertyPanel.vue` block — the goal is byte-identical behavior.
- **The generic class** derives width, title, ports and default properties from the descriptor (and grows
  taller by 20px when there's more than one output). Keep the
  exported class name (e.g. `export class TimerNode extends buildDescriptorNodeClass(timerNode) {}`) —
  tests and `AnyThingstudioNode` reference these names even though the body is now empty.
- **The property panel's generic branch** (`PropertyPanel.vue`, `v-else-if="nodeDescriptor"`, last in the
  `v-if` chain) renders `text`/`password`/`number`/`boolean`/`select`/`pin`/`configRef`/`credential`, with
  `min`/`max`/`step`/`placeholder`/`showIf`. It uses `nodeProperties`/`setProp` (already defined). Remove the
  old per-kind `v-else-if` block once migrated.
- **Palette** (`palette.ts`) delete the row; (`PaletteSidebar.vue`) already enumerates legacy keys ∪ descriptor
  keys via `builtinDescriptors()`, so nothing else to do. **Catalog** (`cli/describe.ts`) uses
  `paletteStyleFor` and the registry; it must come out byte-identical unless you mean to change it.

## Per family, the loop

1. Add descriptor metadata + `properties` to `node-library/<name>.ts`.
2. Delete the bespoke class in `nodes.ts`; add `export class <Name> extends buildDescriptorNodeClass(<name>Node) {}`.
3. Delete the `palette.ts` row.
4. Delete the `PropertyPanel.vue` `v-else-if="node.kind === '<kind>'"` block (unless it uses a widget the
   generic branch doesn't yet render — see below).
5. `find editor/src editor/test -name "*.js" -type f -delete`; `./node_modules/.bin/tsc --noEmit`; `npm test`;
   `npm run build`. The catalog test fails loudly if the generated `docs/user-guide/nodes-catalog.md` drifts.

## What's next, in order

1. **Done:** `debug`/`timer`/`delay`/`gpio_out`/`pwm_out`, the I2C family (`touch_i2c`/`i2c`/`bme280`), the
   network family (`udp_send`/`udp_receive`/`http_request`/`http_in`/`http_response`/`mqtt_publish`/
   `mqtt_subscribe`/`ntp`), the GPIO cluster (`interrupt`/`eswitch`/`ebutton`/`adc`/`encoder`/`neopixel`), and
   `filter`/`journal`/`wifi_status`/`wifi_gate`. The shape changes that unblocked them landed 2026-10-15
   (Mike): `PropertyFieldOption.value` is `string | number`, a field with no `name` is info-only (the
   display-only WiFi picker on each network node, via `fieldValue`/`setField` in `PropertyPanel.vue`), and
   `step` may be `"any"`. The generic class now also grows taller for a multi-output node (journal's old
   height). One catalog regeneration: `eswitch`/`ebutton` descriptor property order follows their panel, not
   their old class order (generated doc only).
2. **Still bespoke — needs the dynamic-ports mechanism (an output whose socket type follows a property):**
   `inject`/`startup` (`payloadType` retypes the output) and `function` (dynamic `outputCount`). The generic
   class builds sockets once in its constructor, so it needs an optional hook to re-run `portSocket` (or a
   `retypeOutput`) when a property changes. Either add that hook or leave these three hand-written (the
   briefing allows this).
3. **Still bespoke — display and GUI:** `display_spi`/`display_i2c` (use `PresetRefField`, which the generic
   panel doesn't render yet) and the nine `gui_*` nodes (`guiClass`; some use `ConfigRefField`/screen
   geometry).
4. **Then close the transitional state:** once every family is migrated, make the palette metadata required on
   `NodeDescriptor`, delete `palette.ts`'s now-empty rows (keep `DEFAULT_NODE_GROUPS`/`DEFAULT_KIND_STYLE`), and
   simplify `paletteStyleFor`.
5. **Relax the custom `.node.json`** (separate, later): multi-output (the compiler supports it), `configRef`
   properties, event sources, plus the package's own docs (`description`/`<name>.node.md`, sanitized). The
   custom format's surface is unchanged today; changing it needs Mike's permission and a `custom-node.schema.json`
   + conformance-test update.

## Constraints and gotchas

- **No behavior change** is the bar for a migration step. The catalog and node tests are the guard; a UI-only
  regression (a label, a width, a hint) won't be caught by tests — diff the old panel/palette values carefully.
- **Do not change interface shape** without Mike. Adding a `PropertyFieldKind` (e.g. `configRef` is already in
  the union; a new widget kind is not) is a shape question — raise it.
- `palette.ts`'s `NodeKind` union still lists every kind (including migrated ones) because `NODE_FACTORIES` is
  keyed by it. Don't remove names from the union when deleting rows.
- `NODE_PALETTE` being `Partial` means `NODE_PALETTE[kind]` can be undefined — go through `paletteStyleFor`.
- Delete stray compiled `.js` before trusting any `tsc`/`vitest` run (root `AGENTS.md`).
- Working-notes line width <120; keep `outstanding-items/node-descriptor-unification.md` and
  `decisions/node-board-mapping.md` updated in the same change.

## Git state

- `HEAD = b09da5d` ("node descriptor: migrate timer/delay and gpio_out/pwm_out"), pushed to `https/main`.
  `0ff8bd1` is the mechanism + `debug`.
- `tools/build-thingstudio-firmware.sh` and `tools/install-build-tools.sh` are untracked from an earlier
  session — leave them alone.
