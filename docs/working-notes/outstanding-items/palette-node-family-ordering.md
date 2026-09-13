# Palette ordering: an explicit priority field per node, replacing the hardcoded source-then-sink list

Mike's clarification, 2026-09-13, of the old, ambiguous "arrange to menu to better reflect workflow
(connect/open/save...)" bullet in `mikes-questions-and-points.md` -- originally read as being about a top-level
menu/toolbar. **It's actually about the node palette**: related nodes (his example: `mqtt_publish`/
`mqtt_subscribe`) should sit next to each other, not be split apart by the palette's current ordering rule.

## The bug, confirmed in the actual code

`PaletteSidebar.vue`'s `KINDS` array is one hardcoded, global source-then-sink display order (sources first,
then transforms, then sinks) applied across every kind, independent of `palette.ts`'s `group` field. Within the
`"network"` group this splits every multi-node protocol family apart, not just mqtt: `mqtt_subscribe`/
`mqtt_publish` end up 4 positions apart, `udp_receive`/`udp_send` similarly split, and `http_in`/`http_request`/
`http_response` are split three ways across the source/transform/sink boundary.

## Resolved design (Mike, 2026-09-13)

- **`group` stays exactly as it is** -- no finer-grained groups, no new "family" concept. `general`/`network`/
  `hardware` (`palette.ts`'s `DEFAULT_NODE_GROUPS`) remain the only built-in groups; a custom node's own novel
  `group` value is still appended after them, in first-seen order -- both unchanged from today.
- **New explicit `priority` field** (numeric), added to both `KindStyle` (`palette.ts`, built-in nodes) and
  `CustomNodeDescriptor` (`custom-node.ts`, custom nodes) -- controls display order *within* a node's group.
  Every node (built-in or custom) carries its own order as real data on its own definition, rather than an
  implicit convention enforced by a separately-maintained array elsewhere.
- **`PaletteSidebar.vue`'s `KINDS` array is removed entirely.** `groupedRows`' per-group `rows` sort by
  `priority` instead of relying on `KINDS`' position. This is the actual fix: once `mqtt_subscribe`/
  `mqtt_publish` (or any other pair) can be assigned adjacent priority numbers directly, there's no more
  separate ordering convention to fight with.
- **Custom nodes still land at the end of their group** by default (no priority declared = sorts after every
  built-in entry that does) -- consistent with "custom nodes' own group is appended at the end" already being
  the existing behavior for a *novel* group; this is the same idea applied within a shared group too.

## What implementing this actually needs

- Schema: add `priority: number` to `KindStyle` (`palette.ts`) and to `CustomNodeDescriptor`
  (`custom-node.ts`/`validateCustomNodeDescriptor`) -- optional on the custom-node side (undefined sorts last),
  required (or defaulted) on every built-in `KindStyle` entry.
- A real priority-number pass across every existing built-in kind, replacing what `KINDS`' array position used
  to encode implicitly -- this is the actual content decision (which numbers go where), not an architecture
  question anymore. Reasonable default: reuse round numbers per group (10, 20, 30, ...) so inserting a new node
  between two existing ones later doesn't require renumbering everything.
- `PaletteSidebar.vue`'s `groupedRows` computed: sort each group's `rows` by `priority` (stable sort, so two
  nodes sharing a priority keep whatever order they were encountered in) instead of relying on `KINDS`.
- Docs: `docs/user-guide/custom-nodes.md`'s node-definition reference gets the new `priority` field documented
  alongside `group`.

No open design questions remain -- this is buildable as scoped. Priority: **P1** (Mike, 2026-09-13).
