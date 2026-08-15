# Third-party software in use

Status: living document, last updated 2026-08-15 (this update: 7 npm
packages installed for the `pocs/poc-rete/` Rete.js evaluation spike —
Litegraph.js and the mpy-cross WASM build's `editor/` entries below are
unchanged from 2026-08-14). Tracks every third-party
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

## Vendored in `editor/` (static assets, not npm packages)

Copied byte-for-byte from an already-evaluated/hash-verified source
(`sha256sum` checked against the source file at copy time, same
discipline as `mpy-cross-wasm/`'s own provenance doc), not installed via
`npm install` -- so not gated by `CLAUDE.md`'s npm-specific install-flag
rule, but flagged here in the same change per that rule's own spirit
(and the placeholder note this table used to carry). Served as plain
static files from `editor/public/vendor/` (Vite's public-dir convention
-- copied as-is into any build, not bundled/transformed), loaded via a
`<script>` tag (Litegraph) or a runtime dynamic `import()` of the public
URL (mpy-cross, so Vite doesn't try to statically resolve/bundle a
public asset at build time).

| Library | Version | License | Where | Notes |
|---|---|---|---|---|
| Litegraph.js | 0.7.18 | MIT | `editor/public/vendor/litegraph/` | Copied from `pocs/poc-c/litegraph.min.js`/`pocs/poc-d/litegraph.min.js` (design doc §11/§15.3's chosen canvas library) -- now a real, live `editor/` dependency for the first time, not just a POC evaluation copy. Vendored as a static file rather than `npm install`'d: avoids an install-script trust decision entirely (this project's own stated preference, `CLAUDE.md`) for a library that's already a settled, unmodified single minified file with no further updates expected before v1 ships. |
| mpy-cross (WASM build) | matches the MicroPython version `mpy-cross-wasm/README.md` was built against | MIT | `editor/public/vendor/mpy-cross/` | Byte-identical copy of `mpy-cross-wasm/mpy-cross.wasm` + `mpy-cross.mjs` (hashes verified equal at copy time) -- that build was previously validated but not consumed by any live code; the bare-minimum editor's Deploy button is the first real caller, doing the actual graph -> Python -> `.mpy` bytecode cross-compile in-browser before a DEPLOY is sent. See `mpy-cross-wasm/README.md` for the Emscripten build provenance; this is a plain copy, not a rebuild. |

## Vendored in `device-runtime/` (Python, not npm)

Manual vendoring, same discipline as `mpy-cross-wasm/`'s (hash-recorded,
provenance documented alongside the code) — not gated by `CLAUDE.md`'s
npm-specific install-flag rule since it isn't a Node/npm package, but
flagged to Mike and approved before adding, same spirit.

| Package | Version installed | License | Notes |
|---|---|---|---|
| mqtt_as | 0.8.5 (upstream `VERSION` const; not pinned to an exact commit SHA — see its own README) | MIT | `device-runtime/src/vendor/mqtt_as/__init__.py`. Asynchronous, `uasyncio`-native MQTT client from [peterhinch/micropython-mqtt](https://github.com/peterhinch/micropython-mqtt), used by the `mqtt_publish`/`mqtt_subscribe` nodes. Chosen over `umqtt.simple` specifically for non-blocking I/O and built-in WiFi/broker reconnection — see `device-runtime/src/vendor/mqtt_as/README.md` for the full rationale, including why this one case departs from `cbor.py`'s hand-rolled-over-dependency precedent. |

## `test/hil/` tooling (Python, not npm)

Not gated by `CLAUDE.md`'s npm-specific install-flag rule (this isn't a
Node/npm package), but tracked here anyway per this file's own stated
scope ("runtime/platform components, editor build tooling, and anything
vendored") — a real third-party dependency of test infrastructure this
repo now contains code for, even though it isn't installed in any CI
environment or committed as a pinned requirement file yet.

| Package | Role | License | Notes |
|---|---|---|---|
| pyserial | Serial port I/O for `test/hil/run_fault_isolation_checks.py` (talks to both the witness and DUT boards) | BSD-3-Clause | Not yet pinned to a specific version or added to a `requirements.txt` — this repo has no Python dependency-lockfile convention yet (device-runtime's own MicroPython code has no third-party dependencies at all, by design — see `cbor.py`'s own header on why). Worth a `requirements.txt` (or equivalent) the next time `test/hil/` tooling grows, rather than assumed fine indefinitely as an unpinned `pip install` in a README. |

## POC-only npm dependencies (`pocs/poc-rete/`)

Real `npm install`, not a hand-vendored single file like Litegraph/Drawflow
above — Rete.js ships as several small interdependent ESM packages with real
peer dependencies, which doesn't suit vendoring a UMD build the way poc-c's
libraries did. Flagged and approved per `CLAUDE.md` before install (all 8
individually, including a mid-flight correction — react/react-dom/
rete-react-plugin/styled-components were flagged first, then swapped for
Vue's equivalents per direct steer, never actually installed into a
committed lockfile). Installed with `npm install --ignore-scripts`; `rete`'s
own `postinstall.js` was inspected before relying on that flag (a harmless
console banner, no network/filesystem effects). See `pocs/poc-rete/README.md`
for the full spike write-up. Not a live `editor/` dependency — same status
Litegraph/Drawflow had before Litegraph's 2026-08-14 promotion into
`editor/public/vendor/`.

| Package | Version installed | License | Notes |
|---|---|---|---|
| rete | 2.0.6 | MIT | Headless core. Registry's own `time` field: this exact version published 2025-06-30 and is still the `latest` dist-tag — over a year stale by npm-publish-date, a correction against the spike briefing's looser "actively maintained, June 2026" framing. |
| rete-area-plugin | 2.3.2 | MIT | Canvas rendering surface; published 2026-07-08, genuinely current |
| rete-connection-plugin | 2.0.5 | MIT | Wire drag gesture; published 2024-08-30 |
| rete-render-utils | 2.0.3 | MIT | Shared rendering utilities, peer dep of rete-vue-plugin; published 2024-08-30 |
| rete-vue-plugin | 2.1.3 | MIT | Vue 3 node/control renderer; published 2026-07-10, genuinely current |
| rete-dock-plugin | 2.0.4 | MIT | Palette drag-and-drop plugin; published 2025-04-27 |
| vue | 3.5.41 | MIT | Peer dep of rete-vue-plugin |

## Vendored in the POCs (frozen historical reference, not live v1 dependencies)

Physically present in `pocs/`, evaluated and validated there, but not
yet real dependencies of anything under `editor/` or `device-runtime/` —
listed for completeness/audit trail since the files exist in this repo,
not because any current build depends on them.

| Library | Version | License | Where |
|---|---|---|---|
| Litegraph.js | 0.7.18 | MIT | `pocs/poc-c/litegraph.min.js`, `pocs/poc-d/litegraph.min.js` — chosen per design doc §11/§15.3 as the real v1 canvas library. **Now also a live dependency**, copied into `editor/public/vendor/litegraph/` — see the "Vendored in `editor/`" table above; this POC copy is kept as the historical/frozen reference the live copy was taken from, not a second independent instance. |
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
