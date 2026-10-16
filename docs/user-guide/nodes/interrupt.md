# interrupt

Fires immediately when a GPIO pin changes state — genuinely event-driven, not polled.

## Properties

- **pin** — GPIO pin number. Checked against your [board](../boards.md).
- **edge** — `rising`, `falling`, or `both`.

## Behavior

The payload is the pin's level (`true`/`false`) at the moment the node wakes — a level, not a record of every
intermediate change.

No internal pull resistor is configured. Wire an external pull resistor, or use a button module with one built in.

For a debounced switch or button, use [eswitch](eswitch.md) or [ebutton](ebutton.md) — they ignore contact bounce.
`interrupt` is the raw edge node.

Two `interrupt` nodes on the same pin must have the same edge, or the compile stops. See
[Hardware is shared](index.md#hardware-is-shared).
