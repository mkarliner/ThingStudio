# udp receive

Listens on a UDP port and emits one message per datagram received.

## Properties

- **port** — local port to listen on (1–65535).
- **poll interval (ms)** — internal receive polling cadence. Default 20ms; rarely needs changing.

## Behavior

Uses the flow's `wifi_status` node for its WiFi connection, same as every other network node. The payload is the raw bytes received, unparsed — decode it yourself in a `function` node if you're expecting text or a structured format. `host` and `port` fields on the message carry the sender's address, alongside the payload.
