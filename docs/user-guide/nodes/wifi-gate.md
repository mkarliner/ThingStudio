# wifi gate

Passes a message through unchanged if the WiFi station is currently connected, or drops it if it isn't.

## Properties

None.

## Behavior

A `transform`, like `function` or `delay` — one input, one output, same `msg` in and out unchanged when the WiFi link is up. When the link is down, the message is dropped: nothing propagates past this node, the same way a `function` node's `return None` stops a message.

Uses the flow's WiFi network (its **WiFi** field, shared by every WiFi node).

This checks the WiFi station's live link state at the moment each message arrives, not a value read off `wifi status`'s own output messages. `wifi status` only emits when its connection identity changes, so a fast-firing source (a timer or sensor) gated off `wifi status`'s wire could be checking stale state. This node reads the hardware directly, so it always answers "is the link up right now."

A GPIO, timer or sensor source fires on its own schedule with no awareness of whether WiFi is up. Put a `wifi gate` between that source and whatever sends the result over the network: messages that arrive while the link is down are dropped instead of failing downstream (or queuing for a retry a node like `http request` might otherwise attempt).

This only checks the WiFi link itself — not whether a specific MQTT broker or HTTP server is reachable beyond that. `mqtt publish`, `mqtt subscribe` and `http request` already handle their own connection lifecycle on top of a working WiFi link.
