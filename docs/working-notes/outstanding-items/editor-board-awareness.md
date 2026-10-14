# Editor board-awareness — filter palette / warn on bad pins by target board

Explicitly "medium-term, not for now" (2026-08-15). Connects to §6's already-flagged v2 pin-conflict gap and the board-specific-node-collections item.

**Update, 2026-10-14:** the palette now greys out a node whose declared `requires.capabilities` the current
target lacks (`PaletteSidebar.vue`, `decisions/node-board-mapping.md`), and pin checks already warn/stop by
target (`definitions/pin-check.ts`). Remaining: richer per-board guidance beyond the capability vocabulary.
