# i2c device

Talks to an I2C device that has no node of its own. Each message that arrives does one transfer.

## Properties

- **I2C bus** — the bus the device is wired to. Required. See [I2C bus](i2c-bus.md).
- **operation** — `read bytes`, `write msg.payload` or `scan the bus` (`read`, `write`, `scan` in the flow file).
  Default `read`.
- **address** — the device's 7-bit address, such as `0x29` or `41`. Up to `0x7f`. Required except for `scan`.
- **register** — the register to read or write, such as `0x80`. Up to `0xff`. Leave it empty for a device without
  registers.
- **length (bytes)** — for `read`, how many bytes, 1 to 256. Default 1.

## Wiring

**Input** — any message starts a transfer. For `write`, `payload` is what to send: bytes, a list of numbers 0 to 255,
or one number 0 to 255.

**Output** — the same message, with other fields kept:

- `read`: `payload` is the bytes read. Reading register `0x92` at address `0x29` (a TCS34725's ID) gives `b'D'`.
- `write`: `payload` is unchanged.
- `scan`: `payload` is the list of addresses that answer, as numbers.

## Behavior

The status dot shows whether the device answers. A transfer that fails sends nothing, and the next message tries
again.

## Errors

- **Nothing answers at the address.** The dot shows **disconnected**, `no reply at 0x29 on I2C bus 0`, and the
  message is dropped. For `scan`, `I2C bus 0 not responding`.
- **A payload that can't be written**, such as a bool or a number over 255. The dot shows **error** with the reason,
  and the message is dropped.
- **No address**, for `read` or `write`. The first message fails with a `[NODE_ERROR]`:
  `i2c: set the device address (7-bit, e.g. 0x29)`.
- **No bus, a bus without pins, or an address or register out of range.** Deploy stops and says which.
