# mqtt publish

Publishes each message's payload to an MQTT topic.

## Properties

- **topic** — the topic to publish to. Required. It is fixed: a message's `topic` is ignored. To publish to several
  topics, use one node for each.
- **retain** — ask the broker to keep the message and give it to later subscribers. Default off.
- **QoS** — `0` or `1`. Default 0. QoS 2 isn't supported.
- **MQTT Broker** — the flow's MQTT broker, shared by every MQTT node in the flow: change it on one and it changes on
  all (see [Editor in depth](../working-in-the-editor.md#config-nodes)). Required.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow. **unmanaged** isn't accepted in a flow with
  MQTT nodes, because they manage the connection themselves.

## Wiring

**Input** — any message. `payload` is the message sent: bytes as they are, a string as UTF-8, and anything else
converted to text first. `None` sends the text `None`.

This node has no output.

## Behavior

Nodes on the same broker share one connection. The node connects when the first message reaches it, so its status dot
stays blank until then (see [node status](../working-in-the-editor.md#node-status)). It shows this node's own view of
the connection, even when an [mqtt subscribe](mqtt-subscribe.md) node shares the broker.

## Errors

- **The board can't reach the broker.** The dot turns red and the console shows `mqtt connect to HOST:PORT failed after
  3 attempts`, with the reason for each attempt. See
  [MQTT broker unreachable](../debugging.md#mqtt-broker-unreachable).
- **The publish fails.** The console shows `mqtt publish to HOST:PORT failed`, with the system's error.

These stop the compile: no MQTT broker or no WiFi network in the flow, an empty topic, a QoS other than 0 or 1, an
unmanaged WiFi network.
