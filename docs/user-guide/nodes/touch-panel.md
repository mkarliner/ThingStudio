# Touch panels

The settings of a capacitive touch panel on an I2C bus, set once in a config node. A [gui screen](gui.md) or a
[touch](touch-i2c.md) node picks it.

A gui screen reads its panel itself and turns touches into button presses, with no wire to draw. If the panel stops
answering, the screen's status dot says so, and a button being held is let go without sending.

## Settings

- **controller** — the touch chip. Default `FT6336U`.
  [Supported hardware](../supported-hardware.md#touch-panels) lists the chips.
- **I2C bus** — the bus the panel is wired to. Required. See [I2C bus](i2c-bus.md).
- **address** — the chip's 7-bit I2C address, from `0x08` to `0x77`. Default `0x38`, the FT6336U's.
- **reset pin** — the panel's reset pin. Default blank, for none.
- **poll every (ms)** — how often to read the panel. Default 20; above 50 starts to feel slow.
- **panel width** / **panel height** — the panel's own size in pixels. Defaults 320 and 480.
- **swap x and y** / **flip x** / **flip y** — turn the panel's coordinates into the display's. Default off. If the
  display is turned, tick these until a touch lands where you pressed.

A board definition that has a touch panel labels its pins; see
[Seeing a board's pins](../boards.md#seeing-a-boards-pins).

## Presets

The edit form has a **preset** control, as the display nodes do. Fill in the settings once, press the disk button and
give the set a name, such as `freenove-4in`. In another flow, open a new touch panel and pick that name to fill the
form. The I2C bus isn't saved with it, since it belongs to the flow: pick or add it after loading.

## Rotated screens

When the display a gui screen is wired to has an [orientation](gui.md#rotating-the-screen), the screen turns its
touches to match the picture. A [touch](touch-i2c.md) node turns them by its own **orientation**.

## Other touch chips

For another chip, such as a GT911 or CST820, read it from a [function](function.md) node with
`runtime.shared('i2c', 0)`, using the chip's datasheet and a MicroPython driver for it. See
[MicroPython's machine.I2C](https://docs.micropython.org/en/latest/library/machine.I2C.html) for the I2C calls.

## Errors

These stop the deploy:

- No I2C bus: `the touch panel has no I2C bus. Pick one, or add one with +.`
- An address outside `0x08` to `0x77`.
- A controller other than FT6336U.
