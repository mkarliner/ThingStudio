# mqtt subscribe

Sends a message for each message that arrives on an MQTT topic.

## Properties

- **topic** — the topic to subscribe to. Required. `+` matches one level and `#` the rest, as usual in MQTT.
- **QoS** — `0` or `1`. Default 0. QoS 2 isn't supported.
- **dynamic subscription** — let messages on the input change the subscriptions (see below). Default off.
- **MQTT Broker** — the flow's MQTT broker, shared by every MQTT node in the flow: change it on one and it changes on
  all (see [Editor in depth](../working-in-the-editor.md#config-nodes)). Required.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow. **unmanaged** isn't accepted in a flow with
  MQTT nodes, because they manage the connection themselves.

## Wiring

**Input** — only with dynamic subscription on. See below.

**Output** — one message per message received:

| Field | Value |
| --- | --- |
| `payload` | the message body, decoded as UTF-8 text |
| `topic` | the topic it arrived on, which can differ from the subscription when that has a wildcard |
| `retained` | `True` when the broker sent it as a retained message |

## Behavior

The node subscribes to **topic** when the flow starts and keeps the subscription across reconnects. Nodes on the same
broker share one connection and subscribe independently.

The node holds up to 20 messages that haven't been sent on yet. When more arrive, the oldest is dropped.

A subscription may not be confirmed by the broker before an [mqtt publish](mqtt-publish.md) node on the same broker
sends its first message. An early publish can go unheard.

The status dot shows this node's own view of the connection, as for mqtt publish.

### Dynamic subscription

With it on, an input message changes what the node listens to:

| Field | Value |
| --- | --- |
| `action` | `subscribe` or `unsubscribe` |
| `topic` | a topic string, a `{topic, qos}` object, or a list of either |

An unsubscribe stops this node receiving that topic. Another node subscribed to the same topic keeps receiving it. The
configured **topic** can be unsubscribed too, until the flow is next reloaded.

## Errors

- **The board can't reach the broker.** The dot turns red and the console shows `mqtt connect to HOST:PORT failed after
  3 attempts`, with the reason for each attempt. See
  [MQTT broker unreachable](../debugging.md#mqtt-broker-unreachable).
- **The subscribe fails.** The console shows `mqtt subscribe to HOST:PORT failed`, with the system's error.
- **A message arrives on the input with dynamic subscription off.** The node raises an error rather than ignoring it.
- **An action message has no topic, an unknown action, or a QoS other than 0 or 1.** The node raises an error.

These stop the compile: no MQTT broker or no WiFi network in the flow, an empty topic, a QoS other than 0 or 1, an
unmanaged WiFi network.
