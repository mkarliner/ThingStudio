# display spi

Pushes an already-rendered frame to an SPI color TFT panel (ST7789 today — the `controller` property
leaves room for others later). Build the frame upstream (a `function` node using `framebuf.FrameBuffer`,
or eventually a graphics-framework node) and wire it into this node's input.

## Properties

- **controller** — the display chip. Only `ST7789` today.
- **SPI bus** — which hardware SPI peripheral to use. Default 2.
- **baudrate** — SPI clock speed. Default 40MHz.
- **sck / mosi / dc pins** — required GPIO pins (0–39).
- **cs / reset / backlight pins** — optional GPIO pins (0–39, or −1 for "not wired"). Some boards tie
  reset or CS high in hardware and don't expose them as GPIOs, or have no backlight control at all.
- **width / height** — panel resolution in pixels.
- **rotation** — 0–7, the panel's MADCTL orientation code.
- **xstart / ystart** — the panel's offset into the ST7789 controller's own (larger) GRAM. Default `-1`,
  which lets the vendored driver's own built-in table resolve this automatically for the two panel sizes
  it knows about (240×240 → `0, 0`; 135×240, including the EMF 2022 TiDAL badge's own panel → `52, 40`).
  Any other resolution needs `xstart`/`ystart` set explicitly, or the driver raises a clear error at
  flow-boot time rather than silently guessing. Getting this wrong doesn't error either way — it just
  blits into the wrong window of the controller's real GRAM, so content shows up clipped/offset and the
  visible glass shows whatever stale pixels were already sitting in the uncovered part of memory
  (confirmed on real TiDAL hardware, 2026-09-18 — see `test-flows/README.md`'s
  `display-spi-tidal-test.flow.json` section for the full story).

Pins, bus, and resolution vary board to board — there's no sensible default that works for more than one
board, so set these from your board's own pinout.

## Behavior

The input is a raw RGB565-encoded buffer, exactly `width * height * 2` bytes — the same format
`framebuf.FrameBuffer` produces for an RGB565 surface. A wrong-length buffer raises a clear error rather
than silently desyncing the panel.

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

— right after drawing, before `msg['payload'] = bytes(buf)`. A color where both bytes happen to match
(pure white `0xFFFF`, pure black `0x0000`) is unaffected either way, which is why a swap bug can hide
behind text/background colors and only show up on saturated colors like a pure green or blue fill.

No drawing primitives here — this node only pushes a complete, already-rendered frame on every message.
