# I2C bus

The pins and clock of one I2C bus, set once and shared by every node on it. A display and a sensor can sit on the
same bus, each at its own address.

Each I2C node has an **I2C bus** field. Pick a bus, or add one with **+**. A new bus takes the lowest bus number not
yet used in the flow.

## Settings

- **bus** — the chip's I2C peripheral number. Default 0. Each bus number is used once per flow.
- **scl pin** / **sda pin** — the GPIO pins. Required, and different from each other.
- **frequency (Hz)** — the clock. Default 100000, which suits most sensors. Displays that can take it run at 400000.

## Behavior

Changing a bus changes it for every node on it. The bus's two pins are claimed like any other pin, so no other node
can use them (see [Hardware is shared](index.md#hardware-is-shared)).

`runtime.shared('i2c', 0)` in a [function](function.md) node returns the flow's bus 0, already set up, to talk to a
device that has no node of its own. It raises `KeyError` if no node in the flow uses that bus.

## Errors

These stop the deploy:

- No SCL or SDA pin: `I2C bus 0 has no SCL pin set`.
- The same pin for both: `I2C bus 0 uses pin 5 for both SCL and SDA`.
- Two bus settings with the same number, both in use: `Two I2C bus settings both say bus 0`.
- A pin or bus number the board can't use for I2C. See [What gets checked](../boards.md#what-gets-checked).
