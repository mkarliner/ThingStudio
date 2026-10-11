# i2c device

Talks to an I2C device that has no node of its own. Each message that arrives does one transfer.

## Properties

- **I2C bus** — the bus the device is wired to. See [I2C bus](i2c-bus.md).
- **operation** — `read`, `write` or `scan`.
- **address** — the device's address, such as `0x29`. Not used by `scan`.
- **register** — the register to read or write, such as `0x80`. Leave empty for a device without registers.
- **length** — for `read`, how many bytes.

Hex (`0x29`) and decimal (`41`) both work.

## Wiring

**Input** — for `write`, the bytes to send in `payload`. `read` and `scan` need no input.

**Output** — depends on the operation:

- **read** — `payload` is the bytes read. Reading register `0x92` at address `0x29` (a TCS34725 ID register)
  returns `b'D'`.
- **write** — sends `payload` and passes the message on unchanged. The payload can be bytes, a list of numbers
  0–255, or one number.
- **scan** — `payload` is the list of addresses that answer.

Other message fields are kept.

## Behavior

If a transfer fails, the node sends nothing and its status dot says why. The next message tries again.

## Errors

- **disconnected** — nothing answers at that address.
- **error** — the payload can't be written.
