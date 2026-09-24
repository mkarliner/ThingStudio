# Processor/board definitions: follow-ups

Status: open, raised 2026-09-23 when the definitions landed (`decisions/chip-board-definitions.md`).
None of these block MVP item 4; each is a small, separate change.

- **The flow file doesn't record its board.** Opening a flow with nothing connected and the Board menu
  on Auto checks pins against 0-48 only. An optional `board` field in the flow file (set from the Board
  menu on save, applied on open) would fix it. Additive to the flow-file format, so not a one-way door;
  left out to keep this change to editor/backend checks only.
- **The Board menu choice isn't remembered across page reloads.** Could go in the flow file (above) or
  per-browser storage.
- **CYD pins beyond the display are from community pinouts, not tested here:** touch (25/32/39/33/36),
  SD (18/23/19/5), RGB LED (4/16/17, active low), LDR 34, speaker 26. Check on a real unit and correct
  `editor/src/definitions/boards/cyd.json`.
- ~~CYD display on SPI bus 1 above 27 MHz is untested.~~ **Confirmed 2026-09-24:** 40 MHz on `spiBus: 1`
  renders on a real CYD (`learnings/hardware-bringup-hil-rig.md`). Higher speeds still untried.
- **RP2350 native arch** (`armv7emsp`) is still community-sourced (`decisions/board-aware-compile.md`);
  the processor file carries `nativeArchConfirmed: false`.
- **No board-level defaults yet.** A board file could seed a new `display_spi` node's pins and speed
  (the "pick a board, seed several nodes" idea in `board-processor-reference-data.md`). Not built.
- **ESP32-C6 and other chips have no processor file.** `inferNativeArch()` still covers C6's arch, but
  pin checks fall back to 0-48 for it.
- **The Arch menu keeps a manual pick across board changes** (raised 2026-09-24). The Board menu now drops a
  pick for a different processor back to Auto on connect (`target.ts`'s `choiceForConnectedBoard`); the Arch
  menu's manual override doesn't, so it can still compile native code for the previous board's arch.
- **The backend's stale-build banner and log say `npm run build` / `mkdocs build`** (raised 2026-09-24). Since
  the Makefile, `mkdocs` lives only in `.venv`, so `make` is the command to show. `editor_site.py`,
  `docs_site.py` and their tests assert the old strings.
