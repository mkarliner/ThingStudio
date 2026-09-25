# udp receive

Listens on a UDP port and emits one message per datagram received.

## Properties

- **port** — local port to listen on (1–65535).
- **poll interval (ms)** — internal receive polling cadence. Default 20ms; rarely needs changing.

## Behavior

Uses the flow's WiFi network (its **WiFi** field, shared by every WiFi node). The payload is the raw bytes received, unparsed — decode it yourself in a `function` node if you're expecting text or a structured format. `host` and `port` fields on the message carry the sender's address, alongside the payload.
