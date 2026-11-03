# ble advertise

Advertises over Bluetooth LE: the board's name, and each message's payload as manufacturer or service data.

## Properties

- **name** — what phone apps show. Default `thingstudio`.
- **payload goes in** — **manufacturer data**, **service data**, or **nothing (name only)**.
- **manufacturer id** — for manufacturer data, in decimal or hex. Default `0xFFFF`, which is reserved for testing;
  a product uses its maker's id from the Bluetooth SIG.
- **service UUID** — for service data: 16-bit (`fcd2` is BTHome) or 128-bit.
- **interval (ms)** — how often the advertisement is sent, 20 to 10240. Default 500. Shorter is found faster and
  uses more power.

## Wiring

- **Input** — `payload` replaces the data: bytes as they are, text as UTF-8. With **nothing (name only)** it's
  ignored. Pack a number with `struct.pack` in a
  [function](function.md) node first, for example `struct.pack('<h', round(t * 100))`.

The node needs no input: unwired, it advertises the name only.

## Behavior

The board advertises the name from the moment the flow starts. Each message replaces the data, and the board sends
the new advertisement until the next one. Phones (nRF Connect, for example) and other boards with a
[ble scan](ble-scan.md) node see it without connecting. It doesn't accept connections.

An advertisement holds 31 bytes. The flags take 3, the name its length plus 2, and the data's header 4 (manufacturer
or 16-bit service) or 18 (128-bit service). The node's status says how many are left for the payload.

A flow has one ble advertise node. Needs a board with Bluetooth LE: ESP32, ESP32-S3, ESP32-C3 or ESP32-C5.

## Errors

A name with no room left for data, a bad id or UUID, a second ble advertise node, or a board without Bluetooth LE
stops the compile. A payload that isn't bytes or text, or that doesn't fit, is reported on the console with its
size, and the board keeps sending the last advertisement.

Anyone nearby can read an advertisement. Don't put anything private in it.
