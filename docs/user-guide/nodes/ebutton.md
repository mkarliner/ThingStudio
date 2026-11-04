# ebutton

Reports presses, releases, long presses and double clicks from one button, ignoring contact bounce.

## Properties

- **pin** — the GPIO pin. Default 5.
- **pull** — the pin's own pull resistor: `none`, `up` or `down`. Default `none`, for a button with an external
  pull resistor or a module that has one.
- **sense** — the pin level when the button is not pressed: `auto`, `0` or `1`. Default `auto`, which takes the
  level when the flow starts as not pressed. Set it if the button may be held down at start.
- **suppress** — default off. When on, a click that may be the first half of a double click is held back (see
  Behavior).
- **debounce (ms)** — default 50. Must be 1 or more.
- **long press (ms)** — how long a press must last to count as `long`. Default 1000.
- **double click (ms)** — how soon a second press must follow the first to count as `double`. Default 400. Must be
  less than **long press**.

## Wiring

**Input** — none. `ebutton` is a source.

**Output** — a message for each event, with `payload` one of `press`, `release`, `long` or `double`, and `topic` an
empty string.

## Behavior

The events each action sends depend on **suppress**:

| Action | suppress off | suppress on |
| --- | --- | --- |
| a click | `press`, `release` | `press` and `release` together, after **double click** has passed |
| a double click | `press`, `release`, then `press` and `double` together, then `release` | `double`, `release` |
| a long press | `press`, `long`, `release` | `long`, `release` |

With suppress off, every press is reported at once. With it on, a click arrives later but never as part of a double
click or a long press, and a press held longer than **double click** but released before **long press** sends only
`release`.

## Errors

- **double click is not less than long press.** Deploy stops with `property "doubleClickMs" 1000 must be less than
  longPressMs (1000)`, naming the node.
- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
