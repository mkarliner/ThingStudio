# udp receive

Listens on a UDP port and emits one message per datagram received.

## Properties

- **port** — local port to listen on (1–65535).
- **poll interval (ms)** — how often the node checks for datagrams. Default 20.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow.

## Wiring

**Output** — one message per datagram:

- `payload` — the raw bytes received, not parsed. To read text or a structured format, decode it in a
  [function](function.md) node.
- `host` and `port` — the sender's address.
