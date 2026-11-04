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
  "ESP32-C5-340X" (silkscreen ESP32-C5-KITC-A V1.2, Huizhou Youshide). Board file `esp32-c5-340x` added the
  same day from the maker's manual PS-C5-340X-001 V1.0: CH340E on UART0 (left USB-C), native USB (right), WS2812
  on GPIO 27, BOOT on 28, and 3 and 26 also strapping per the manual (ESP-IDF's GPIO docs don't list them).
- **2026-11-03 — Phase 1 built without a `ble` config node (session call, not Mike's).** Config types are wired into
  the editor core in four places, and phase 1's one shared setting (the device name) lives on the flow's single
  `ble advertise`. Revisit in phase 2. Scan settings are shared through a second singleton (`ble_scan`) and checked
  at compile time across `nodesOfType`; one `ble advertise` per flow, likewise.
- **2026-11-03 — `ts_ble` is importable by users' custom nodes**, listed in `custom-nodes.md`'s new "Libraries you
  can import", so a user's BLE node shares the radio with the built-ins (`ts_ble.radio()`, not `bluetooth.BLE()`).
- **2026-11-03 — Phase 2 shape (session calls, on Mike's "in your suggested order").** The GATT service table is
  built at compile time from the whole flow (`core-packages/ble-shared.ts`) and registered once by the first GATT
  node to start, so there is no run-time barrier. The board's name moves from `ble advertise` to an optional,
  one-per-flow `ble` config (`thingstudio/config/ble`); the nodes' field is a plain optional `configRef`, not a
  singleton reference, because a singleton reference makes a missing config a compile error. With GATT nodes the
  advertisement is connectable and restarts on disconnect. One `characteristic out` per characteristic; an in and
  an out on one characteristic must share an encoding. Integer encodings are range-checked in `ts_ble`, not left to
  `struct` (CPython raises `struct.error`, MicroPython may truncate).
- **2026-11-03 — Unpaired GATT server is tier Accept** (`security-policy.md` §2 and §3.6), per Mike's earlier call
  that phase 2 ships unpaired with a documented warning. Every GATT node page says so.
- **2026-11-04 — Phase 3's GATT client goes in `ts_ble`, on the raw `bluetooth` module (Mike: "a").** Not
  `aioble`: it claims the radio's IRQ handler at import, so it can't share the radio with `ts_ble`'s scan and GATT
  server. Tested with two boards (Mike has them).
- **2026-11-04 — The radio stays on between flows (session call, from the C5 trace).** `ts_ble`'s redeploy cleanup
  stops scanning, advertising and links and detaches its handler, but never calls `active(False)`: off-then-on
  between flows left the C5's controller refusing the next scan (-519) until a power cycle. Cost, documented: the
  stack keeps its ESP-IDF memory until a reset. Revisit if a port needs the radio off (none found yet).
- **2026-11-04 — `ts_ble` is a package of three parts** (runtime 15.0.0's package libraries): the core (radio,
  scan, advertise, advertising data, encodings; 6.3 KB as .mpy for the C5), `ts_ble.server` (GATT server + UART,
  2.4 KB) and `ts_ble.central` (GATT client, 6.2 KB). Each node imports the part it uses, so a scan-only flow loads
  6.3 KB, not the 13.4 KB single file -- after a running BLE flow on the C3/C5 left too little RAM to receive a
  changed `ts_ble`. The temporary BLE_TRACE is removed; the radio-stays-on fix it found stays.
