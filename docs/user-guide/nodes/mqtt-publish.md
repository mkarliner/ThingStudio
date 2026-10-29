# mqtt publish

Publishes a message's payload to an MQTT topic.

## Properties

- **topic** — the topic to publish to. Required.
- **retain** — publish as a retained message.
- **QoS** — `0` or `1`. QoS 2 isn't supported.
- **MQTT Broker** — the flow's MQTT broker, shared by every MQTT node in the flow: change it on one and it changes on
  all (see [Editor in depth](../working-in-the-editor.md#config-nodes)). Required — won't compile without one.

## Behavior

Uses the flow's WiFi network (the WiFi config in the flow, shared by every WiFi node; the node's WiFi field selects that same network) and the flow's broker config for the MQTT connection. Nodes on the same broker share one connection. In a flow with MQTT nodes, MQTT manages the WiFi connection. An "unmanaged" WiFi config isn't accepted here: this node manages its own WiFi reconnection, so it needs a real network to connect to. The payload is sent as bytes (a string is UTF-8 encoded, other types are converted).

Shows a connection-status dot on the canvas (see [Editor in depth](../working-in-the-editor.md#node-status)) once
connected to a device. It reports its own broker connection state, even when it shares that broker with an
`mqtt subscribe` node. The node opens its broker connection only when there's actually something to publish, so the
dot stays blank until the first message reaches it, even if the flow has been running a while.
