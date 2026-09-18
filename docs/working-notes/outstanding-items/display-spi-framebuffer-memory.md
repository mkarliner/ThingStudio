# `display_spi` framebuffer construction can exceed available heap — gs4 built, not verified by tsc/vitest

Status: scoped 2026-09-18 (Mike's request after the CYD real-hardware bring-up session hit a real
`MemoryError`), decided the same day, and `frameFormat: "gs4"` implemented the same day (`display-
spi.ts`, `nodes.ts`, `PropertyPanel.vue`, `node-display-spi.test.ts`, `docs/user-guide/nodes/
display-spi.md` -- see `decisions/node-authoring.md`'s later 2026-09-18 entry for the implementation
itself). **Not yet verified by a real `tsc --noEmit`/`vitest run`** -- built and hand-verified against
the real vendored driver via a standalone python3 script (not the vitest suite itself, which this
session's sandbox can't run against the live-mounted `editor/`, per `CLAUDE.md`), so Mike's own build/
test pass is still the actual gate before trusting this compiles and the new tests pass. `gs2`/`mono`
remain decided but not built.

## The problem, with real numbers

`display_spi` takes one already-rendered `bytes` frame as its single input -- by design, it doesn't
know about `framebuf` drawing primitives, just raw pixel bytes to push over SPI
(`outstanding-items.md`'s "Resolved" entry for the node explains why: bus-family-generic, graphics-
framework-agnostic). The flow author is the one who allocates the frame buffer, typically via
`framebuf.FrameBuffer(bytearray(w*h*2), w, h, framebuf.RGB565)`.

For CYD's native 240x320 panel that's `240 * 320 * 2 = 153,600` bytes in one contiguous allocation.
This session's CYD bring-up hit exactly this as a hard `MemoryError: memory allocation failed,
allocating 153600 bytes` on a classic ESP32 (dual-core, ~320KB usable RAM, already carrying MicroPython
runtime + `mqtt_as` + whatever else the flow needs). The workaround used to get bring-up unblocked
(`test-flows/cyd-display-test-pattern.py`'s rewritten version) was to build and push the frame one
~25KB horizontal strip at a time with `gc.collect()` between strips -- real, but a one-off script's
workaround, not anything `display_spi` or the flow-authoring contract does for a real user today.
Classic ESP32-S/original ESP32 boards with less free heap (or a flow already carrying other memory
pressure -- WiFi, MQTT, other nodes) are the boards most exposed; RP2350/ESP32-S3-class boards with
more RAM are less likely to hit this at 240x320, but the ceiling still exists at larger panel sizes.

## Mike's suggested shape: declare a lower bit depth, expand on the fly

Build the frame as a 4-bit indexed/palette buffer instead of full RGB565, then expand each pixel to
real 16-bit color only when it's actually pushed to the display, not when it's stored.

Memory math for CYD's 240x320: a 4-bit (16-color) indexed frame is `240 * 320 / 2 = 38,400` bytes --
a quarter of the RGB565 frame's 153,600 bytes, comfortably inside a classic ESP32's free heap as one
contiguous allocation (no strip-juggling needed just to hold it). MicroPython's own `framebuf` module
already has a matching built-in format, `framebuf.GS4_HMSB` (4 bits per pixel, 2 pixels per byte,
values 0-15) -- so the *drawing* side (text, shapes, fills) would work against a real
`framebuf.FrameBuffer` object exactly like today, just built with `GS4_HMSB` instead of `RGB565`, using
pixel values 0-15 as palette indices rather than direct colors.

Expansion happens at push time: for each 4-bit index, look it up in a small 16-entry palette (index ->
RGB565 value) and write out the real 2-byte pixel. That expansion still needs somewhere to land -- the
natural fit is the same per-strip approach the CYD bring-up script already proved works (expand one
strip's worth of indices to RGB565 in a small scratch buffer, push that strip, move on), so the *peak*
memory for one strip stays small regardless of full-frame size, and the indexed source buffer itself is
already a quarter the size to begin with. MicroPython has no vectorized array-expand primitive for
this, so the expansion loop is a plain per-pixel Python loop -- a real CPU/time cost per frame, worth
measuring on real hardware before assuming it's fast enough for any given flow's update rate; not
measured here.

## External corroboration: a real-world GS4 UI-display driver (source Mike found)

A practitioner's own account of building exactly this design point, independently, confirms the
approach is real and describes it in more concrete detail than either the CYD `MemoryError` this
session hit or the general math above:

- **Palette size confirmed practical, not just theoretical**: ~11 colors, chosen from Google's
  Material Design color picker, covering the actual needs of a real UI -- leaving a handful of the
  remaining GS4 slots (16 total) free for "arbitrary use / not decided yet." A concrete starting
  point for this project's own default palette, if/when one gets built, rather than inventing one
  from scratch.
- **No SPIRAM required** -- relevant here specifically because the CYD's classic ESP32 (and other
  classic-ESP32 boards without PSRAM) is exactly the case this session's `MemoryError` hit; GS4's
  smaller footprint means it doesn't need to fall back to slower/optional PSRAM the way a full
  RGB565 buffer might on a PSRAM-equipped board.
- **Real timing numbers, not a guess**: full 240x320 frame sent in **under 100ms**, in "pure"
  MicroPython using the `@micropython.viper` code emitter for the row-expansion inner loop -- this
  is the detail this scoping note was originally missing (it only flagged "a plain per-pixel Python
  loop... a real CPU/time cost... not measured here"). `viper` is MicroPython's near-native-speed
  typed-subset emitter, exactly the tool for a tight per-pixel expand loop like this -- worth
  reaching for directly rather than re-discovering the need for it through a slow first attempt.
- **Expansion granularity**: 2 rows at a time, each expanded to RGB565 then sent as one SPI
  transaction -- finer-grained than the ~25KB-strip approach this session's CYD scratch script
  used, and the granularity that got to <100ms.
- **Scales to a larger panel too**: the same driver adapted to a 320x480 ili9486 4" display takes
  ~150-170ms per frame -- a useful reference point if a future board needs a bigger display than
  CYD's 240x320.
- **Known limitation, stated plainly by the source**: not useful for photos/arbitrary images -- a
  fixed ~11-16 color palette is a UI/graphics tool, not a general-purpose framebuffer replacement.
  Consistent with this node's own current audience (control-panel/status-display UIs, not photo
  viewers).
- A further speed-up path the source identifies but didn't need: writing the expansion in C, or
  going further and queueing SPI transactions directly via esp-idf calls (bypassing MicroPython's
  own SPI driver, which the source characterizes as slow) -- not needed to hit "fast enough," and
  not something to chase here without a concrete reason to.

This substantially de-risks Mike's suggested shape above: it's a proven, shipped technique
elsewhere, with real numbers, not just plausible math. It doesn't resolve the architectural fork
below on its own -- that's still whether `display_spi` should own this internally or stay dumb and
document the pattern -- but it does mean either path now has a validated implementation to follow
rather than a from-scratch design.

## The architectural fork -- RESOLVED, 2026-09-18 (Mike's call, via `AskUserQuestion`)

**Option 1, extended.** `display_spi` grows real properties and does the expansion internally.
Extended beyond the two shapes below (Mike's own ask, same session): support four frame depths, not
two -- `frameFormat`: `"rgb565"` (default, unchanged), `"gs4"` (4bpp), `"gs2"` (2bpp), `"mono"` (1bpp)
-- mapping directly onto MicroPython's own `framebuf` formats (`RGB565`/`GS4_HMSB`/`GS2_HMSB`/a
`MONO_*` variant). All three reduced depths are palette-driven (one 16-entry RGB565 `palette`
property used regardless of `frameFormat`, not hardcoded gray/black-white ramps for the low depths).
Full decision write-up, including what's still open (default `gs2`/`mono` palette seeding, exact
`MONO_*` variant, phasing/sequencing, row-batching size per depth): Claude-project doc
`display-spi-framebuffer-format-decision.md` (ThingStudio project -- transcribe into this repo's own
`decisions/node-authoring.md` in full once implementation starts; a short pointer entry already
exists there as of 2026-09-18). Not built yet. The two shapes below are kept as-is for the historical
record of what was being decided between -- option 1 (extended) is what's actually happening now.

### The two shapes that were on the table

Two real shapes this could take, and they commit the project to different things:

1. **`display_spi` grows this itself.** The node gains an input-format property (e.g. `frameFormat`:
   `"rgb565"` (today's only option) vs `"gs4"`) and a `palette` property (16 RGB565 entries, with a
   sensible default), and does the expand-and-strip-push internally as part of its own SPI-push
   codegen. Upside: every flow author gets the memory saving for free, enforced rather than opt-in.
   Downside: the node stops being purely "push these bytes as-is" -- it now has real format-conversion
   logic and a palette concept, which is more surface area and moves it a step toward the
   templating/drawing-primitives territory the design has deliberately kept out of this node so far
   (`outstanding-items.md`'s POST-MVP templating item).
2. **`display_spi` stays exactly as dumb as it is today**, and the 4-bit-indexed-plus-expand-on-blit
   technique becomes a documented pattern (a `function`-node code snippet in
   `docs/user-guide/nodes/display-spi.md`, or a worked example flow) that a flow author copies and
   adapts, the same way today's byte-swap-for-RGB565 gotcha is already documented rather than fixed
   inside the node. Upside: no node-shape change, no new properties, keeps the "just bytes" contract
   simple. Downside: nothing enforces it -- a new flow author hits the exact same `MemoryError` CYD
   bring-up hit, unless they find and follow the doc.

Per this project's own "don't paint into an architectural dead end" habit, this fork is flagged rather
than picked here -- (1) is more node-authoring-consistent with how `xstart`/`ystart`/the new
colorOrder-family properties just landed (real properties, not documentation), but is a bigger scope
increase for `display_spi` than anything it's taken on so far; (2) is cheap now but leaves every future
large-panel flow exposed to the same failure by default. Needs Mike's call before any of this is built.

## Built, 2026-09-18 -- `gs4` only

`frameFormat: "rgb565" | "gs4"` and a `palette` property (16 RGB565 entries) landed in `display-
spi.ts`, mirrored into `nodes.ts`'s typed defaults and `PropertyPanel.vue`'s form (frame-format
dropdown; palette is flow-file-only for now, no color-picker UI, same gap `colorOrder`/`invertColors`/
`dataLatchOrder` already have). In `"gs4"` mode, expansion happens inside this node's own generated
code via a per-instance `@micropython.viper`-decorated helper, streamed out 2 rows/transaction through
the vendored driver's own `set_window()` + `write(None, ...)` primitives (not `blit_buffer()`, which
assumes RGB565).

**A real correctness bug found and fixed before landing, not just theoretical:** the first draft of
the expansion loop treated the source buffer as a flat sequence of nibbles (n whole bytes in, n*4 bytes
out). That's wrong for an odd-width panel -- GS4_HMSB pads each row to a whole byte (confirmed by
reading MicroPython's own `extmod/modframebuf.c` directly, not assumed), so a flat expansion would
expand the trailing pad nibble on an odd-width row into a phantom extra pixel, shifting every
subsequent pixel out of alignment for the rest of the frame -- exactly the kind of "silently wrong
beats loudly right" failure this project's own fault-handling priority exists to catch. Fixed: the
expansion loop is pixel-count-aware per row (expands exactly `width` real pixels, discards any
trailing pad nibble), not byte-count-aware. Verified end-to-end twice, by hand, against the real
vendored driver + pymock harness before writing the vitest test cases from the same numbers (not
from the codegen's own output, to avoid a test that just re-asserts a bug) -- an odd-width case
(3x2) and a multi-row-batch case (2x3, split across 2 SPI transactions) both match hand-derived
expected bytes exactly. `expectedBytes` for `"gs4"` mode is `Math.ceil(width / 2) * height`, not a
flat `Math.ceil((width * height) / 2)` -- the two agree for CYD's even 240 width and disagree for
TiDAL's odd 135 (68 bytes/row, not 67.5), which is exactly why this was easy to miss testing only
against CYD's panel.

`test-flows/cyd-display-test-pattern.py`'s per-strip RGB565 approach is superseded by `gs4` mode for
any new flow that wants the memory saving, though it isn't removed. No worked example/test flow using
`gs4` exists yet in `test-flows/` -- a real on-device pass (CYD or TiDAL) is still the actual gate,
not this off-device work.

**`@micropython.viper` mechanism spiked off-device, 2026-09-18 -- not yet on this project's own
hardware.** Before committing to the codegen above, a standalone spike (not checked into this repo)
ran `@micropython.viper`-typed gs4/gs2/mono expansion loops against a freshly-built MicroPython
unix-port interpreter: correctness-checked, then timed at 0.25ms/0.23ms/0.38ms per 240x320 frame on
that (x86) dev machine -- confirms the mechanism itself works with no syntax/semantic surprises and
that the loop is very unlikely to be the CPU bottleneck relative to SPI transfer time. This is NOT a
real-hardware result (different CPU entirely, and MicroPython's own SPI driver -- the actual
bottleneck per the corroborating GS4 account above -- isn't exercised by this spike at all). The
2-row expansion granularity and the ~11-color Material palette are also still to be tried on real
hardware. Full method + numbers: `docs/working-notes/learnings/micropython-device-runtime.md`.
