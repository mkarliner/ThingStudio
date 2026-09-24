# gpio out

Drives a GPIO pin high or low based on an incoming message.

## Properties

- **pin** — GPIO pin number. Checked against your [board](../boards.md).

## Behavior

Any truthy payload sets the pin high; anything falsy sets it low. Since the incoming wire can be any type, "truthy" follows Python's own rule (`0`, `""`, `None`, and `False` are falsy; nearly everything else is truthy) — a `bool` input works exactly as you'd expect, and other types convert sensibly too.
