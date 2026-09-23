# Recovery button/jumper for a wedged listener — not scoped as a real design

A runtime-image feature (not a node) giving §5's boot-time Ctrl-C escape hatch a standing, on-demand equivalent for the life of the device, not just the first few seconds after boot. Concrete implementation notes exist in `architecture-review-briefing.md`.

## 2026-09-23 update — largely covered in software

`decisions/board-recovery-and-commands.md`: boot-loop safe mode plus "Remove flow…" (Ctrl-C retried through
resets) give the on-demand escape hatch this item asked for without dedicated hardware. A physical
button/jumper is still only worth building if a real case turns up that neither handles.
