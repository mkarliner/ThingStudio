# Touch panels

A touch panel is a capacitive touch screen on an I2C bus. Its settings are set once, in a config node, and a
[gui screen](gui.md) or a [touch](touch-i2c.md) node picks it.

On a gui screen, pick the panel in the screen's properties. The screen reads it itself and turns touches into
button presses. There is no wire to draw. If the panel stops answering, the screen's status dot says so, and any
button being held is let go without sending.

## Settings

- **controller** — the touch chip. Only the FT6336U (as on the Freenove ESP32-S3 displays) is supported so far.
- **I2C bus** — the bus the panel is wired to. See [I2C buses](i2c-bus.md). On the Freenove 4.0" board: SDA 16,
  SCL 15.
- **address** — the chip's I2C address. 0x38 for the FT6336U.
- **reset pin** — the panel's reset pin, if it has one (Freenove: 18). Blank for none.
- **poll every (ms)** — how often to look. 20 is smooth; more than 50 starts to feel slow.
- **panel width / height** — the panel's own size in pixels (Freenove: 320 × 480).
- **swap x and y / flip x / flip y** — turn the panel's coordinates into the display's. If the display is
  rotated, tick these until a touch lands where you pressed.

## Other touch chips

GT911, CST820 and others aren't supported yet. Read one from a [function](function.md) node with
`runtime.shared('i2c', 0)`, using the chip's datasheet and a MicroPython driver for it. See
[docs.micropython.org](https://docs.micropython.org/en/latest/library/machine.I2C.html) for the I2C calls.
