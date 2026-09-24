# startup

Sends one message with a fixed payload each time the flow starts.

## Properties

- **payload type** — `bool`, `number`, or `string`.
- **value** — the fixed value to send, matching the chosen type.

## Behavior

The flow starts after every Deploy, and again whenever the board resets or powers up with a saved flow.
So `startup` runs even when the editor isn't connected. Use it for setup work, such as setting an output
to a known state or drawing a first screen.

It fires once per start and never repeats. For a message you trigger by hand, use [inject](inject.md).
For a repeating one, use [timer](timer.md).
