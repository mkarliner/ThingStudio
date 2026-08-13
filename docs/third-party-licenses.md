# Third-party software in use

Status: living document, last updated 2026-08-13 (this update: `cborg`
added). Tracks every third-party
dependency this project actually uses — runtime/platform components,
editor build tooling, and anything vendored — with its license, so the
license-compliance due diligence design doc §12 calls for before any
public release has real ground truth to check against instead of being
reconstructed from scratch. Kept current per the standing rule in
`CLAUDE.md`.

Versions/licenses below for actual npm packages are pulled from the
installed package metadata (`node_modules/*/package.json`), not
recalled from memory — re-verify the same way after any update.

## Runtime / platform components (design doc §12)

Not yet real dependencies of any code in this repo — v1's device runtime
and editor don't exist yet beyond `editor/`'s early scaffolding — but
already committed to architecturally, so tracked from day one rather than
added retroactively once code lands on top of them.

| Component | Role | License | Notes |
|---|---|---|---|
| MicroPython (core VM, `uasyncio`, `mpy-cross`) | on-device runtime | MIT | permissive, no concerns |
| ESP-IDF | ESP32 port substrate | Apache-2.0 | framework itself is Apache-2.0; WiFi/Bluetooth/RF-calibration libraries ship as precompiled binary blobs — redistribution terms are Apache-2.0 (no license *obligation* conflict) but not source-available (design doc §12's caveat) |
| FreeRTOS | RTOS underlying the ESP32 port | MIT | permissive since the v10.4+ relicense |
| lwIP | TCP/IP stack (ESP-IDF, RP2040 WiFi) | modified BSD | permissive |
| Raspberry Pi Pico SDK | RP2040/RP2350 port substrate | BSD-3-Clause | permissive |
| WebSerial / Web Bluetooth | browser transport APIs | n/a | browser platform APIs, not distributed code |

## Editor build/dev tooling (`editor/package.json`)

Installed via npm, flagged and approved per `CLAUDE.md`'s standing rule
before each install. All devDependencies — build/test tooling, not
shipped in any built editor artifact.

| Package | Version installed | License |
|---|---|---|
| typescript | 5.9.3 | Apache-2.0 |
| vite | 8.2.1 | MIT |
| vitest | 4.1.10 | MIT |
| @types/node | 26.2.0 | MIT |

## Editor runtime dependencies (`editor/package.json`)

| Package | Version installed | License | Notes |
|---|---|---|---|
| cborg | 6.1.1 | Apache-2.0 | CBOR codec for the §13 wire protocol (`editor/src/protocol/`). Chosen over cbor-x/cbor2 for strict-by-default decode (rejects indefinite-length items, non-minimal int encodings, duplicate map keys) — matches the wire protocol's adversarial-input requirement more directly than a permissive-by-default decoder would. Zero runtime dependencies, Apache-2.0 (matches this project's own license), ships its own TS types. Installed with `npm install --ignore-scripts`; no install script present in the package. |

Litegraph is the other known future addition (design doc §11) once canvas
work starts; add it here the same day it's installed.

## Vendored in the POCs (frozen historical reference, not live v1 dependencies)

Physically present in `pocs/`, evaluated and validated there, but not
yet real dependencies of anything under `editor/` or `device-runtime/` —
listed for completeness/audit trail since the files exist in this repo,
not because any current build depends on them.

| Library | Version | License | Where |
|---|---|---|---|
| Litegraph.js | 0.7.18 | MIT | `pocs/poc-c/litegraph.min.js`, `pocs/poc-d/litegraph.min.js` — chosen per design doc §11/§15.3 as the real v1 canvas library, not yet an actual `editor/` dependency |
| Drawflow | 0.0.60 | MIT | `pocs/poc-c/drawflow/` — **evaluated and dropped** (§11/§15.3: needed hand-rolled type-checking, execution engine, and can't reach multi-select at all); kept only as the comparison record, not a candidate going forward |

## How this stays current

Per `CLAUDE.md`: any time a new npm package is installed (already
requires a flag-and-approve step), any time a new library gets vendored
(POC-style hash-verified copy, or otherwise), or any time a platform/
runtime component decision changes (a different ESP-IDF version, a
different MicroPython fork, etc.), this file gets a line added or updated
in the same change — not batched up for later. Before any public release,
design doc §12 still calls for an actual automated SPDX-based scan over
the real dependency tree as it exists at that point; this document is the
running ledger that scan gets checked against, not a replacement for it.
