# interrupt

Sends a message the moment a pin changes state.

## Properties

- **pin** — the GPIO pin. Default 4.
- **edge** — the change to react to: `rising`, `falling` or `both`. Default `rising`.

## Wiring

**Input** — none. `interrupt` is a source.

**Output** — a message with `payload` set to the pin's level, `True` or `False`, read when the node handles the
change. `topic` is an empty string.

## Behavior

The pin's interrupt wakes the node, and the node reads the pin then. Changes that come faster than the flow handles
them are collapsed into one message, so `payload` is the level at that moment, not a record of every change.

The pin has no pull resistor. Wire an external one, or use a module with one built in. For a button or switch, use
[ebutton](ebutton.md) or [eswitch](eswitch.md), which ignore contact bounce and can use the pin's own pull resistor.

## Errors

- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
