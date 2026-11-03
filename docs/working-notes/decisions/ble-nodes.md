# Decisions — BLE nodes

Status: detail file, started 2026-11-03. See `decisions.md` for the index, the log's scope boundary, and its
maintenance rule. Scoping and reasoning: `../ble-nodes-scoping.md`.

- **2026-11-03 — Phased, broadcast first.** Phase 1 (`ble` config, `ble scan`, `ble advertise`) ships on its own,
  then phase 2 (board as GATT peripheral, plus Nordic UART), then phase 3 (board as central). Mike.
- **2026-11-03 — ESP32 family only for now.** No `ble` capability on `pico-w` (or a `pico-2-w` board) in this work;
  revisit after phase 1 is on hardware. Mike.
- **2026-11-03 — Phase 2's GATT server ships unpaired.** Anyone in radio range can write a writable characteristic;
  the node docs and `security-policy.md` say so. Pairing/bonding is a later item. Mike.
- **2026-11-03 — Node names as proposed.** `ble scan`, `ble advertise`, `ble characteristic in`/`out`,
  `ble uart in`/`out`. Mike.
- **2026-11-03 — Own `ts_ble` on the raw `bluetooth` module for phases 1–2.** Not `aioble`: it is a package and
  the dependency catalog installs only flat modules, and it builds the radio at import, outside `runtime.shared`.
  Nodes depend on `ts_ble`, not on what is under it, so `aioble` can still come in at phase 3. Mike.
- **2026-11-03 — The catalog's package limit gets fixed soon, not parked.** Mike expects other libraries to hit it.
  Tracked in `outstanding-items/dependency-catalog-packages.md`. Major runtime bumps are no obstacle while there
  are effectively no users (Mike).
- **2026-11-03 — ESP32-C5 is a phase 1 test board.** MicroPython 1.29.0 has `ESP32_GENERIC_C5` with NimBLE on.
  It needs an `esp32-c5` processor file (without one, the C5 resolves to the classic ESP32, the C6 bug in
  `outstanding-items.md`) and a `firmware/builds.json` entry. Mike.
- **2026-11-03 — `esp32-c5` processor file added.** From ESP-IDF v5.5.1 (`soc_caps.h`, `spi_pins.h`,
  `uart_pins.h`, `io_mux_reg.h`, the GPIO docs' `esp32c5.inc`) and MicroPython's esp32 port (`machine_adc.c`,
  `mpconfigport.h`): GPIO 0-28, flash/PSRAM 16-22, strapping 2/7/25/27/28, USB 13/14, UART0 11/12, ADC1 only on
  1-6, one SPI bus (IO_MUX 6/7/2) and one I2C bus, images at 0x2000. No `builds.json` entry yet: its SHA-256 has
  to come from micropython.org, which this session could not reach. Mike's board reports as an
  "ESP32-C5-340X" (likely a CH340X USB-serial chip); a board file waits for its schematic.
