# Machine/board-specific node collections — Mike's ask, not scoped

Node "collections" for board/processor-specific node sets (e.g. Pi Pico PIO nodes), so the palette doesn't show irrelevant nodes for the target board. Connects to the editor-board-awareness item.

**Update, 2026-10-14:** node→board capability mapping is built (`decisions/node-board-mapping.md`): a node
declares `requires.capabilities`, the compile refuses one the target lacks, and the palette greys it out (kept
visible, not hidden). "Collections" as a curated per-board set (e.g. a PIO set for RP2) is still not built --
this is the mechanism it would sit on.
