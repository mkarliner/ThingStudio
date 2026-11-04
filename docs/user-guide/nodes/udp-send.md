# udp send

Sends a message's payload as a UDP datagram to a fixed host and port.

## Properties

- **host** — the destination hostname or IP address. Required.
- **port** — the destination port (1–65535). Default 9999.
- **timeout (ms)** — how long to wait for the board's network stack to accept the datagram. Default 2000.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow.

## Wiring

**Input** — any message. `payload` is the datagram: bytes are sent as they are, a string as UTF-8, and anything else is
converted to text first. `None` sends the text `None`.

This node has no output.

## Behavior

UDP has no acknowledgement. A send that succeeds doesn't mean the datagram arrived, and sending to an IP address that
nobody is listening on raises no error.

A hostname is looked up again for every message.

## Errors

- **The name can't be resolved.** The console shows `udp_send: could not resolve HOST:PORT`. Check the name, or use the
  IP address.
- **The send fails.** The console shows `udp_send to HOST:PORT failed`, with the system's error.
- **The network stack doesn't take the datagram within the timeout.** The console shows a timeout error, without the
  host or port.

These stop the compile: an empty host, a port outside 1–65535, a timeout that isn't a positive number.
