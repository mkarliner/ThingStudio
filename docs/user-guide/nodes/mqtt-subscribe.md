# mqtt subscribe

Emits one message per incoming message on a subscribed MQTT topic. With dynamic subscription on, its input changes
the subscriptions while the flow runs.

## Properties

- **topic** — the topic to subscribe to. Required.
- **QoS** — `0` or `1`. QoS 2 isn't supported.
- **dynamic subscription** — accept subscribe/unsubscribe messages on the input (see below). Off by default.
- **broker** — which MQTT broker config to use (see [Editor in depth](../working-in-the-editor.md#config-nodes)). Required — won't compile without one.

## Behavior

The node subscribes to **topic** when the flow starts, and keeps it subscribed.

Uses the flow's WiFi network and its own broker config, same as **mqtt publish**. An "unmanaged" WiFi config isn't accepted here, for the same reason.

The message carries the payload (decoded as text when possible, raw bytes otherwise), the actual topic it arrived on, and whether the broker sent it as a retained message.

**Dynamic subscription.** With it on, an input message changes what the node listens to:

- `msg.action` is `subscribe` or `unsubscribe`.
- `msg.topic` is a topic string, a `{topic, qos}` object, or a list of either.

`unsubscribe` stops the node receiving that topic. Two nodes subscribed to the same topic are independent: one
unsubscribing doesn't stop the other. The configured **topic** is subscribed at start, so turning dynamic
subscription on doesn't interrupt anything; an `unsubscribe` for it takes effect until the next reload.

With dynamic subscription off, a message on the input raises an error rather than being ignored. An unknown action,
or an action without a topic, raises an error too.

A subscription isn't guaranteed to be fully confirmed before an **mqtt publish** node on the same broker sends its first message. This is usually not an issue, but an early publish can go unheard by a subscriber that was still connecting.

Shows a connection-status dot on the canvas (see [Editor in depth](../working-in-the-editor.md#node-status)) once connected to a device, same as **mqtt publish**.
