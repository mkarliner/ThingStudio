# Vendored: `bme280_float`

Source: [robert-hh/BME280](https://github.com/robert-hh/BME280), `bme280_float.py` on `master`.
License: MIT (repo `LICENSE`; the file's own header carries the same MIT text, copyright Adafruit Industries,
author Tony DiCola, with later changes by Paul Cunnane, Peter Dahlebrg, David J Taylor and Robert Hammelrath).

Fetched 2026-09-26 for `editor/src/node-library/bme280.ts`. Last commit touching the file, from a full clone:
`a9a708015b149c23cf332f591b8371d217e416c1` (2025-06-15, "bme280_xxx.py: Check for the conversion to start.").

SHA-256 of the upstream file as fetched: `1e2b3790e95b1752913ea643b34be6197e8f80c45da2868a2ce0a95d094bc217`.
Installed on the board as `bme280_float.py` (`device-runtime/runtime_manifest.py`).

## Local patches

Each is marked in the file with a `Thingstudio local patch N` comment.

1. **Chip id check and BMP280 support.** `__init__` reads the chip id (register 0xD0). 0x60 is a BME280,
   0x58 a BMP280 (same registers, no humidity); anything else raises `ValueError("no BME280/BMP280 at
   0x76 (chip id 0x..)")` instead of producing garbage readings. On a BMP280 the humidity calibration and
   control register are skipped and humidity is `None` (0.0 from the original `read_compensated_data()`,
   which returns a float array).
2. **Async read.** `read_async()` starts a forced measurement, waits the datasheet's maximum measurement time
   with `asyncio.sleep_ms()`, polls the status bit (bounded, about 100 ms more), then reads and compensates.
   The original `read_raw_data()` waits with `time.sleep_ms()`, which stalls every other task on the board
   for the whole conversion (about 60 ms at the default 8x oversampling). The register writes, burst read and
   compensation were split into `_start_forced()`, `_burst_read()` and `_compensate()` so both paths share
   them; the maths is unchanged.
3. **`asyncio` import** for patch 2 (`uasyncio`, falling back to `asyncio`).

The original synchronous methods still work as before.
