# Learnings — Hardware bring-up / HIL rig

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **A floating witness GPIO input pin picks up what looks exactly like a
  real signal — steady ~27–29µs-spaced edge bursts, present even with
  nothing driving the DUT side.** Diagnosed from the burst's suspicious
  regularity (inconsistent with a real transition or simple wire
  crosstalk) — fixed by giving every watching pin an internal
  `PULL_DOWN`. Design around this from the start on any new witness-rig
  wiring, don't rediscover it. `fault-isolation-briefing.md`,
  `tier1-sensors-network-briefing.md`.
- **Long breadboard patch wires cause real electrical ringing on fast
  GPIO edges.** Harmless for "did *a* transition happen" checks; would
  corrupt anything relying on precise edge *counts* (PWM duty-cycle,
  timer measurements) until the wiring is cleaned up (shorter leads, a
  series resistor). `tier1-sensors-network-briefing.md`.
- **A witness's first `.irq()` arm in a session can `MemoryError` under
  heap fragmentation.** Pre-existing MicroPython behavior, not a bug in
  this project's firmware — worked around with a `gc.collect()` plus a
  throwaway warm-up call before the real checks. `mvp-validation-plan.md`,
  2026-08-14 GPIO/timer hardware Results entry.
- **Watching a board's first boot through Thonny is unreliable.**
  Thonny's Shell sends a keyboard interrupt on connect/reconnect, which
  `listener.py`'s deliberate few-second boot-delay window (§5's
  physical-access fallback) interprets as a real request to drop to
  REPL — looks exactly like "never reaches HELLO" even when boot is
  correct. Use a passive `mpremote connect <port>` (no interrupt) or any
  serial monitor that doesn't auto-send Ctrl-C on open. Not
  board-specific — will bite on any board watched this way.
  `rp2040-bringup-findings.md`.
- **Declared node `width`/`height` are a real rendering clipping budget
  in Rete's classic preset, not layout hints the way Litegraph's `size`
  is.** A node sized against the default renderer can clip its own socket
  once custom per-type styling changes padding/font — verify, don't
  assume old sizes still fit. `editor-look-and-feel-briefing.md`,
  `rete-migration-implementation-briefing.md`.
- **A single full-frame `framebuf.FrameBuffer` buffer can `MemoryError` on a classic ESP32
  (not S3) even though the total exists in RAM.** A 240x320 RGB565 frame (153600 bytes) failed
  to allocate as one contiguous block on a real CYD unit (`cyd-display-test-pattern.py`,
  2026-09-18) -- TiDAL's smaller 135x240 panel (64800 bytes) never hit this. Worked around by
  building and pushing the frame one horizontal strip at a time (~25KB each) instead of one
  full-screen buffer, with `gc.collect()` between strips. Relevant to item 4's flash/memory-budget
  concerns and to `framebuffer-display-node-scoping.md`'s LVGL/full-frame-contract question -- a
  full-frame-only input contract may not hold as a free assumption on every board this project
  targets, independent of the LVGL partial-rect question. Not yet built into `display_spi`'s own
  codegen -- a real risk for any panel resolution large enough to matter, worth revisiting before
  a bigger panel is targeted.
- **`st7789py_mpy`'s `_set_mem_access_mode()` never exercises the MADCTL `MH` bit (Display Data
  Latch Order).** Its rotation table only combines `MY`/`MX`/`MV`; a real CYD panel
  (2026-09-18 bring-up) stayed mirrored across all four `MY`/`MX` combinations and only came out
  correct with `MH` set (`MADCTL = BGR | MH | MX`, written directly, bypassing the helper). Some
  ST7789 glass/FPC assemblies apparently need `MH` specifically for horizontal orientation, not
  `MX` -- worth trying if a future panel stays mirrored through the whole `MY`/`MX` rotation table.
- **CYD chip-ID SPI reads (`RDDID`, `RDID1-3`, ILI9341's `RDID4`) all came back `0x00` on a real
  unit, while `RDDST` (Read Display Status) returned real structured data on the same wiring** --
  proof the SPI/MISO/pin wiring was correct, not that the chip lacks a readable identity. These
  four ID-specific registers are apparently just not implemented usefully on this board, matching
  an independent CYD diagnostic tool project's choice not to attempt automatic ID detection at all.
  Don't treat an all-zero ID read as damning on its own -- check whether ANY register roundtrips
  real data first (a working non-ID read like `RDDST` is what actually proves the bus itself is
  fine). `test-flows/cyd-controller-id-probe.py`.
- **Community board-naming heuristics for the CYD (2-USB vs 1-USB "R" suffix -> controller chip)
  actively conflict between sources** -- one GitHub issue claims 2-USB is ST7789 and "R" is
  ILI9341; Bruce firmware's own default device profile for the same board string is ILI9341
  regardless. Real-hardware confirmation (this file's own entry above) matched the 2-USB->ST7789
  claim for one specific unit, but the two sources disagreeing at all is itself the useful data
  point -- board string/USB-port-count is a hint worth checking, never a substitute for testing the
  actual unit.
