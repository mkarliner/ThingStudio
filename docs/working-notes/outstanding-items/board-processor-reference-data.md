# A local, maintained folder of board and processor definitions — raised by Mike 2026-08-20, not scoped

Raised by Mike 2026-08-20 (`mikes-questions-and-points.md`, "# Working docs"), not scoped anywhere yet. The ask:
stop re-deriving/re-fetching board and processor specs from websites each time they're needed; keep a curated local
reference instead, including notes on which pins are advisable/inadvisable to use per board, kept up to date as new
boards/processors are supported.

Distinct from, but a likely data dependency of, three already-open UI items: "Named/labeled pin mapping"
(`named-labeled-pin-mapping.md`, a flow author's own per-project pin names), "Machine/board-specific node
collections" (`board-specific-node-collections.md`, palette filtering by board), and "Editor board-awareness"
(`editor-board-awareness.md`, warn on bad pins for the target board) — all three would plausibly read from this
reference data once it exists, rather than each inventing their own board-fact source. Not scoped as its own
design; whoever picks up any of those three UI items should check whether this reference folder needs to exist
first.

**Update, 2026-09-22 (`docs/working-notes/outstanding-items/presets-design.md`):** the storage mechanism a
"board preset" type would need now exists — `PersistedStore.list_presets`/`read_preset`/`write_preset` in
`persisted_store.py` takes an open `type` string, so a `board` (or `processor`) preset type could sit on top
of it with no backend change, the same way `display_spi`/`display_i2c` presets do today. **This item itself
is still not built or scoped as a UI**: v1 of presets is explicitly per-node only (one preset, one node's own
`properties`, applied from that node's own property panel) — there's no "pick a board, seed several nodes'
pins/settings at once" flow, and no curated reference *data* (this item's actual ask) exists yet either. Read
`presets-design.md` before scoping this, since the storage layer it would use is no longer a blank slate.
