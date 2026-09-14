# wifi status

Brings up the board's WiFi connection and reports connection state — and every other network node in a flow depends on it for its own credentials.

## Properties

- **poll interval (ms)** — how often to check the connection. Default 5000ms.
- **WiFi config** — which config node to connect with (see [Canvas basics](../canvas-basics.md#config-nodes)). Required — won't compile without one.

## Behavior

**This is the flow's sole source of WiFi credentials.** Every other network node type (`udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, `mqtt_subscribe`) connects using whatever this node is configured with — none of them carry a WiFi config of their own. A flow that uses any of those needs exactly one `wifi_status` node; zero, or more than one, is a compile error.

The payload is `true`/`false` for connected/disconnected. The message also carries `ip`, `subnet`, `gateway`, `dns` (all empty strings when disconnected), and `rssi` (signal strength in dBm, or `null` when disconnected or when the board doesn't support reading it — RSSI is an ESP32-only reading, not available on every board). Use a `debug` node with "full message" checked to see all of these — by default `debug` only prints `payload`.

It emits when connection identity changes (connect/disconnect, or a change to `ip`/`subnet`/`gateway`/`dns`), not on every poll — except the very first poll, which always reports. `rssi` doesn't trigger a re-emit on its own — it drifts constantly even on an idle connection, so it's included whenever a message fires for another reason, but its own changes don't cause one. It's a snapshot, not a live reading.

Pick "unmanaged" on the WiFi config when you don't want this node issuing its own connect. On first boot with no stored credential, the device opens its own setup network — **Thingstudio-Setup-XXXX**, WPA2-secured with the password `thingstudio` — and serves a page at 192.168.4.1 for picking a network and entering its password. Connect a phone or laptop to that network; most phones prompt to sign in to it automatically. The device saves what you enter and connects with it on every later boot, without reopening the setup network.

The WiFi config's "Allow reprovisioning on connect failure" field reopens the setup network any time the saved credential stops working, not just on first boot. It's off by default: reopening an unauthenticated setup network whenever WiFi drops is itself a risk — anyone in radio range during the drop could connect to it and redirect the device to a different network. Only turn it on for a device on a trusted, physically-controlled network.

If no connection is ever made, this node just reports disconnected, the same as any other failed connect — this feature changes how the interface gets its credentials, not how wifi_status reports on them.

Shows a connection-status dot on the canvas (see [Canvas basics](../canvas-basics.md#node-status)) once connected to a device.
