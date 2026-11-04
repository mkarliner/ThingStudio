# gpio out

Sets a pin high or low from each message.

## Properties

- **pin** — the GPIO pin. Default 12.

## Wiring

**Input** — `payload`, read with Python's `bool()`: a true value sets the pin high, a false one (`False`, `0`,
`""`, `None`, an empty list) sets it low. A message with no `payload` sets it low. The input is type `bool`, so any
output can wire to it.

This node has no output.

## Behavior

The pin stays where the last message set it. It is set up as an output when the flow starts, before any message
arrives.

## Errors

- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
