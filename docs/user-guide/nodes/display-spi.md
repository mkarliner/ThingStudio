# display spi

Shows a frame on an SPI color TFT panel. The frame comes from a [gui screen](gui.md), or from a
[function](function.md) node that draws with `framebuf`. [Supported hardware](../supported-hardware.md#displays)
lists the display chips.

## Properties

The property panel's **preset** picker saves a panel's whole setup under a name and loads it on another node (see
[Presets](../working-in-the-editor.md#presets)). Pins, size, rotation and color settings differ from board to board,
so check them against your own panel, or use a board's labelled pins (see
[Seeing a board's pins](../boards.md#seeing-a-boards-pins)).

- **controller** — the display chip: `ST7789` or `ST7796 (320x480)`. Default `ST7789`.
- **frame format** — the frame the node takes. Default `rgb565`, full color at 2 bytes a pixel. The indexed formats
  use less memory and fewer colors: `gs4` (16 colors, a quarter of the memory), `gs2` (4 colors, an eighth) and `mono`
  (2 colors, a sixteenth). A gui screen wired to the display draws in this format.
- **palette** — the 16 RGB565 colors the indexed formats use: `gs4` all 16, `gs2` the first 4, `mono` the first 2.
  Shown as swatches under **frame format** when an indexed format is picked; click one to change it, or **reset**
  for the built-in colors. While a gui screen with a [theme](gui.md#themes) is wired to the display, the theme sets
  the palette and this one is ignored.
- **SPI bus** — the hardware SPI peripheral. Default 2.
- **baudrate** — the SPI clock in Hz. Default 40000000.
- **sck pin** / **mosi pin** / **dc pin** — required. Defaults 12, 11 and 13.
- **cs pin** / **reset pin** / **backlight pin** — `-1` when not wired, the default for all three. Some boards tie
  reset or CS in hardware, or have no backlight control.
- **width (px)** / **height (px)** — the panel's own size. Defaults 135 and 240. A gui screen wired to the display
  takes this size.
- **orientation** — default off. `0`, `90`, `180` or `270` turns the picture clockwise, and a gui screen wired to the
  display turns its size and touch to match. With an orientation, set **width** and **height** to the panel's own
  size, **rotation** to how the panel is mounted (0 to 3), and **xstart** and **ystart** to `-1`. See
  [Rotating the screen](gui.md#rotating-the-screen). A flow that reads touch with a [touch](touch-i2c.md) node sets
  the same angle on that node.
- **rotation (0-7)** — the controller's own orientation code. Default 1.
- **color order** — `BGR` or `RGB`, as the panel is wired. Default `BGR`.
- **invert colors** — for a panel that shows the negative. Default off.
- **data latch order (MH bit)** — a controller bit some panels need, with rotation, for the right left-to-right
  order. Default on.
- **xstart** / **ystart** — the panel's offset in the ST7789's larger frame memory. Default `-1`, which takes it from
  the driver's table: `0, 0` for 240x240, `52, 40` for 135x240. Any other ST7789 size needs both set. A wrong offset
  doesn't raise an error: the picture shows clipped or shifted. An ST7796 has no offset; leave both at `-1`.

## Wiring

**Input** — `payload` is the frame, in the **frame format**. A whole frame is exactly the size the format needs:
`width * height * 2` bytes for `rgb565`; for the indexed formats, see Indexed formats below.

A message with a `y` field is a strip: whole rows, written from row `y` down. A gui screen sends strips, so a large
display never needs a whole frame in memory.

This node has no output.

## Behavior

### RGB565 byte order

`framebuf.RGB565` stores each pixel in the processor's byte order, little-endian on an ESP32, but the panel expects
big-endian. The node sends the bytes as they are, so a buffer drawn with `framebuf.FrameBuffer(..., framebuf.RGB565)`
comes out with its colors wrong: an intended green shows red. Swap each pair of bytes after drawing, before
`msg['payload'] = buf`:

```python
for i in range(0, len(buf), 2):
    buf[i], buf[i + 1] = buf[i + 1], buf[i]
```

A color whose two bytes are the same, such as white `0xFFFF` or black `0x0000`, looks right either way, so text on a
plain background can hide the problem.

### Indexed formats

Draw an indexed frame with `framebuf.FrameBuffer(..., framebuf.<FORMAT>)`, with the constant that matches **frame
format**:

| frame format | `framebuf` constant | bits per pixel | palette entries used | 240x320 frame |
| --- | --- | --- | --- | --- |
| `rgb565` | `RGB565` | 16 | none, real color | 153,600 bytes |
| `gs4` | `GS4_HMSB` | 4 | 0–15 | 38,400 bytes |
| `gs2` | `GS2_HMSB` | 2 | 0–3 | 19,200 bytes |
| `mono` | `MONO_HMSB` | 1 | 0–1 | 9,600 bytes |

Pixel values are palette entries, not colors; the node turns each into its palette color as it writes. The indexed
formats have no byte-order problem.

Each row is padded to a whole byte, so a width that isn't a multiple of the pixels per byte (2 for `gs4`, 4 for `gs2`,
8 for `mono`) needs a little more than `width * height * bits / 8`. On a wrong size the node names the size it
expects.

`mono` needs `framebuf.MONO_HMSB`. `MONO_VLSB` (the [display i2c](display-i2c.md) layout) and `MONO_HLSB` give a
garbled picture with no error, because the node can't tell which one was used.

Send the `bytearray` itself (`msg['payload'] = buf`): `bytes(buf)` makes a second copy the board may not have memory
for. For a flow that redraws often, keep the buffer in `context` and reuse it.

## Errors

- **A frame or strip of the wrong size.** The console shows a `[NODE_ERROR]` naming this node, such as
  `display_spi: expected 64800 bytes (...), got 64000`, or for a strip
  `display_spi: a strip must be whole rows of 270 bytes inside the 240-row screen, ...`. See
  [Reading a node error](../debugging.md#reading-a-node-error).
- **An ST7789 size other than 240x240 or 135x240, with xstart and ystart at -1.** The board reports
  `Unsupported display. Only 240x240 and 135x240 are supported without xstart and ystart provided` when the flow
  starts.
- **An orientation with a panel offset**, including the default 135x240 size. Deploy stops: clear the orientation,
  or set **rotation** by hand.
- **An orientation with a rotation of 4 to 7.** Deploy stops; with an orientation, rotation is 0 to 3.
- **A baudrate too fast for the board or for these pins.** Deploy stops and gives the board's limit.
- **A changed palette while a themed gui screen is wired.** Deploy warns that the theme sets the palette.
- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
