# touch

Reads a capacitive touch panel on an I2C bus (an FT6336U, as on the Freenove ESP32-S3 4.0" display) and
sends a message when a finger lands and when it lifts. Wire it to a [gui touch](gui.md) node to press buttons
on the screen.

## Properties

- **I2C bus** — the bus the panel is wired to. See [I2C buses](i2c-bus.md). On the Freenove board: SDA 16, SCL 15.
- **reset pin** — the panel's reset pin, if it has one (Freenove: 18). Blank for none.
- **poll every (ms)** — how often to look. 20 is smooth; more than 50 starts to feel slow.
- **panel width / height** — the panel's own size in pixels (Freenove: 320 × 480).
- **swap x and y / flip x / flip y** — turn the panel's coordinates into the display's. If the display is
  rotated, tick these until a touch lands where you pressed.

## Output

```python
msg = {'payload': {'x': 120, 'y': 340}, 'topic': 'down'}   # a finger lands
msg = {'payload': {'x': 121, 'y': 338}, 'topic': 'up'}     # it lifts, where it was last seen
```

Down and up only: nothing is sent while the finger moves, and only one finger is followed. The coordinates are
screen pixels; there is nothing to calibrate.

## Behavior

The status dot shows whether the panel is answering (`FT6336U`, or `no reply at 0x38 on I2C bus 0`). A missing
panel sends nothing and is picked up when it appears.
