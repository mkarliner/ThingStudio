# gpio out

Drives a GPIO pin high or low based on an incoming message.

## Properties

- **pin** — GPIO pin number. Checked against your [board](../boards.md).

## Behavior

A truthy `payload` sets the pin high, a falsy one sets it low, using Python's own truth test. `0`, `""`, `None` and
`False` are low; a `bool` input works as you'd expect, and other types convert to one of the two.
