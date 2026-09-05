# Delete node / delete wire — not built, split out for its own tracking, 2026-09-04

Originally just two words inside `ui-wishlist-untriaged.md`'s general UI wishlist bullet
(`mikes-questions-and-points.md`'s "# UI" section). Split into its own item at Mike's request, 2026-09-04, so it
doesn't stay buried inside a broader bullet.

## Current state (confirmed by reading the code, not assumed)

The only deletion mechanism that exists anywhere in the editor today is `editor-setup.ts`'s `clear()` -- the
"Clear canvas" toolbar button -- which unconditionally removes every connection and every node:

```ts
clear: async () => {
  for (const c of [...editor.getConnections()]) await editor.removeConnection(c.id);
  for (const n of [...editor.getNodes()]) await editor.removeNode(n.id);
  ...
}
```

There is no way to delete a single node or a single wire. Confirmed by grep: no keyboard delete/backspace
handling, no context menu, anywhere in `editor/src/app/rete/` or `editor/src/app/`. Node *selection* already
exists (`selectNode()`, same file -- used to drive the property panel and the console-click-to-navigate feature,
`outstanding-items/console-node-id-mapping.md`), so a single-node delete has something to hook onto. Wire/
connection selection does not exist at all -- Rete's own connection objects can be removed by id
(`editor.removeConnection(c.id)`, as `clear()` already does), but nothing in this editor lets a user click a wire
to select it first. That's new UI surface, not just wiring up an existing selection to a new action.

## Shape, not yet scoped in detail

**Delete node** (the easier half): with a node already selected (existing mechanism), a Delete/Backspace keypress
or an explicit delete button/icon (property panel or canvas) calls `editor.removeNode(id)` -- but needs to also
remove every connection touching that node first (`clear()`'s own ordering -- connections before nodes -- suggests
Rete does NOT do this automatically; confirm rather than assume, since leaving a dangling connection pointing at a
removed node's socket could be a real Rete-level shape a rewritten graph-adapter/compile step might not expect).

**Delete wire**: needs connection selection built from scratch first (click a wire -> visually mark it selected,
probably mirroring however node selection is rendered -- the existing orange-outline convention,
`console-node-id-mapping.md`'s own note on `AreaExtensions.selectableNodes`), then the same
Delete/Backspace-or-button mechanism calling `editor.removeConnection(id)`.

**Open questions, not resolved:**
- Keyboard shortcut vs. explicit button/context-menu -- Mike's own hands-on judgment call, same category as the
  still-unresolved drag-to-splice trigger-mechanism question (`outstanding-items/drag-to-splice.md`) that needed
  his real-browser feel rather than being decided from first principles.
- Does deleting a node need a confirmation step, or is undo (not built at all today, anywhere in the editor) the
  safety net instead? No undo mechanism exists currently -- worth deciding whether this item depends on that or
  ships without it.
- Multi-select delete (several nodes/wires at once) -- in scope for a first pass, or single-item-only to start?

## Status

**Raised 2026-08-something (`mikes-questions-and-points.md`), split into its own tracked item 2026-09-04. Not
scoped in detail, not started.**
