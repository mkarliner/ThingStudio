# `display_spi` framebuffer construction can exceed available heap — scoped, not built

Status: scoping note only, 2026-09-18, written at Mike's request after the CYD real-hardware bring-up
session hit this as a real `MemoryError`. Nothing below is implemented.

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

## The open architectural fork -- Mike's call, not decided here

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

## Not done here

No code changes. No `frameFormat`/`palette` property exists. No expansion helper exists.
`test-flows/cyd-display-test-pattern.py`'s per-strip RGB565 approach remains the only real, working
mitigation in the repo today, and it lives in a one-off scratch script, not in `display_spi` or in
documentation a new flow author would find.
