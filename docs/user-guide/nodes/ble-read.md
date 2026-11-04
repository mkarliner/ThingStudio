# ble read

Reads a characteristic of another Bluetooth LE device for each message that arrives, and sends the value on.

## Properties

- **BLE peer** — the [device to read from](ble-peer.md).
- **service UUID** / **characteristic UUID** — the characteristic to read: 16-bit (`2a6e`) or 128-bit. Phone apps
  such as nRF Connect list a device's UUIDs.
- **encoding** — how the bytes read become `payload`: **bytes**, **text**, **int8** to **uint32**, or **float32**,
  little-endian. It also sets the output's type.

## Wiring

- **Input** — any message starts a read. Wire a [timer](timer.md) in to read at an interval.
- **Output** — the incoming message, with `payload` set to the value read.

## Behavior

The read waits up to 5 seconds for the device's answer, and holds up the flow meanwhile. For a device that pushes
its values, a [ble notify](ble-notify.md) node needs no polling.

## Errors

A message that arrives while the peer isn't connected, a read that times out or fails, or a value that doesn't
decode (1 byte for a uint16) is reported on the console and the message is dropped.

What a device sends is untrusted input: check it before acting on it.
