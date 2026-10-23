# display spi

Pushes an already-rendered frame to an SPI color TFT panel. [Supported hardware](../supported-hardware.md#displays)
lists the display chips. Build the frame upstream (a `function` node using `framebuf.FrameBuffer`) and wire it into
this node's input.

This node's property panel has a **preset** picker (see [Editor in depth](../working-in-the-editor.md#presets)) —
save a real panel's whole setup (pins, bus, resolution, rotation, color order, and so on) under a name once, then
load it again on this or another **display spi** node instead of retyping every field.

## Properties

- **controller** — the display chip. See [Supported hardware](../supported-hardware.md#displays).
- **frame format** — `rgb565` (default, full color, `width * height * 2` bytes), or an indexed format: `gs4`
  (4-bit, a quarter the memory), `gs2` (2-bit, an eighth), or `mono` (1-bit, a sixteenth). Switch away from
  `rgb565` if a full buffer won't fit in memory; the lower the depth, the smaller the buffer, at the cost of fewer
  colors. The gui screen wired to the display uses this format.
- **palette** — 16 RGB565 colors, used by every indexed format (`gs4` reads all 16, `gs2` only the first 4, `mono`
  only the first 2). Shown as swatches under frame format when an indexed format is picked; click one to change it,
  or **reset** for the built-in colors. Colors are rounded to the nearest the panel can show.
- **SPI bus** — which hardware SPI peripheral to use. Default 2.
- **baudrate** — SPI clock speed. Default 40MHz. On an ESP32, use 27MHz or less unless sck and mosi are the bus's
  fast pins; the compile tells you if the speed is too high for your [board](../boards.md).
- **sck / mosi / dc pins** — required GPIO pins, checked against your [board](../boards.md).
- **cs / reset / backlight pins** — optional GPIO pins (−1 for "not wired"). Some boards tie reset or CS high in
  hardware, or have no backlight control at all.
- **width / height** — panel resolution in pixels. The gui screen wired to the display takes this size.
- **orientation** — off by default. Set it to 0, 90, 180 or 270 to turn the picture clockwise; the gui screen wired
  to the display and its touch follow. With an orientation, set width and height to the panel's own size, `rotation`
  to how the panel is mounted (0 to 3), and `xstart`/`ystart` to `-1`. See
  [Rotating the screen](gui.md#rotating-the-screen). A flow that reads touch with a [touch](touch-i2c.md) node
  rather than a gui screen sets the same angle on that node.
- **rotation** — 0–7, the panel controller's orientation code. Default `1`.
- **color order** — `rgb` or `bgr`, matching your panel's own wiring. Default `bgr`.
- **invert colors** — on or off. Some panels need this flipped to show true colors instead of their negative.
- **data latch order** — on or off, a separate controller bit (`MH`) some panels need alongside rotation for
  correct left-right orientation.
- **xstart / ystart** — the panel's offset into the ST7789 controller's own (larger) frame memory (GRAM). Default
  `-1` resolves it from the driver's built-in table for the two panel sizes it knows (240×240 → `0, 0`; 135×240 →
  `52, 40`). Any other resolution needs both set explicitly, or the driver raises an error at flow-boot time.
  Getting it wrong doesn't error: it blits into the wrong window of GRAM, so content shows up clipped or offset.
  An ST7796 panel has no offset: leave both at `-1`.

Pins, bus, resolution, rotation, color order, inversion and data latch order vary board to board — there's no
sensible default that works for more than one board, so confirm these against your own panel. The defaults above
match a Cheap Yellow Display (ESP32-2432S028); a different board (or unit) may need different values.

## Wiring

**Input** — a raw RGB565-encoded buffer, exactly `width * height * 2` bytes, the same format
`framebuf.FrameBuffer` produces for an RGB565 surface. A wrong-length buffer raises a clear error rather than
silently desyncing the panel.

A message with a `y` key is a strip instead: whole rows, written starting at row `y`. The [gui screen](gui.md) node
sends strips, so a large display never needs a full frame in memory.

## Behavior

### RGB565 byte order

`framebuf.RGB565` stores each pixel in CPU-native (little-endian on ESP32) byte order, but SPI TFT controllers
including the ST7789 expect big-endian pixel bytes on the wire. This node forwards whatever bytes it's given as-is,
so a buffer built straight from `framebuf.FrameBuffer(..., framebuf.RGB565)` comes out with red and blue scrambled
(an intended pure green circle renders red). There's no MicroPython-level flag to pick big-endian storage. Fix:
byte-swap the buffer before handing it to this node —

```python
for i in range(0, len(buf), 2):
    buf[i], buf[i + 1] = buf[i + 1], buf[i]
```

— right after drawing, before `msg['payload'] = buf`. A color whose two bytes match (pure white `0xFFFF`, pure
black `0x0000`) is unaffected either way, which is why a swap bug can hide behind text and background colors.

### Indexed modes

Build an indexed frame with `framebuf.FrameBuffer(..., framebuf.<FORMAT>)`, where `<FORMAT>` matches the frame
format property:

| frame format | `framebuf` constant | bits/pixel | palette indices used | 240×320 frame size |
|---|---|---|---|---|
| `rgb565` (default) | `RGB565` | 16 | — (real color) | 153,600 bytes |
| `gs4` | `GS4_HMSB` | 4 | 0–15 (all 16) | 38,400 bytes |
| `gs2` | `GS2_HMSB` | 2 | 0–3 (first 4) | 19,200 bytes |
| `mono` | `MONO_HMSB` | 1 | 0–1 (first 2) | 9,600 bytes |

Send the `bytearray` itself as the payload (`msg['payload'] = buf`). `bytes(buf)` makes a second full-size copy the
board may not have memory for. For a flow that redraws often, keep the buffer in `context` and reuse it.

Pixel values are palette indices, not colors — this node expands each one to real color using the palette property.
Indexed modes have no byte-order gotcha: the palette already stores colors in the order this node expects.

The buffer isn't "1/N the size of RGB565": each row is padded to a whole number of bytes, so a width that isn't an
exact multiple of the format's pixels-per-byte (2 for `gs4`, 4 for `gs2`, 8 for `mono`) needs slightly more than a
flat `width * height / bitsPerByte` formula gives. This node works out and checks the real size, and names the
expected byte count on a mismatch.

`mono` needs `framebuf.MONO_HMSB` specifically, not `MONO_VLSB` or `MONO_HLSB`. MicroPython's three 1-bit formats
are not interchangeable — the wrong one silently produces a garbled image, not an error, because this node can't
tell which you used. `MONO_VLSB` packs pixels into vertical byte columns (the OLED convention **display i2c**
uses); this node streams rows, so `MONO_VLSB` won't work. `MONO_HLSB` and `MONO_HMSB` pack their 8 pixels-per-byte
in opposite orders; this node expects `MONO_HMSB`, and `MONO_HLSB` comes out with each row's pixels in the wrong
order.

Fewer colors as the depth drops, so these suit a UI with a fixed palette (buttons, status text, icons), not photos.
