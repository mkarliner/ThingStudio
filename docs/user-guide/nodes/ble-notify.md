# ble notify

Subscribes to a characteristic of another Bluetooth LE device and sends a message each time it sends a new value.

## Properties

- **BLE peer** — the [device to listen to](ble-peer.md). Required.
- **service UUID** / **characteristic UUID** — the characteristic: 16-bit or 128-bit. Required. It must support notify or
  indicate; nRF Connect shows which.
- **encoding** — how each value becomes `payload`, as for [ble read](ble-read.md). Default **bytes**.
  It also sets the output's type.

## Wiring

**Input** — none. `ble notify` is a source.

**Output** — `payload` is the value. The message also carries `peer`, the device's address or name, and `uuid`, the
characteristic.

## Behavior

The board turns notifications on when it connects, and again after each reconnect. It uses indications when the
characteristic offers no notifications. Up to 20 values wait if they come faster than the flow handles them; then
the oldest are dropped.

## Errors

A characteristic that can't notify or indicate is reported when the board connects. A value that doesn't decode is
reported and dropped.
