# ble characteristic out

Sets a Bluetooth LE characteristic to each message's payload, for a connected device to read, and notifies the
devices that subscribed.

## Properties

- **service UUID** / **characteristic UUID** — as for [ble characteristic in](ble-characteristic-in.md).
- **encoding** — how `payload` becomes bytes: the same choices. A number must fit: `70000` doesn't fit an
  **int16**.
- **notify** — also push each new value to the devices subscribed to it. On by default.
- **BLE** — the flow's [BLE config](ble.md).

## Wiring

- **Input** — `payload` is the new value. Unwired, the characteristic exists but stays empty.

## Behavior

Each message replaces the value. A device that reads gets the whole value; a notification carries up to 20 bytes
unless the device has agreed a larger MTU (most do, up to 244). Only devices connected at the time are notified.

One characteristic out node per characteristic: two would fight over its value. A
[ble characteristic in](ble-characteristic-in.md) on the same UUIDs makes it writable too.

## Errors

A missing or malformed UUID, or two out nodes on one characteristic, stops the compile. A payload that doesn't fit
the encoding is reported on the console and dropped, and the last value stays.

Anyone in range can connect and read: don't put anything private in a characteristic.
