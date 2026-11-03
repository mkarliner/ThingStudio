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
