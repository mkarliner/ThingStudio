# ble characteristic in

Sends a message each time a connected device writes a Bluetooth LE characteristic.

## Properties

- **service UUID** — the service the characteristic belongs to: 16-bit (`181a`) or 128-bit. Required. Use the same
  service on the nodes for its other characteristics.
- **characteristic UUID** — 16-bit (`2a6e`) or 128-bit. Required.
- **encoding** — how the bytes written become `payload`: **bytes**, **text** (UTF-8), **int8**, **uint8**,
  **int16**, **uint16**, **int32**, **uint32** or **float32**, little-endian. Default **bytes**. It also sets the
  output's type, so a number encoding can wire into a number input.
- **BLE** — the flow's [BLE config](ble.md), for the board's name. Optional.

For your own service, pick a random 128-bit UUID (an online UUID generator, or `python3 -c "import uuid;
print(uuid.uuid4())"`). 16-bit UUIDs belong to services the Bluetooth SIG has defined.

## Wiring

**Input** — none. `ble characteristic in` is a source.

**Output** — `payload` is the value. The message also carries `conn`, the connection's number, and `uuid`, the
characteristic.

## Behavior

The board becomes a GATT server when a flow has any characteristic or UART node. It advertises its name, accepts
connections, and starts advertising again when a device disconnects. Any Bluetooth LE device that can connect and
write works: an app on a phone or a computer, such as nRF Connect, or another board's [ble write](ble-write.md) node.
All the flow's characteristics are registered once, when the flow starts. Pair a
[ble characteristic out](ble-characteristic-out.md) with the same UUIDs to make one characteristic a connected device
can read, write and subscribe to.

A connected device can write up to 244 bytes at a time. A node keeps up to 20 writes waiting; if they come faster than the
flow handles them, the oldest are dropped.

The node's status shows **advertising, no one connected** or **1 connected**.

## Errors

A missing or malformed UUID, two nodes using one characteristic with different encodings, or a board without the
ble nodes stops the deploy.
A write that doesn't decode (2 bytes sent to an `int32`, text that isn't UTF-8) is reported on the console with its
size and dropped.

Anyone in range can connect and write: there's no pairing. Treat what arrives as untrusted input.
