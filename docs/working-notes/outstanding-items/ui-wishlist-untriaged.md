# General UI wishlist, partially resolved

`mikes-questions-and-points.md`'s "# UI" section: collapsible/resizable panes, delete node/wire, a notes/README sheet for documenting a flow.

**Collapsible panes -- implemented 2026-09-04**, alongside a broader UI-cleanup pass (`docs/ui-cleanup-and-collapsing-panels-brief.md`):
- Palette (left) and property panel (right) collapse to a ~28px icon rail. The palette's collapse is a manual toggle in its header; the property panel's is automatic, driven by whether a node is currently selected (there's nothing else that would tell it when to reopen).
- "Compiled source (preview)" and "Device console" (the `#sidebar` panels) became native `<details>`/`<summary>` disclosures -- compiled source closed by default (it's rarely what anyone's looking at), console open by default. No new JS state needed for these two.
- Collapse state is session-only, not persisted across reloads (Mike's explicit call) -- every panel starts from the same default on a fresh load.

**Still unbuilt:** resizable panes (collapse/hide only, no drag-to-resize), a notes/README sheet for documenting
a flow. Delete node/wire split out into its own tracked item, 2026-09-04 -- see
`outstanding-items/delete-node-wire.md`, not repeated here.

- 2026-10-09: the flow notes sheet is built (a Notes panel, saved in the flow file as `notes`; plain text).
