# touch

Raw touch input, for flows that don't use the GUI. It reads a capacitive touch panel and sends a message when
a finger lands and when it lifts.

A [gui screen](gui.md) reads its panel itself, so you don't need this node to press buttons. One panel can't be
used by both a gui screen and a touch node: Deploy stops and names them.

## Properties

- **touch panel** — which [touch panel](touch-panel.md) to read. Pick one, or add one with **+**.

## Output

```python
msg = {'payload': {'x': 120, 'y': 340}, 'topic': 'down'}   # a finger lands
msg = {'payload': {'x': 121, 'y': 338}, 'topic': 'up'}     # it lifts, where it was last seen
```

Down and up only: nothing is sent while the finger moves, and only one finger is followed. The coordinates are
screen pixels; there is nothing to calibrate.

## Behavior

The status dot shows whether the panel is answering (`FT6336U`, or `no reply from FT6336U at 0x38 on I2C bus 0`).
A missing panel sends nothing and is picked up when it appears. A panel that disappears mid-touch still sends its
`up`.
