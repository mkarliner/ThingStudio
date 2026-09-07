# mqtt publish

Publishes a message's payload to an MQTT topic.

## Properties

- **topic** — the topic to publish to. Required.
- **retain** — publish as a retained message.
- **QoS** — `0` or `1`. QoS 2 isn't supported.
- **broker** — which MQTT broker config to use (see [Canvas basics](../canvas-basics.md#config-nodes)). Required — won't compile without one.

## Behavior

Uses the flow's `wifi_status` node for its WiFi connection, and its own referenced broker config for the MQTT connection — two independent config references, since WiFi credentials and broker credentials are different things. An "unmanaged" WiFi config isn't accepted here: this node manages its own WiFi reconnection, so it needs a real network to connect to. The payload is sent as bytes (a string is UTF-8 encoded, other types are converted).
