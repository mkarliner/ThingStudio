# mqtt publish

Publishes a message's payload to an MQTT topic.

## Properties

- **topic** — the topic to publish to. Required.
- **retain** — publish as a retained message.
- **QoS** — `0` or `1`. QoS 2 isn't supported.
- **broker** — which MQTT broker config to use (see [Canvas basics](../canvas-basics.md#config-nodes)). Required — won't compile without one.

## Behavior

Uses the flow's `wifi_status` node for its WiFi connection, and its own referenced broker config for the MQTT connection — two independent config references, since WiFi credentials and broker credentials are different things. An "unmanaged" WiFi config isn't accepted here: this node manages its own WiFi reconnection, so it needs a real network to connect to. The payload is sent as bytes (a string is UTF-8 encoded, other types are converted).

Shows a connection-status dot on the canvas (see [Canvas basics](../canvas-basics.md#node-status)) once connected to a device — reports its own broker connection state even when it shares that broker with an `mqtt_subscribe` node. Because this node only runs when a message actually arrives to publish, the dot stays blank until the first message passes through it, even if the flow has been running for a while — it doesn't open its broker connection until there's actually something to send (Mike's call, 2026-09-11: not treated as a bug, since it matches the node's real behavior).
