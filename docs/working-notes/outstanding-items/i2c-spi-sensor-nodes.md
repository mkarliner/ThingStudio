# I2C/SPI sensor nodes — first one (BME280) built 2026-09-26

Not started at all. Tier 1 item 3, gated on having actual sensor hardware on hand
(`tier1-sensors-network-briefing.md`).

Also carries its own unresolved fault-handling question, flagged by Mike 2026-08-16
(`mikes-questions-and-points.md`): does a stuck/unresponsive I2C device hang the node's coroutine indefinitely, and
does that need the same bounded-timeout treatment §5 requires for network I/O? Per `CLAUDE.md`'s engineering
priority, this should be resolved while building the first I2C sensor node, not deferred past it.

Also gates on the I2C/SPI slave-mode spike for witness-rig adversarial testing — `witness_firmware.py`'s
`I2C_SLAVE_EMULATE` is still a stub.

Candidate source, from `mikes-questions-and-points.md` (folded in here 2026-09-17, same pass that built
eswitch/ebutton off the same upstream): Peter Hinch's
[I2C.md](https://github.com/peterhinch/micropython-async/blob/master/v3/docs/I2C.md) primitives, same
`micropython-async` library eswitch/ebutton vendor from — worth checking against once this item is picked up,
not evaluated yet.

## 2026-09-26: BME280/BMP280 node and the shared I2C bus

- **Stuck/unresponsive device question: resolved.** MicroPython's I2C calls are bounded by each port's own I2C
  timeout, so a missing or dead device raises `OSError` instead of hanging, and the vendored driver's wait for a
  conversion is bounded too. The node never raises out of its source loop: a failed read sends nothing, drops
  the driver object (re-created on the next good read), and sets the status dot -- `disconnected` ("no reply at
  0x76 on I2C bus 0") for `OSError`, `error` with the message for anything else (wrong chip id). Status is only
  sent on change. This is the pattern for every I2C sensor node after it.
- **I2C bus is a keyed singleton config** (Mike's call): `thingstudio/config/i2c-bus`, one per bus number,
  holding the pins and clock; nodes reference it by `i2cConfigId`; one `machine.I2C` per bus in the compiled flow
  (`editor/src/node-library/i2c-shared.ts`). `display_i2c` moved onto it; older flows migrate on load.
- **Driver:** robert-hh/BME280 `bme280_float.py`, MIT, with three marked local patches (chip-id check + BMP280,
  async read, its import) -- `device-runtime/src/vendor/bme280/README.md`. Runtime 6.0.0.
- **Hardware, 2026-09-26 (Mike, Pico, SDA GP4 / SCL GP5):** bme280 node working into a `filter`, via a small
  `function` node picking one reading. An empty I2C scan on the way turned out to be a dry joint -- the scan
  function body (in chat) was the useful tool; worth a troubleshooting entry in the user guide.
- **Generic `i2c` node on hardware, 2026-09-26 (Mike, Pico):** `test-flows/bmp280-generic-i2c.flow.json` (chip id,
  calibration, forced read + compensation, all through the `i2c` node) works.
- **Still owed:** BME280 on the C3 with a display on the same bus, with the `[memory]` figures; the unplug/replug
  status-dot check on hardware.
- **TCS34725 / MPU-9250 dedicated nodes: deferred (Mike, 2026-09-26).** The generic `i2c` node plus a small
  `function` node covers them, as the BMP280 test flow shows. Build a dedicated node only when a tutorial needs one. The witness-rig I2C slave-emulation gate above is unchanged.
