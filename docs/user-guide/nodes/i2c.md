# i2c

Talks to an I2C device that has no node of its own. Each message that arrives does one transfer.

## Properties

- **I2C bus** — the bus the device is wired to. See [I2C buses](i2c-bus.md).
- **operation** — `read`, `write` or `scan`.
- **address** — the device's address, such as `0x29`. Not used by `scan`.
- **register** — the register to read or write, such as `0x80`. Leave empty for a device without registers.
- **length** — for `read`, how many bytes.

Hex (`0x29`) and decimal (`41`) both work.

## Output

- **read** — `msg.payload` is the bytes read.
- **write** — writes `msg.payload` and passes the message on unchanged. The payload can be bytes, a list
  of numbers 0–255, or one number.
- **scan** — `msg.payload` is the list of addresses that answer.

Other message fields are kept.

## Behavior

If a transfer fails, the node sends nothing and its status dot says why: **disconnected** when nothing
answers, **error** when the payload can't be written. The next message tries again.

## Example

Read a TCS34725 colour sensor's ID register: address `0x29`, register `0x92`, length 1. An `inject` into
this node, into `debug`, prints `b'D'` (0x44).
