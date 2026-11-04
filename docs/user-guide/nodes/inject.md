# inject

Sends one message with a fixed payload each time you click its ▶ icon while the editor is connected to the board.

## Properties

- **payload type** — `bool`, `number` or `string`. Default `bool`. The output's type follows it, so the editor
  checks the wire against the input it feeds (see [Wiring](../working-in-the-editor.md#wiring)).
- **value** — the value to send, read as the payload type. Default `true`.

The value is read in one of three ways, by payload type:

- `bool`: `true` sends `True`. Anything else sends `False`, including `True` and `1`.
- `number`: a whole number is sent as an `int`, any other number as a `float`. An empty value sends `0`.
- `string`: sent as typed.

## Wiring

**Input** — none. `inject` is a source.

**Output** — a message with `payload` set to the value and `topic` set to an empty string.

## Behavior

The ▶ icon and the rest of the node are separate click targets. The ▶ fires the node. A click anywhere else on the
node opens its property panel, connected or not.

Each click sends one message. `inject` never fires on its own, neither on a schedule nor when the flow starts, so a
flow whose only sources are `inject` nodes does nothing until you click one. To send a message when the flow starts,
use [startup](startup.md). To send one repeatedly, use [timer](timer.md).

## Errors

- **The editor isn't connected.** The console shows `[inject: connect to a device first -- clicking only fires while
  live]` and nothing is sent.
- **The value isn't a number,** with payload type `number`. The deploy goes through; the click fails on the board with
  a `[NODE_ERROR]` naming this node and `inject value 'abc' is not a valid number`. See
  [Reading a node error](../debugging.md#reading-a-node-error).
- **A node error in this node's chain** stops the chain. See
  [Reading a node error](../debugging.md#reading-a-node-error).
