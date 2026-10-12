# encoder

Reads a quadrature encoder (a rotary knob) and sends its value each time it turns. Pin numbers are checked against
your [board](../boards.md).

## Properties

- **pin x / pin y** — the encoder's two switch pins, read with internal pull-ups.
- **divide by (div)** — the pulses in one detent: `4` or `2` for a mechanical knob's clicks, `1` for every pulse.
- **start value** — the value it starts from.
- **lowest / highest** — optional limits; the value stops at them (blank for none).
- **wrap at (mod)** — optional: the value counts `0` to `mod - 1` and wraps (blank for none).
- **settle (ms)** — how long to wait for motion to stop; also the shortest gap between messages.

## Wiring

**Output** — the value, with the change since the last message:

```python
msg = {'payload': 0, 'topic': '', 'delta': 0}
```

`payload` is the current value; `delta` is how far it moved, positive or negative.

Two `encoder` nodes on the same pins share one encoder, so they must have the same settings, or the compile stops.
See [Hardware is shared](index.md#hardware-is-shared).
