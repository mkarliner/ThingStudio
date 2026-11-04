# eswitch

Reports when a switch opens or closes, ignoring contact bounce.

## Properties

- **pin** — the GPIO pin. Default 4.
- **pull** — the pin's own pull resistor: `none`, `up` or `down`. Default `none`, for a switch with an external
  pull resistor or a module that has one.
- **open level (lopen)** — the pin level that means open: `1` for a switch to ground with a pull-up, `0` for a
  switch to 3V3 with a pull-down. Default `1`.
- **debounce (ms)** — how long a level must hold before it counts. Default 50. Must be 1 or more.

## Wiring

**Input** — none. `eswitch` is a source.

**Output** — a message for each change, with `payload` `True` when the switch closes and `False` when it opens, and
`topic` an empty string. `payload` is a bool, so it can wire straight to a [gpio out](gpio-out.md) to mirror the
switch.

## Behavior

The node checks the pin every **debounce** interval. It sends nothing when the flow starts, only on a change.

## Errors

- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
