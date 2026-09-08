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

## Implemented, 2026-09-08

Built per the shape above, judgment calls resolved as follows -- flagged here rather than assumed silently
settled, since this file itself said these needed Mike's real-browser feel, same category as the still-open
drag-to-splice trigger question:

- **Keyboard shortcut, not a button/context-menu.** Delete/Backspace, matching Node-RED's own convention (this
  project already leans on Node-RED as its UX reference elsewhere -- multi-output-port support, the property
  panel). No toolbar button or right-click menu added. **Worth Mike's own hands-on check** that this is
  discoverable enough without one -- easy to add a button alongside it later if not.
- **No confirmation step, no undo.** Matches "Clear canvas"'s own existing precedent (also no confirmation, also
  no undo) rather than introducing an inconsistency between the two deletion mechanisms. Undo still doesn't exist
  anywhere in the editor.
- **Multi-select delete included in the first pass**, not deferred. Deleting a wire and deleting node(s) share one
  `deleteSelected()` entry point: any Rete-multi-selected nodes (Ctrl-click) win if present, otherwise the one
  selected wire.

### What actually changed

- `editor/src/app/rete/store.ts`: new `selectedConnection` ref (wire selection, mirroring the existing
  `selectedNode`) and `clearNodeSelection` ref (a callback slot `editor-setup.ts` fills in, since a connection's
  render props carry no `emit` the way a node's do -- confirmed reading rete-vue-plugin's compiled classic
  preset -- so `ThingstudioConnection.vue` has no other way to reach back into the Selector instance that owns
  Rete's own multi-select highlight).
- `editor/src/app/rete/ThingstudioConnection.vue`: new file, `customize.connection()` in `editor-setup.ts`. A wire
  is now click-to-select (orange highlight, same `#ff8f0e` as a selected node) rather than purely decorative.
- `editor/src/app/rete/editor-setup.ts`: `deleteSelected()` added to the returned handle (mirrors `clear()`'s own
  connections-before-nodes ordering -- confirmed reading Rete core's source that `removeNode()` does not cascade
  into connections on its own, so a caller has to). Node/wire selection kept mutually exclusive throughout
  (picking a node clears any selected wire and vice versa) so Delete never has an ambiguous target.
- `editor/src/app/main.ts`: `document`-level `keydown` listener for Delete/Backspace, guarded against firing while
  a text field (property panel, flow name, a custom-node picker) has focus.
- `docs/user-guide/canvas-basics.md`: "No per-node delete yet" limitation removed, replaced with a short
  "Deleting" section (CLAUDE.md's human-facing-docs style -- plain, no rationale).

### Verified

`tsc --noEmit` clean, full existing vitest suite (365 tests) still green -- both run against a fresh scratch
`npm ci` in an isolated copy, never the live-mounted `node_modules` (CLAUDE.md's shared-mount rule). No new
automated tests added: this codebase doesn't unit-test the Rete/Vue canvas layer anywhere (`editor-setup.ts`,
`ThingstudioNode.vue`, `PropertyPanel.vue`, etc. all have zero test coverage today, confirmed by listing
`editor/test/`) -- consistent with that existing pattern rather than introducing a first one here. **The actual
interactive behavior (click a wire, multi-select nodes, Delete removing the right thing, not firing while typing)
still needs Mike's own real-browser pass** -- nothing here substitutes for that.

**2026-09-08, Mike's real-browser smoke test: delete node and delete wire both confirmed working.** Multi-select
uses Cmd-click on his machine, not Ctrl-click -- confirmed as existing `rete-area-plugin` behavior
(`accumulateOnCtrl()` already treats `Meta` the same as `Control`, unmodified by this session's work), not a bug.
No button/context-menu wanted alongside the keyboard shortcut -- Delete/Backspace alone confirmed sufficient.

## Status

**Raised 2026-08-something (`mikes-questions-and-points.md`), split into its own tracked item 2026-09-04, picked
as the next priority 2026-09-08, implemented and verified the same day. Done.**
