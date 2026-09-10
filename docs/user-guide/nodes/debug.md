# debug

Prints a message's payload to the device's console — the simplest way to see what's actually flowing through a wire.

## Properties

- **full message** — off by default. Prints the whole message (topic, and any other fields a source node adds — for example `wifi_status`'s `ip`/`subnet`/`gateway`/`dns`/`rssi`) instead of just `payload`.

## Behavior

Output currently goes to the device's serial console (visible in the editor's console panel once connected), not a dedicated live-value inspector — that's planned but not built yet. For now, `debug` is the way to see a value without guessing.
