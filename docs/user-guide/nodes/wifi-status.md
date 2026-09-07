# wifi status

Brings up the board's WiFi connection and reports connection state — and every other network node in a flow depends on it for its own credentials.

## Properties

- **poll interval (ms)** — how often to check the connection. Default 5000ms.
- **WiFi config** — which config node to connect with (see [Canvas basics](../canvas-basics.md#config-nodes)). Required — won't compile without one.

## Behavior

**This is the flow's sole source of WiFi credentials.** Every other network node type (`udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, `mqtt_subscribe`) connects using whatever this node is configured with — none of them carry a WiFi config of their own. A flow that uses any of those needs exactly one `wifi_status` node; zero, or more than one, is a compile error.

The payload is `true`/`false` for connected/disconnected, plus an `ip` field (empty string when disconnected). It only emits when the connection state actually changes, not on every poll — except the very first poll, which always reports.

If a device provisions its own WiFi outside of any deployed flow (a captive-portal setup, for example), pick "unmanaged" on the WiFi config rather than leaving it unset — that tells this node to bring the interface up without issuing its own connect, riding on whatever the device is already connected to.
