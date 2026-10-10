# display spi

Pushes an already-rendered frame to an SPI color TFT panel. [Supported hardware](../supported-hardware.md#displays)
lists the display chips. Build the frame upstream (a `function` node using `framebuf.FrameBuffer`,
or eventually a graphics-framework node) and wire it into this node's input.

This node's property panel has a **preset** picker (see [Canvas basics](../canvas-basics.md#presets)) —
save a real panel's whole setup (pins, bus, resolution, rotation, color order, and so on) under a name
once, then load it again on this or another `display_spi` node instead of retyping every field. The CYD
defaults below are exactly what saving a "cyd" preset from a correctly-configured node would capture.

## Properties

- **controller** — the display chip. See [Supported hardware](../supported-hardware.md#displays).
- **frame format** — `rgb565` (default, full color, `width * height * 2` bytes), or an indexed
  format: `gs4` (4-bit, a quarter the memory), `gs2` (2-bit, an eighth), or `mono` (1-bit, a
  sixteenth). Switch away from `rgb565` if a full RGB565 buffer won't fit in memory — the lower the
  depth, the smaller the buffer, at the cost of fewer colors (see "Indexed modes" below).
- **palette** — always 16 RGB565 colors, used by every indexed format (`gs4` reads all 16, `gs2` only
  the first 4, `mono` only the first 2). Shown as color swatches under frame format when an indexed
  format is picked; click one to change it, or **reset** to go back to the built-in colors. Colors
  are stored as RGB565, so a picked color is rounded to the nearest one the panel can show.
- **SPI bus** — which hardware SPI peripheral to use. Default 2.
- **baudrate** — SPI clock speed. Default 40MHz. On an ESP32, use 27MHz or less unless sck and mosi are the bus's fast pins; the compile tells you if the speed is too high for your [board](../boards.md).
- **sck / mosi / dc pins** — required GPIO pins. Checked against your [board](../boards.md), along with the SPI bus and speed.
- **cs / reset / backlight pins** — optional GPIO pins (−1 for "not wired"). Some boards tie
  reset or CS high in hardware and don't expose them as GPIOs, or have no backlight control at all.
- **width / height** — panel resolution in pixels.
- **orientation** — off by default. Set it to 0, 90, 180 or 270 to turn the picture clockwise; the gui screen wired to the display and its touch follow. With an orientation, set width and height to the panel's own size, `rotation` to how the panel is mounted (0 to 3), and `xstart`/`ystart` to `-1` (an orientation can't be combined with a panel offset). See [Rotating the screen](gui.md#rotating-the-screen).
- **rotation** — 0–7, the panel's MADCTL orientation code (which of MY/MX/MV to set). Default `1`.
- **color order** — `rgb` or `bgr`, whichever matches your panel's own wiring. Default `bgr`.
- **invert colors** — on or off. Some panels need this flipped to show true colors instead of their
  negative. Default off.
- **data latch order** — on or off, a separate MADCTL bit (`MH`) some panels need alongside rotation for
  correct left-right orientation — not the same bit as rotation's own mirror options, and not always
  needed. Default on.
- **xstart / ystart** — the panel's offset into the ST7789 controller's own (larger) GRAM. Default `-1`,
  which lets the vendored driver's own built-in table resolve this automatically for the two panel sizes
  it knows about (240×240 → `0, 0`; 135×240, including the EMF 2022 TiDAL badge's own panel → `52, 40`).
  Any other resolution needs `xstart`/`ystart` set explicitly, or the driver raises a clear error at
  flow-boot time rather than silently guessing. Getting this wrong doesn't error either way — it just
  blits into the wrong window of the controller's real GRAM, so content shows up clipped/offset and the
  visible glass shows whatever stale pixels were already sitting in the uncovered part of memory
  (confirmed on real TiDAL hardware, 2026-09-18 — see `test-flows/README.md`'s
  `display-spi-tidal-test.flow.json` section for the full story).
  An ST7796 panel has no offset: leave both at `-1`.

Pins, bus, resolution, rotation, color order, inversion, and data latch order all vary board to board —
there's no sensible default that works for more than one board, so confirm these against your own panel.
The defaults above match a real Cheap Yellow Display (ESP32-2432S028) unit confirmed working 2026-09-18;
a different board, or even a different unit of the same board, may need different values — see
`docs/working-notes/decisions/node-authoring.md`'s 2026-09-18 entry for how that unit's values were found,
if you need to work out your own panel's.

## Behavior

The input is a raw RGB565-encoded buffer, exactly `width * height * 2` bytes — the same format
`framebuf.FrameBuffer` produces for an RGB565 surface. A wrong-length buffer raises a clear error rather
than silently desyncing the panel.

A message with a `y` key is a strip instead: whole rows, written starting at row `y`. The
[gui screen](gui.md) node sends strips, so a large display never needs a full frame in memory.

**Byte order: `framebuf.RGB565` and this node disagree, and you need to bridge that gap yourself.**
MicroPython's `framebuf.RGB565` stores each pixel in CPU-native (little-endian on ESP32) byte order, but
SPI TFT controllers including the ST7789 expect big-endian pixel bytes on the wire — this node forwards
whatever bytes it's given as-is (there's no flush/transform step to hide this in), so a buffer built
straight from `framebuf.FrameBuffer(..., framebuf.RGB565)` comes out with red and blue channels scrambled
(confirmed on real hardware: an intended pure green circle rendered red). There's no MicroPython-level
flag to pick big-endian storage instead (a [PR that would have added
one](https://github.com/micropython/micropython/pull/3536) was never merged). Fix: byte-swap the buffer
before handing it to this node —

```python
for i in range(0, len(buf), 2):
    buf[i], buf[i + 1] = buf[i + 1], buf[i]
```

— right after drawing, before `msg['payload'] = buf`. A color where both bytes happen to match
(pure white `0xFFFF`, pure black `0x0000`) is unaffected either way, which is why a swap bug can hide
behind text/background colors and only show up on saturated colors like a pure green or blue fill.

## Indexed modes: lower memory, a fixed palette

Switch frame format away from `rgb565` if a full RGB565 buffer won't fit in memory — a real problem
on some boards at larger resolutions. Build the frame upstream with `framebuf.FrameBuffer(...,
framebuf.<FORMAT>)` instead of `RGB565`, where `<FORMAT>` matches the frame format property:

| frame format | `framebuf` constant | bits/pixel | palette indices used | 240×320 frame size |
|---|---|---|---|---|
| `rgb565` (default) | `RGB565` | 16 | — (real color) | 153,600 bytes |
| `gs4` | `GS4_HMSB` | 4 | 0–15 (all 16) | 38,400 bytes |
| `gs2` | `GS2_HMSB` | 2 | 0–3 (first 4) | 19,200 bytes |
| `mono` | `MONO_HMSB` | 1 | 0–1 (first 2) | 9,600 bytes |

Send the `bytearray` itself as the payload (`msg['payload'] = buf`). `bytes(buf)` makes a second full-size
copy, and a board can run out of memory for it even when plenty looks free. For a flow that redraws often,
keep the buffer in `context` and reuse it rather than allocating a new one each time.

Pixel values become palette indices, not colors — this node expands each pixel to real color using
the palette property when it sends the frame.

**`mono` needs `framebuf.MONO_HMSB` specifically, not `MONO_VLSB` or `MONO_HLSB`.** MicroPython has
three different 1-bit `framebuf` formats and they are NOT interchangeable — building your source
buffer with the wrong one silently produces a garbled image, not an error, because this node has no
way to tell which one you actually used. `MONO_VLSB` (the common OLED/SSD1306 convention, and what
this project's own `display_i2c` node uses) packs pixels into *vertical* byte columns; this node
streams frames out row-by-row like every other format here, so `MONO_VLSB` will not work. Of the two
row-oriented options, `MONO_HLSB` and `MONO_HMSB` pack their 8 pixels-per-byte in opposite bit orders
from each other — this node was built against `MONO_HMSB` specifically (chosen for consistency with
`GS4_HMSB`/`GS2_HMSB`'s own naming, confirmed directly against MicroPython's real C source, not
assumed from the name), so `MONO_HLSB` will come out with every row's pixels in the wrong order.

The input buffer isn't simply "1/N the size of RGB565" for any of these — each row is padded to a
whole number of bytes, so a width that isn't an exact multiple of the format's pixels-per-byte (2 for
`gs4`, 4 for `gs2`, 8 for `mono`) needs slightly more than a flat `width * height / bitsPerByte`
formula would give. This node works out and checks the real size for you, and raises a clear error
naming the exact expected byte count (including the format and bits/pixel) on a mismatch.

Indexed modes have no byte-order gotcha — the palette already stores colors in the order this node
expects.

Fewer colors as the depth drops (16 for `gs4`, 4 for `gs2`, 2 for `mono` — effectively black/white
unless you override the palette), so these suit a UI with a small fixed palette (buttons, status
text, simple icons), not photos or arbitrary images; `mono` in particular is closer to an e-ink-style
UI than a color one.

No drawing primitives here — this node only pushes a complete, already-rendered frame on every message.
