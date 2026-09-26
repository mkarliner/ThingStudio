# display i2c

Pushes an already-rendered frame to an I2C mono OLED panel (SSD1306 today — the `controller` property
leaves room for others later, like SH1106). Build the frame upstream (a `function` node using
`framebuf.FrameBuffer`, or eventually a graphics-framework node) and wire it into this node's input.

This node's property panel has a **preset** picker (see [Canvas basics](../canvas-basics.md#presets)) —
save a real panel's pin/address setup under a name once, then load it again on this or another
`display_i2c` node instead of retyping it.

## Properties

- **controller** — the display chip. Only `SSD1306` today.
- **I2C bus** — the bus the panel is wired to. See [I2C buses](i2c-bus.md).
- **address** — the I2C address. Default `0x3C`.
- **width / height** — panel resolution in pixels. Height must be a multiple of 8.

A flow saved before I2C buses existed has its pins on the node. The editor moves them into an I2C bus
when it opens the flow. Save the flow to keep the change.

## Behavior

The input is a raw MONO_VLSB-encoded buffer, exactly `width * (height / 8)` bytes — the same format
`framebuf.FrameBuffer` produces for a 1-bit surface. A wrong-length buffer raises a clear error rather
than silently corrupting the display's internal buffer indexing.

Only I2C wiring is supported — an SSD1306 wired over SPI isn't covered by this node (see `display spi`
if that's ever needed for this chip).

No drawing primitives here — this node only pushes a complete, already-rendered frame on every message.
