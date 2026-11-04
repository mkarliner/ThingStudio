# ble uart in

Receives text from a connected device over Bluetooth LE, through the Nordic UART Service that terminal apps use.

## Properties

- **one message per line** — default on: text is gathered until a newline (`\n`; a `\r` is dropped), and the line
  is sent without its line ending. Off: one message per write.
- **BLE** — the flow's [BLE config](ble.md).

## Wiring

**Input** — none. `ble uart in` is a source.

**Output** — `payload` is the text. The message also carries `conn`, the connection's number.

## Behavior

Any UART node adds the Nordic UART Service to the board's GATT server. Terminal apps that speak it, on phones and
computers, such as nRF Connect, Serial Bluetooth Terminal and Adafruit Bluefruit, find the board by its name and
connect. Pair it with
[ble uart out](ble-uart-out.md) to answer.

A line over 512 bytes is sent as it is, so a device that never sends a newline still gets through.

## Errors

Bytes that aren't UTF-8 text are reported on the console and dropped. Anyone in range can connect and send: there's
no pairing.
