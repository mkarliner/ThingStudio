# timer

Sends a count that goes up by one at a fixed interval.

## Properties

- **interval (ms)** — the time between messages, in milliseconds. Default 1000. A whole number, 1 or more.

## Wiring

**Input** — none. `timer` is a source.

**Output** — a message with `payload` set to the count, an `int`: 1, 2, 3 and so on. `topic` is an empty string.

## Behavior

The first message goes out as soon as the flow starts, then one each interval. The interval starts once the previous
message has finished going through the chain, so a slow node after the timer, such as a [delay](delay.md), adds its
time to every interval.

Each `timer` node keeps its own count, starting at 1 when the flow starts, even when two share an interval.

## Errors

- **The interval is less than 1.** Deploy stops with `property "intervalMs" 0 is below its minimum, 1`, naming the
  node.
- **The interval isn't a whole number.** Deploy stops with `"intervalMs" must be a whole number of milliseconds`,
  naming the node.
- **A node error in this node's chain** stops the chain. See
  [Reading a node error](../debugging.md#reading-a-node-error).
