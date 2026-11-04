# touch

Raw touch input, for flows that don't use the GUI: sends a message when a finger lands on a
[touch panel](touch-panel.md) and when it lifts.

A [gui screen](gui.md) reads its own panel, so buttons on a screen don't need this node. One panel feeds either one
gui screen or one `touch` node.

## Properties

- **Touch panel** — the [touch panel](touch-panel.md) to read. Required. Pick one, or add one with **+**.
- **orientation** — the turn of the picture the touches should match: `0`, `90`, `180` or `270` degrees clockwise,
  the angles a [display spi](display-spi.md)'s orientation takes. Default off, which leaves the panel's own axes.
  Set it when the screen is turned and the flow reads touch through this node; a flow with a gui screen sets the
  orientation on the display instead.

## Wiring

**Input** — none. `touch` is a source.

**Output** — one message when a finger lands and one when it lifts:

```python
{'payload': {'x': 120, 'y': 340}, 'topic': 'down'}   # a finger lands
{'payload': {'x': 121, 'y': 338}, 'topic': 'up'}     # it lifts, where it was last seen
```

The coordinates are screen pixels in the turned picture when **orientation** is set, and in the panel's own axes when
it is off. There is nothing to calibrate.

## Behavior

The node reads the panel at the panel's **poll every (ms)**. Nothing is sent while the finger moves, and only one
finger is followed. The status dot shows **FT6336U** while the panel answers.

A panel that stops answering sends nothing until it answers again. A touch that was down at the time gets its `up`
then.

## Errors

- **The panel doesn't answer.** The dot shows **disconnected**, `no reply from FT6336U at 0x38 on I2C bus 0`.
- **No touch panel, or a panel also used by a gui screen or another touch node.** Deploy stops and names them.
