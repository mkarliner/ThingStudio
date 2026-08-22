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
