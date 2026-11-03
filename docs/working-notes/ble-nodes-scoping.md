# BLE nodes — scoping

Status: decision, 2026-11-03. All five calls agreed with Mike (`decisions/ble-nodes.md`). Branch: `ble-nodes`.

Scope: flow nodes that use the board's Bluetooth Low Energy radio. Not in scope: BLE as a board transport (the
editor ⇄ board link over Web Bluetooth), which stays the separate v2 item in design doc §10 and
`outstanding-items.md`. Nothing here touches the wire protocol.

## What exists today

- **Capability word:** `ble` is already on the ESP32, ESP32-S3 and ESP32-C3 processors (`node-board-mapping.md`).
  Not on the S2 (no Bluetooth). Not on the nRF52840: its MicroPython port has `ubluepy`, not the `bluetooth`
  module (`decisions/chip-board-definitions.md`). No node uses `ble` yet.
- **Pico W / Pico 2 W:** stock MicroPython has the `bluetooth` module (BTstack) on the `RPI_PICO_W` build, but the
  `pico-w` board has no `ble` capability. Adding it is board data (`capabilities: ["ble"]`), not a schema change.
- **Firmware:** stock ESP32 builds include NimBLE. The custom classic-ESP32 image is "stock `sdkconfig.base` + BLE"
  (`classic-esp32-firmware-briefing.md`); confirm it before relying on it.
- **Memory:** on a classic ESP32, Bluetooth's reservation is part of the ~287 KB gone before any heap
  (`learnings/micropython-device-runtime.md`). BLE plus WiFi plus a display on a CYD will very likely not fit.
- **Node shape:** core packages under `editor/src/node-library/core-packages/` (descriptor + compile hook +
  device Python), with shared state in a vendored flow dependency, as `ts_mqtt`/`ts_wifi` do.

## The radio is one keyed singleton

There is one `bluetooth.BLE()` object and one IRQ handler per board. Every BLE node goes through one shared
library (working name `ts_ble`, a flow dependency like `ts_mqtt`) that:

- builds the radio once through `runtime.shared('ble', 0, signature, factory)`, signature = the `ble` config
  (device name, and so on). A second, different config is a compile error, not a silent override;
- owns the one IRQ handler and routes events to each node's own queue (the `ts_mqtt` per-node queue pattern);
- collects GATT services from every peripheral node and registers them **once**, before advertising starts.
  `gatts_register_services` takes the whole table in one call, so this is a startup barrier, not a per-node call;
- registers a cleanup that deactivates the radio on redeploy, since module state survives `cancel_running`.

The ordering point (register every service, then advertise) is the main design risk. Spike it first.
**Settled 2026-11-03 (phase 2):** the compiler builds the whole flow's table (every GATT node's hook sees
`ctx.flow.nodes`), every GATT node gets the same sorted table, and the first to start registers it through
`runtime.shared('ble_gatt', 0, table, ...)`. No runtime barrier, no ordering race.

## Proposed nodes

Names are palette names. Every message keeps the `payload`/`topic` envelope; `topic` is `''` unless noted.

### Phase 1 — broadcast only, no connections

| Node | Kind | What it does |
|---|---|---|
| `ble scan` | event source | Scans; one message per advertisement that passes the filters. `payload`: raw advertising data (`bytes`). Fields: `addr`, `addrType`, `rssi`, `name`, `mfr` (manufacturer data, bytes), `svcData`. Properties: name/address/service-UUID/manufacturer-ID filter, active vs passive, interval/window, a dedupe window. |
| `ble advertise` | sink | Sets what the board advertises. Each input message updates the manufacturer data or service data from `payload` (bytes). Properties: interval, connectable (off in phase 1), the field to set. |

**Built 2026-11-03** (`core-packages/ble-scan.ts`, `ble-advertise.ts`, `vendor/thingstudio_ble/ts_ble.py`). No `ble`
config node in phase 1: config types are hard-wired into the editor core (`app/rete/config-types.ts`, `main.ts`,
`cli/describe.ts`, `cli/check-flow.ts`), and the only shared setting, the device name, belongs to the one
`ble advertise` a flow may have. It comes in phase 2, when the GATT server needs a name and the peripheral nodes
share it. Both checked on the ESP32-C5-340X the same day (`learnings/hardware-bringup-hil-rig.md`).

These cover the common cases: reading off-the-shelf sensors (BTHome, Ruuvi, Xiaomi-style beacons) and broadcasting
a reading with no pairing. Decoders for particular beacon formats are transforms; ship one (BTHome v2), leave the
rest to custom nodes.

### Phase 2 — the board as a peripheral (GATT server)

| Node | Kind | What it does |
|---|---|---|
| `ble characteristic out` | sink | Writes `payload` to a characteristic and notifies subscribed centrals. |
| `ble characteristic in` | event source | One message each time a central writes the characteristic. Fields: `conn` (connection handle). |
| `ble uart` (in / out) | source + sink | The Nordic UART Service, so phone apps (nRF Connect, Serial Bluetooth Terminal, Bluefruit) can send and receive text with no setup. Same split as `mqtt subscribe`/`mqtt publish`. |

A characteristic is named by service UUID + characteristic UUID on the node. Two nodes naming the same pair share
it, as two MQTT nodes share a client. An encoding property (`bytes`, `utf8`, `int`/`uint` 8/16/32 little-endian,
`float32`) sets the port type, so the wire check stays honest.

The `in`/`out` split follows the existing source/transform/sink model. A single node with an input and an
external-event output would need a new kind, the same gap `ebutton` already notes for multi-event sources.

**Built 2026-11-03** on branch `ble-phase-2` (`core-packages/ble-characteristic-*.ts`, `ble-uart-*.ts`,
`ble-shared.ts`; the GATT half of `ts_ble`), with the optional `ble` config node. Differences from the plan above:
`characteristic out`'s input is `any` (an input socket is typed once, at construction), so its encoding is checked
on the board; `characteristic in`'s output follows the encoding. Checked on the ESP32-C5-340X the same day
(`learnings/hardware-bringup-hil-rig.md`).

### Phase 3 — the board as a central (GATT client)

`ble connect` (config: a peer by address or advertised name), `ble read`, `ble write`, `ble notify` (source).
Connection loss, reconnect and service discovery make this the largest piece. One deterministic path: connect,
discover, subscribe, and each step is a named state with one failure line. The node reports `disconnected` and
retries on a fixed interval. It does not hunt for a different peer.

## Cross-cutting

- **Capability gating:** every node `requires: { capabilities: ["ble"] }`. The palette greys them out elsewhere.
- **Library choice (call 1):** `aioble` (micropython-lib, MIT) is the maintained asyncio BLE layer, but it is a
  package (`aioble/` with relative imports). The dependency catalog only installs flat modules with identifier
  names (`deps.py`, runtime-api §3). Options: (a) flatten `aioble` into modules with recorded patches,
  (b) extend the catalog to carry packages, which is an interface change, or (c) write a small `ts_ble` on
  the raw `bluetooth` module for phases 1–2 and decide on `aioble` at phase 3. Recommend (c). Scan, advertise and
  a GATT server are a few hundred lines on the raw API. The central role is where `aioble` earns its size.
- **WiFi coexistence:** ESP32 WiFi and BLE share one radio. A continuous scan cuts WiFi throughput and can delay
  MQTT keepalives. Default the scan duty cycle low, and document it in the FAQ.
- **Memory:** warn, don't refuse (AGENTS.md "warn on a prediction"). A compile warning on classic ESP32 when a
  flow uses BLE with a display, or with BLE + WiFi + MQTT.
- **Security (`docs/security-policy.md`):** scanned advertisements are untrusted input parsed on the board (§3.6).
  A GATT server opens a new boundary: anyone in radio range can write a writable characteristic. That needs a new
  row in the table and a tier. Phase 2 ships unpaired, and the docs say so. Pairing/bonding is a later item.
  Vendoring anything needs Mike's approval first (§3.7).
- **Fault handling:** radio activation failure, a full service table, an over-long advertising payload (31 bytes
  legacy) and a write to a characteristic that isn't registered each get one attributed `NODE_ERROR` line naming
  the node and the figure (bytes, UUID).
- **Runtime version:** if this is all flow dependencies and codegen with no `runtime.py` change, there's no bump.
  Re-check if `ts_ble` needs a runtime hook (e.g. for redeploy cleanup ordering).
- **Tests:** a `bluetooth` mock in `editor/test/fixtures/pymock/` for codegen tests. The unix MicroPython port has
  no `bluetooth`, so the real-MicroPython suite covers only the pure parts (advertising-data encode/decode).
  Hardware checks: ESP32-S3, ESP32-C3 and ESP32-C5 against a phone running nRF Connect. The C5 needs a processor
  file and a firmware entry first (`decisions/ble-nodes.md`).
- **Docs:** a page per node, the nodes index, `PROPERTY_NOTES`, the regenerated catalog, FAQ entries (BLE + WiFi
  memory; "my phone doesn't see the board"; phones caching GATT tables after a redeploy), and one tutorial.

## Calls for Mike

1. **Library: own `ts_ble`** on the raw `bluetooth` module for phases 1–2; `aioble` reconsidered at phase 3. The
   catalog's package limit is fixed separately and soon (`outstanding-items/dependency-catalog-packages.md`).
2. **Phasing: agreed.** Phase 1 (scan + advertise) ships on its own, then phase 2, then phase 3.
3. **Pico W: not yet.** ESP32 family only in this work.
4. **Unpaired GATT server: agreed** for phase 2, with a documented warning; pairing deferred.
5. **Names: agreed** as proposed.
