# debug

Prints a message's payload to the device's console — the way to see what's actually flowing through a wire.

## Properties

- **full message** — off by default. Prints the whole message (topic, and any other fields a source node adds — for example `wifi status`'s `ip`/`subnet`/`gateway`/`dns`/`rssi`) instead of only `payload`.

## Behavior

Output goes to the device's serial console, visible in the editor's console panel once connected. Use it to see a value flowing through a wire without guessing.
