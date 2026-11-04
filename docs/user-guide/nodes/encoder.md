# encoder

Reads a rotary encoder (a quadrature knob) and sends its value each time it turns.

## Properties

- **pin x** / **pin y** — the encoder's two switch pins. Defaults 10 and 11. Both are read with the pins' own
  pull-ups. If the value counts the wrong way, swap them.
- **divide by (div)** — pulses per step of the value: `4` or `2` for a knob that clicks, so one click is one step;
  `1` counts every pulse. Default 1.
- **start value** — the value when the flow starts. Default 0.
- **lowest (blank for none)** / **highest (blank for none)** — whole numbers the value stops at. Default blank.
- **wrap at (blank for none)** — a whole number: the value counts from `0` to one less than it, then wraps. Default
  blank.
- **settle (ms)** — how long to wait after the knob moves before sending the value. Default 100. Must be 0 or
  more.

The value is divided first, then held within lowest and highest, then wrapped.

## Wiring

**Input** — none. `encoder` is a source.

**Output** — a message with `payload` set to the value, `delta` set to how far it moved since the last message
(negative when it went down), and `topic` an empty string.

## Behavior

When the knob moves, the node waits **settle**, then sends the value it has reached. A fast turn gives about one
message per **settle**, not one per pulse. A turn that ends where it started sends nothing.

## Errors

- **start value is below lowest or above highest.** The board reports `Incompatible args: must have vmin <= v <=
  vmax` when the flow starts.
- **lowest, highest or wrap at isn't a whole number.** Deploy stops with `property "vmin" "x" must be a whole number
  (decimal or 0x hex)`, naming the node.
- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
