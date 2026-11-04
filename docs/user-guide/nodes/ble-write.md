# ble write

Writes each message's payload to a characteristic of another Bluetooth LE device.

## Properties

- **BLE peer** — the [device to write to](ble-peer.md).
- **service UUID** / **characteristic UUID** — the characteristic to write: 16-bit or 128-bit.
- **encoding** — how `payload` becomes bytes: the same choices as [ble read](ble-read.md). A number must fit.
- **wait for the peer's response** — on by default: the device confirms each write, and a write it refuses is
  reported. Off: write without response, which is faster; the characteristic must allow it.

## Wiring

- **Input** — `payload` is the value to write.

## Behavior

Nothing is queued: a message that arrives while the peer isn't connected is reported and dropped, so a stale value
is never written after a reconnect.

## Errors

Not connected, a write the device refuses or doesn't confirm within 5 seconds, or a payload that doesn't fit the
encoding is reported on the console.
