# delay

Passes a message through unchanged, after waiting a configured interval.

## Properties

- **delay (ms)** — how long to hold the message before releasing it. Must be a positive number.

## Behavior

**The wait blocks the message's own source, not just this one message.** A `timer` node ticking every 200ms feeding a `delay` of 5000ms will not keep ticking every 200ms once a message reaches the delay — the timer's next tick can't fire until the whole chain, including the delay, finishes. This isn't unique to `delay` (any slow node has the same effect on its own source), but `delay`'s entire job is waiting, so it's worth knowing up front rather than discovering it as a mysteriously slowing timer.
