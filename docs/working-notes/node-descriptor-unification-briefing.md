# Briefing: node descriptor unification (Phase 3 — scoping)

Written 2026-10-14. This is a brief to *start* the scoping of the built-in/custom node unification — the
architecture review's concern 1. It is a brief, not a plan: the deliverable of the session that picks this up is a
settled `NodeDescriptor` shape and a migration order, and then the first family migrated with no behavior change.

## Where this comes from

- `architecture-review-continuation-briefing.md` — the two review concerns.
- `node-board-capability-mapping-briefing.md` — Phase 1 (node→board mapping) is built; this is the "a descriptor
  with no single home" half of concern 1.
- `decisions/node-board-mapping.md` (2026-10-14) — the direction Mike confirmed:
  **metadata-first `NodeDescriptor` unification + a relaxed, self-documenting custom package, not the plugin
  model.**
- `outstanding-items/node-descriptor-unification.md` — the divergence in full, and the four options (a)–(d).
- `custom-firmware-tier-note.md` (2026-10-14) — the memory/firmware review: node work is editor-side only (only
  the compiled flow and its imported libraries reach a board), so it does not gate on any firmware tier.

## What's already settled (don't re-litigate)

- `requires` now lives on **both** shapes (`NodeDefinition.requires`, `CustomNodeDescriptor.requires`), checked
  centrally (`definitions/capability-check.ts`). The canonical descriptor only has to absorb an existing field.
- The custom `.node.json` path is already the data-driven ideal; the built-in path is the outlier.
- Built-ins keep their TypeScript codegen. The one-way door (node codegen as loaded code) stays closed.

## The problem in one paragraph

A **built-in** node is described in up to seven places, all in code (below). A **custom** node is two files
(`<name>.node.json` + `<name>.node.py`) plus one generic property-panel block. There is no bridge: a built-in
can't be forked into a custom node, because its descriptor isn't exposed and the custom format can't express its
codegen. "Add a node" and "modify a node" are therefore gated on TypeScript, not on a data file a user could edit.

## Direction (Mike, 2026-10-14)

- One canonical **`NodeDescriptor`** drives the class factory, the property panel, the palette, the catalog and the
  docs. `requires` becomes a field on it.
- A custom `.node.json` is a **serialization of the same shape**, minus codegen.
- Relax the custom format so more built-ins can be cloned: multi-output, config references, event sources.
  Feasibility from the briefing: multi-output (≤1 cap) relaxable — the compiler already supports it; config
  references relaxable (add a `configRef` property kind, precedent `app/rete/config-types.ts`); event sources
  relaxable with a defined contract; dynamic ports (`function`'s `outputCount`) left special; compile-time
  resource claims a documented limit (a custom node uses `runtime.shared` only); executable codegen stays out.
- Packages are **self-documenting**: a `<name>.node.md` (or a descriptor `description`), shown in the editor,
  sanitized.
- Migrate **family by family, no behavior change**.

## The shape to settle (open questions for the scoping session)

1. **Data vs. widened `NodeDefinition`.** Metadata-first implies a plain data descriptor that the class factory
   and the panel read, with the TS `codegen*` hooks kept alongside (a built-in's descriptor + codegen). Is the
   canonical thing a new `NodeDescriptor` type in a shared module, with `NodeDefinition` produced/composed from
   it? Where does it live so both `app/` and `compiler/` may read it without breaking module boundaries (below)?
2. **Property UI.** Today a per-kind `v-else-if` block in `PropertyPanel.vue`, plus `config-types.ts` field
   descriptors. A generic panel needs a property schema per node. What does a property descriptor look like
   (kinds today: text/password/number/select/boolean/credential/configRef/pin), and can the existing bespoke
   blocks be expressed as it?
3. **Ports, declared twice.** `NodeDefinition.ports` (payload types) and `nodes.ts` (`addInput`/`addOutput` socket
   classes + keys). Can the class factory derive the Rete sockets from the descriptor's ports, removing the second
   declaration?
4. **What still forces a code block.** Palette styling is already one place (`palette.ts`); `requires` is on the
   definition. Enumerate what genuinely can't be data (the `function` node's dynamic ports/verbatim code, the GUI
   nodes' two-faced behaviour) so the descriptor doesn't over-reach.
5. **Migration unit.** A "family" (e.g. the GPIO family: gpio_out, pwm_out, adc, interrupt, eswitch, ebutton,
   encoder, neopixel) or a codegen pattern (all sinks, all sources)? The first family should be small and low-risk.

## The seven places a built-in is described today

1. `editor/src/node-library/<name>.ts` — the `NodeDefinition` (codegen, `requires`).
2. `editor/src/node-library/registry.ts` — registration in `buildRegistry()`.
3. `editor/src/app/rete/nodes.ts` — `NODE_FACTORIES`, the class, its sockets and default properties.
4. `editor/src/app/rete/palette.ts` — colour/icon/group/priority.
5. `editor/src/app/rete/PropertyPanel.vue` — a bespoke `v-else-if` block per kind; config fields in
   `app/rete/config-types.ts`.
6. `editor/src/cli/describe.ts` — `PROPERTY_NOTES`, the config-property map, the catalog.
7. `docs/user-guide/nodes/<name>.md` — plus the `docs/node-conventions.md` checklist and tests.

## Interfaces and boundaries

- **Node descriptor interface** — `interfaces/node-descriptor/SPEC.md` + `custom-node.schema.json`, conformance in
  `editor/test/node-descriptor-schema.test.ts`. A shape change is Mike's-permission-in-session; the direction
  above *is* that permission, but confirm the concrete shape before writing it.
- **Module boundaries** — `editor/test/module-boundaries.test.ts`: `app/` is the top layer; `compiler/` may not
  import `node-library/` or `app/`. The canonical descriptor has to sit where both the compiler and the canvas can
  see it (today `NodeDefinition` is in `compiler/`, the class in `app/` — a shared descriptor type may need a new
  home, or `compiler/` may legitimately own the data type and `app/` read it, as it already does for
  `NodeDefinition`).
- **Runtime API** — unaffected: a node's descriptor is editor-side; only its codegen and imports reach a board.

## First actions for the scoping session

1. Read `docs/node-conventions.md`, `interfaces/node-descriptor/SPEC.md` §1–4, and two or three node families end
   to end (suggest `debug`/`inject` for simple, and the GPIO family for a real cluster).
2. Prototype a `NodeDescriptor` **data object** for one small family, with (a) a generic property-panel block and
   (b) the class factory both reading it, and the existing `NodeDefinition` produced from it — enough to see the
   shape, not a full migration.
3. Decide the migration unit and write the order.
4. Migrate the first family, no behavior change, with the existing node tests as the guard.

## Recon facts (so the next session doesn't re-read all of this)

- **`NodeDefinition`** (`editor/src/compiler/node-definition.ts`): `type`, `kind`, `allowUnwired`, `requires`,
  `ports`, `outputCount`, `codegenSource`/`codegenEventSource`/`codegenTransform`/`codegenSink`.
- **`CustomNodeDescriptor`** (`editor/src/node-library/custom-node.ts`): `type`/`kind`/`label`/`color`/`bgcolor`/
  `icon`/`group`/`priority`/`ports`/`properties`/`requires`; `validateCustomNodeDescriptor`,
  `buildCustomNodeDefinition`, `mergeCustomNodeRegistry`.
- **Property sources**: `app/rete/PropertyPanel.vue` (per-kind `v-else-if`); `app/rete/config-types.ts`
  (`ConfigFieldDescriptor`, kinds text/password/number/select/credential/boolean/configRef/pin); `describe.ts`
  `PROPERTY_NOTES`.
- **Catalog**: `describe.ts` `buildCatalog()` reads `NODE_FACTORIES` + `buildRegistry()` + `NODE_PALETTE` +
  `PROPERTY_NOTES`; `renderMarkdown()` produces `docs/user-guide/nodes-catalog.md`.
- **Tests**: `editor/test/node-<name>.test.ts` per node; `custom-node.test.ts`; `node-descriptor-schema.test.ts`;
  `cli-describe.test.ts` (fails when the catalog is stale).

## Git state

- `HEAD = 49db12d` (Phase 1 of the capability mapping, pushed). The Phase 2 note (`custom-firmware-tier-note.md`)
  and this brief are uncommitted at the time of writing.
