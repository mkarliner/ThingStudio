# ble uart out

Sends text to the devices connected over Bluetooth LE, through the Nordic UART Service.

## Properties

- **end with a newline** — add `\n` after each payload. Default on.
- **BLE** — the flow's [BLE config](ble.md).

## Wiring

**Input** — `payload` as text. Bytes are sent as they are; anything else is sent as `str(payload)`.

This node has no output.

## Behavior

The text goes to every connected device, split into pieces that fit each connection: 20 bytes until the device
agrees a larger MTU. With no device connected, nothing is sent and nothing is kept.

## Errors

A board without the ble nodes stops the deploy. Anyone in range can connect and read what's sent: there's no pairing.
