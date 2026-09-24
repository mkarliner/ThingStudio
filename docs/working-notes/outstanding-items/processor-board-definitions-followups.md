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
- **CYD display on SPI bus 1 above 27 MHz is untested.** GPIO 14/13 are ESP32 SPI id 1's fast pins, so
  `spiBus: 1` should allow up to 80 MHz where `spiBus: 2` crashed at 40 MHz. The pin check allows it; a
  real unit hasn't run it.
- **RP2350 native arch** (`armv7emsp`) is still community-sourced (`decisions/board-aware-compile.md`);
  the processor file carries `nativeArchConfirmed: false`.
- **No board-level defaults yet.** A board file could seed a new `display_spi` node's pins and speed
  (the "pick a board, seed several nodes" idea in `board-processor-reference-data.md`). Not built.
- **ESP32-C6 and other chips have no processor file.** `inferNativeArch()` still covers C6's arch, but
  pin checks fall back to 0-48 for it.
