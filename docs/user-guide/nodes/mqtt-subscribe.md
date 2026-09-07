# mqtt subscribe

Emits one message per incoming message on a subscribed MQTT topic.

## Properties

- **topic** — the topic to subscribe to. Required.
- **QoS** — `0` or `1`. QoS 2 isn't supported.
- **broker** — which MQTT broker config to use (see [Canvas basics](../canvas-basics.md#config-nodes)). Required — won't compile without one.

## Behavior

Uses the flow's `wifi_status` node for its WiFi connection and its own referenced broker config for the MQTT connection, same as `mqtt_publish`. An "unmanaged" WiFi config isn't accepted here, for the same reason.

The message carries the payload (decoded as text when possible, raw bytes otherwise), the actual topic it arrived on, and whether the broker sent it as a retained message.

There's currently no guarantee that a subscription is fully confirmed before an `mqtt_publish` node on the same broker sends its first message — usually not an issue, but worth knowing if an early publish goes unheard by a subscriber that was still connecting.
