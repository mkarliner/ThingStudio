# delay

Passes each message on unchanged, after a wait.

## Properties

- **delay (ms)** — how long to hold each message, in milliseconds. Default 1000. Must be 1 or more. A fraction is
  rounded down.

## Wiring

**Input** — any message.

**Output** — the same message, after the wait.

## Behavior

The wait holds the whole chain the message is in, back to its source. The source sends nothing new until the
message has gone all the way through. A [timer](timer.md) set to 200 ms, wired into a 5000 ms `delay`, sends a
message every 5.2 seconds, not every 200 ms.

Messages from different chains don't wait for each other, even when they pass through the same `delay` node.

## Errors

- **The delay is less than 1.** Deploy stops with `property "delayMs" 0 is below its minimum, 1`, naming the node.
