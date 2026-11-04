# pwm out

Drives a PWM signal on a pin, for dimming an LED, setting a motor's speed, or any other variable duty cycle.

## Properties

- **pin** — the GPIO pin. Default 12.
- **frequency (Hz)** — the PWM frequency. Default 1000. Must be 1 or more.

## Wiring

**Input** — `payload` is the duty cycle as a fraction, from `0.0` (always off) to `1.0` (always on). A value below 0
is taken as 0 and one above 1 as 1. `True` and `False` work as 1 and 0. A string, even `"0.5"`, fails: convert it
first, in a [function](function.md) node. A message with no `payload` sets the duty to 0.

This node has no output.

## Behavior

The duty cycle stays where the last message set it.

## Errors

- **The payload is a string or another non-number.** The console shows a `[NODE_ERROR]` naming this node. See
  [Reading a node error](../debugging.md#reading-a-node-error).
- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
