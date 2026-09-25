# wifi status

Reports the board's WiFi connection state. In a flow with no other WiFi node, it also brings the connection up.

## Properties

- **poll interval (ms)** — how often to check the connection. Default 5000ms.
- **WiFi** — the flow's WiFi network. Every WiFi node in a flow shares this one setting (see [Canvas basics](../canvas-basics.md#config-nodes)).

## Behavior

This node is optional: other network nodes don't need it. In a flow with MQTT nodes, MQTT manages the WiFi connection and this node only reports on it.

The payload is `true`/`false` for connected/disconnected. The message also carries `ip`, `subnet`, `gateway`, `dns` (all empty strings when disconnected), and `rssi` (signal strength in dBm, or `null` when disconnected or when the board doesn't support reading it — RSSI is an ESP32-only reading, not available on every board). Use a `debug` node with "full message" checked to see all of these — by default `debug` only prints `payload`.

It emits when connection identity changes (connect/disconnect, or a change to `ip`/`subnet`/`gateway`/`dns`), not on every poll — except the very first poll, which always reports. `rssi` doesn't trigger a re-emit on its own — it drifts constantly even on an idle connection, so it's included whenever a message fires for another reason, but its own changes don't cause one. It's a snapshot, not a live reading.

Pick "unmanaged" on the WiFi config when you don't want this node issuing its own connect — either because something else already manages the connection, or because you want the device to learn its credentials on its own over the air. See [WiFi provisioning](../wifi-provisioning.md) for how that self-provisioning flow works, including the setup network's password and the reprovisioning-fallback option.

If no connection is ever made, this node just reports disconnected, the same as any other failed connect — provisioning changes how the interface gets its credentials, not how wifi_status reports on them.

Shows a connection-status dot on the canvas (see [Canvas basics](../canvas-basics.md#node-status)) once connected to a device.

While this node has the board on a network, the editor can connect to the board over WiFi. See [Connecting over WiFi](../wifi-connection.md).
