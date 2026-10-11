# mqtt subscribe

Emits one message per incoming message on a subscribed MQTT topic.

## Properties

- **topic** — the topic to subscribe to. Required.
- **QoS** — `0` or `1`. QoS 2 isn't supported.
- **broker** — which MQTT broker config to use (see [Editor in depth](../working-in-the-editor.md#config-nodes)). Required — won't compile without one.

## Behavior

Uses the flow's WiFi network and its own broker config, same as **mqtt publish**. An "unmanaged" WiFi config isn't accepted here, for the same reason.

The message carries the payload (decoded as text when possible, raw bytes otherwise), the actual topic it arrived on, and whether the broker sent it as a retained message.

A subscription isn't guaranteed to be fully confirmed before an **mqtt publish** node on the same broker sends its first message. This is usually not an issue, but an early publish can go unheard by a subscriber that was still connecting.

Shows a connection-status dot on the canvas (see [Editor in depth](../working-in-the-editor.md#node-status)) once connected to a device, same as **mqtt publish**.
