# wifi gate

Passes a message through unchanged if the WiFi station is currently connected, or drops it if it isn't.

## Properties

None.

## Behavior

A `transform`, like `function` or `delay` — one input, one output, same `msg` in and out unchanged when the WiFi link is up. When the link is down, the message is dropped: nothing propagates past this node, the same way a `function` node's own `return null` stops a message.

Uses the flow's WiFi network (its **WiFi** field, shared by every WiFi node).

This checks the WiFi station's live link state at the moment each message arrives, not a value read off `wifi_status`'s own output messages. `wifi_status` only emits when its connection identity changes, so a fast-firing source (a timer or sensor) gated off `wifi_status`'s wire could easily be checking stale state; this node reads the hardware directly instead, so it's always answering "is the link up right now."

The motivating case: a GPIO/timer/sensor source fires on its own schedule with no awareness of whether WiFi happens to be up. Put a `wifi_gate` between that source and whatever sends the result over the network, and messages that arrive while the link is down are quietly dropped instead of failing downstream (or queuing up for a retry a node like `http_request` might otherwise attempt).

This only checks the WiFi link itself — not whether a specific MQTT broker or HTTP server is reachable beyond that. `mqtt_publish`/`mqtt_subscribe` and `http_request` already handle their own connection lifecycle on top of a working WiFi link.
