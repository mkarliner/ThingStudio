# wifi status

Brings up the board's WiFi connection and reports connection state — and every other network node in a flow depends on it for its own credentials.

## Properties

- **poll interval (ms)** — how often to check the connection. Default 5000ms.
- **WiFi config** — which config node to connect with (see [Canvas basics](../canvas-basics.md#config-nodes)). Required — won't compile without one.

## Behavior

**This is the flow's sole source of WiFi credentials.** Every other network node type (`udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, `mqtt_subscribe`) connects using whatever this node is configured with — none of them carry a WiFi config of their own. A flow that uses any of those needs exactly one `wifi_status` node; zero, or more than one, is a compile error.

The payload is `true`/`false` for connected/disconnected. The message also carries `ip`, `subnet`, `gateway`, `dns` (all empty strings when disconnected), and `rssi` (signal strength in dBm, or `null` when disconnected or when the board doesn't support reading it — RSSI is an ESP32-only reading, not available on every board). Use a `debug` node with "full message" checked to see all of these — by default `debug` only prints `payload`.

It emits when connection identity changes (connect/disconnect, or a change to `ip`/`subnet`/`gateway`/`dns`), not on every poll — except the very first poll, which always reports. `rssi` doesn't trigger a re-emit on its own — it drifts constantly even on an idle connection, so it's included whenever a message fires for another reason, but its own changes don't cause one. It's a snapshot, not a live reading.

If a device provisions its own WiFi outside of any deployed flow (a captive-portal setup, for example), pick "unmanaged" on the WiFi config rather than leaving it unset — that tells this node to bring the interface up without issuing its own connect, riding on whatever the device is already connected to.

Shows a connection-status dot on the canvas (see [Canvas basics](../canvas-basics.md#node-status)) once connected to a device.
