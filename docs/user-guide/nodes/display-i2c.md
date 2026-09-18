# display i2c

Pushes an already-rendered frame to an I2C mono OLED panel (SSD1306 today — the `controller` property
leaves room for others later, like SH1106). Build the frame upstream (a `function` node using
`framebuf.FrameBuffer`, or eventually a graphics-framework node) and wire it into this node's input.

## Properties

- **controller** — the display chip. Only `SSD1306` today.
- **I2C bus** — which hardware I2C peripheral to use. Default 0.
- **frequency (Hz)** — I2C clock speed. Default 400kHz.
- **scl / sda pins** — required GPIO pins (0–39).
- **address** — the I2C address. Default `0x3C`.
- **width / height** — panel resolution in pixels. Height must be a multiple of 8.

Pins, bus, and address vary board to board — set these from your board's own pinout.

## Behavior

The input is a raw MONO_VLSB-encoded buffer, exactly `width * (height / 8)` bytes — the same format
`framebuf.FrameBuffer` produces for a 1-bit surface. A wrong-length buffer raises a clear error rather
than silently corrupting the display's internal buffer indexing.

Only I2C wiring is supported — an SSD1306 wired over SPI isn't covered by this node (see `display spi`
if that's ever needed for this chip).

No drawing primitives here — this node only pushes a complete, already-rendered frame on every message.
