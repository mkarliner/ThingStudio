# wifi gate

Passes a message through unchanged while the board's WiFi is connected, and drops it while it isn't.

## Properties

- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow.

## Wiring

**Input** — any message.

**Output** — the same message, unchanged, while the link is up. While it is down, nothing is sent on, as when a
[function](function.md) node returns `None`.

## Behavior

The gate checks the live WiFi link as each message arrives. It doesn't use the last message from
[wifi status](wifi-status.md), which sends only when the connection changes and can be out of date.

Put it between a source that fires on its own schedule, such as a timer or a sensor, and a node that sends over the
network. Messages that arrive while the link is down are dropped instead of failing downstream.

It checks the WiFi link only, not whether a given MQTT broker or HTTP server can be reached. `mqtt publish`,
`mqtt subscribe` and `http request` handle their own connections on top of a working link.
