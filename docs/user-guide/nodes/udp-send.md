# udp send

Sends a message's payload as a UDP datagram to a fixed host and port.

## Properties

- **host** — destination hostname or IP.
- **port** — destination port (1–65535).
- **timeout (ms)** — how long to wait before giving up on the send. Default 2000ms.

## Behavior

Uses whichever WiFi connection the flow's `wifi_status` node has established — add one if the flow doesn't have one yet. The payload is sent as bytes (a string is UTF-8 encoded, other types are converted); nothing about its content is validated.

A send that fails — an unreachable host, a DNS failure, a timeout — raises a clear error naming the host and port it was trying to reach, not a bare error code.
