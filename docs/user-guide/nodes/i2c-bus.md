# I2C buses

An I2C bus is a pair of wires, SCL and SDA, shared by one or more devices. A display and a sensor can sit on
the same bus, each at its own address.

Each I2C node has an **I2C bus** field. Pick a bus, or add one with **+**. The pins and clock are set once,
on the bus, and every node on that bus uses them.

## Settings

- **bus** — the chip's I2C peripheral number, usually 0. Each bus number can be used once per flow.
- **scl pin / sda pin** — the GPIO pins. Checked against your [board](../boards.md).
- **frequency (Hz)** — the clock. 100000 suits most sensors. Displays often run at 400000.

Changing a bus changes it for every node on it. If two buses end up with the same number, Deploy says so.

## In a function node

`runtime.shared('i2c', 0)` returns the flow's bus 0, already set up. Use it to talk to a device that has no
node of its own. It fails if no node in the flow uses that bus.
