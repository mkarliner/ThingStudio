# timer

Emits an increasing count on a fixed interval — a heartbeat with a sequence number, not a repeated value.

## Properties

- **interval (ms)** — how often to emit. Must be a positive number.

## Behavior

The payload is a whole number that starts at 1 and increases by one on every tick — not a fixed constant. Each `timer` node keeps its own independent counter, even if two of them share the same interval.
