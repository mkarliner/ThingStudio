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
