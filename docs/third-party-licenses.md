# Third-party software in use

Status: living document, last updated 2026-09-17 (this update: `st7789py_mpy`/`ssd1306`
vendored into `device-runtime/src/vendor/` for the new `display_spi`/`display_i2c` node
types, added under the existing "Vendored in `device-runtime/`" section below. Prior
update, 2026-09-07: `backend/`'s
minimal-build dependencies -- `aiohttp`, `pyserial` as real pinned
`pyproject.toml` dependencies, `pytest`/`pytest-asyncio` as test-only ones --
added under the new "Backend" section below. Prior update, 2026-08-17:
`ThreadSafeEvent`
vendored into `device-runtime/src/vendor/threadsafe_event/`, per Tier 1 item
5's interrupt/pin-change node implementation. Earlier, 2026-08-16: six of
the seven `pocs/poc-rete/` Rete.js packages promoted to real `editor/` runtime
dependencies per `docs/working-notes/rete-migration-decision.md`'s Phase 0 —
`rete-dock-plugin` deliberately not promoted, sub-decision 2 dropped it;
`@vitejs/plugin-vue` added as `editor/` dev tooling. Litegraph.js and the
mpy-cross WASM build's `editor/` entries below are unchanged from
2026-08-14). Tracks every third-party
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
| @vitejs/plugin-vue | ^6.0.0 pinned (scratch-verified at 6.0.8) | MIT |

Vue SFC compilation for the Rete canvas layer's `.vue` components — without
it, `.vue` files don't compile at all (`vite.config.ts`'s own comment).
Registered in `vite.config.ts` ahead of `editor/src/app/rete/*.vue` actually
being wired into `index.html`/`main.ts` (that's Phase 3 of the Rete
migration), so the plugin doesn't need adding again when that wiring lands.
Publishes npm provenance attestations (SLSA/OIDC trusted-publisher),
checked per `rete-migration-decision.md`'s supply-chain note.

## Editor runtime dependencies (`editor/package.json`)

| Package | Version installed | License | Notes |
|---|---|---|---|
| cborg | 6.1.1 | Apache-2.0 | CBOR codec for the §13 wire protocol (`editor/src/protocol/`). Chosen over cbor-x/cbor2 for strict-by-default decode (rejects indefinite-length items, non-minimal int encodings, duplicate map keys) — matches the wire protocol's adversarial-input requirement more directly than a permissive-by-default decoder would. Zero runtime dependencies, Apache-2.0 (matches this project's own license), ships its own TS types. Installed with `npm install --ignore-scripts`; no install script present in the package. |
| rete | 2.0.6 | MIT | Headless core (graph, nodes, sockets, connections, pipes) for the new canvas layer, `editor/src/app/rete/` — replacing Litegraph per `docs/working-notes/rete-migration-decision.md`. Promoted from the `pocs/poc-rete/` spike below, same exact pin (least drift from what was validated hands-on). Registry's own `time` field: this version published 2025-06-30, still the `latest` dist-tag — a release hiatus, not a maintenance hiatus, per the decision doc's dependency-risk check (10 open issues against 12k stars, plugin packages around it genuinely current). Not yet wired into `main.ts`/`index.html` — that's Phase 3; the Litegraph canvas stays the live path until then. |
| rete-area-plugin | 2.3.2 | MIT | Canvas rendering surface (pan/zoom/drag). Same promotion as `rete` above. |
| rete-connection-plugin | 2.0.5 | MIT | Wire drag gesture. Same promotion as `rete` above. |
| rete-render-utils | 2.0.3 | MIT | Shared rendering utilities, peer dependency of `rete-vue-plugin`. Same promotion as `rete` above. |
| rete-vue-plugin | 2.1.3 | MIT | Vue 3 node/control renderer — `editor/src/app/rete/ThingstudioNode.vue`/`ThingstudioSocket.vue`'s `customize.node`/`customize.socket` hooks. Sole maintainer `ni55an` (Vitaliy Stoliarov, per registry metadata) — the same single-maintainer bus-factor point the decision doc's dependency-risk section makes about the `rete` core. |
| vue | 3.5.41 | MIT | Peer dependency of `rete-vue-plugin`; the first real framework commitment `editor/` has taken on (not just a library), accepted knowingly per the decision doc. |

`rete-dock-plugin` is deliberately **not** in this table — sub-decision 2
of the decision doc drops it in favor of the hand-rolled HTML5 drag-and-drop
already proven in `pocs/poc-rete/src/PaletteSidebar.vue` (ported to
`editor/src/app/rete/PaletteSidebar.vue`). It stays listed only in the
`pocs/poc-rete/` table below, frozen there.

All six packages above installed with `npm install --ignore-scripts`
(`rete`'s own `postinstall.js` re-inspected 2026-08-16, still the harmless
"Stand with Ukraine" console banner poc-rete's own check found — no
network/filesystem effects). Verified in a scratch directory outside the
live-mounted repo before any source was copied in, per this project's own
`node_modules`-corruption workaround (`CLAUDE.md`) — `editor/package.json`
now lists the real dependency entries, but the actual `npm install`
populating `editor/node_modules` is Mike's, run from a real Terminal, same
reasoning as this file's git-write convention.

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
| mqtt_as | 0.8.5 (upstream `VERSION` const; not pinned to an exact commit SHA — see its own README) | MIT | `device-runtime/src/vendor/mqtt_as/__init__.py`. Asynchronous, `uasyncio`-native MQTT client from [peterhinch/micropython-mqtt](https://github.com/peterhinch/micropython-mqtt), used by the `mqtt_publish`/`mqtt_subscribe` nodes. Chosen over `umqtt.simple` specifically for non-blocking I/O and built-in WiFi/broker reconnection — see `device-runtime/src/vendor/mqtt_as/README.md` for the full rationale, including why this one case departs from `cbor.py`'s hand-rolled-over-dependency precedent. **One local patch since 2026-09-25** (marked `THINGSTUDIO PATCH`): `wifi_connect()` skips `connect()` when the station is already connected. Before that it was vendored unmodified and the WiFi-reconnect race was worked round on Thingstudio's side; see the vendored README. |
| ThreadSafeEvent | commit `0fb2f22d1b130d63be2ec4d66958c4f6eb8106b3` (2024-05-09, last commit to touch the file — a tighter pin than `mqtt_as`'s own version-only one) | MIT | `device-runtime/src/vendor/threadsafe_event/threadsafe_event.py`. From [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async) (`v3/threadsafe/threadsafe_event.py`), used by the `interrupt` node (Tier 1 item 5) to bridge `machine.Pin.irq()`'s hard-IRQ context safely into `uasyncio` — the first hard-IRQ-adjacent code in this project. Only this one file vendored, not the rest of the upstream `threadsafe` package (`message.py`/`threadsafe_queue.py`/`context.py` aren't used); see `device-runtime/src/vendor/threadsafe_event/README.md` for why this one class specifically, and the hard-IRQ-safety trace (confirmed against upstream's own `THREADING.md`, not inferred from the class name). |
| ESwitch/EButton + Delay_ms | `events.py` pinned to commit `0fb2f22d1b130d63be2ec4d66958c4f6eb8106b3` (2024-05-09); `delay_ms.py` pinned to commit `74e4dbcece1baa51e0e1df48cb474bcf304373c5` (2025-11-20) — both the last commit to touch that path, per a real clone's own `git log -- <path>` | MIT | `device-runtime/src/vendor/primitives_events/{events,delay_ms}.py`. From [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async) (`v3/primitives/events.py`, `v3/primitives/delay_ms.py`), used by the new `eswitch`/`ebutton` nodes (`outstanding-items.md`'s "[P4] eswitch/ebutton nodes", resolving design doc §11's open `micropython-async`-adoption question for switches/buttons — ADC/encoders still open). Two import-only local patches (flat-file layout, one genuinely-dead upstream import removed) — see `device-runtime/src/vendor/primitives_events/README.md` for exactly what changed, both files' before/after SHA-256, and a real structural limitation of `EButton`'s class-attribute-based timing config worth knowing before adding a second `ebutton` node to a flow. |
| st7789py_mpy | commit `c7d4b89b0835777bad7f42d27c5a0d8b9215f6ad` (last commit to touch the file, per a real clone's own `git log -- <path>`) | MIT | `device-runtime/src/vendor/st7789py_mpy/st7789py.py`. From [devbis/st7789py_mpy](https://github.com/devbis/st7789py_mpy), a pure-MicroPython SPI driver for the ST7789 TFT controller, used by the new `display_spi` node (`outstanding-items.md`'s "[P4] SSD1306 display node"). Chosen over `russhughes/st7789_mpy` specifically because that one needs a custom-compiled MicroPython firmware build — a hard incompatibility with this project's stock-MicroPython + `mpremote cp` deployment model. Vendored unmodified — see `device-runtime/src/vendor/st7789py_mpy/README.md` for the full provenance/hash story and why no patch was needed. |
| ssd1306 (micropython-lib) | commit `a08087249fda8a7994f7c54ccaad29fb9fcc448a` (last commit to touch the file, per a real clone's own `git log -- <path>` — re-derived after an initial shallow-clone attempt silently returned an unrelated commit, see the README below) | MIT | `device-runtime/src/vendor/ssd1306/ssd1306.py`. From [micropython/micropython-lib](https://github.com/micropython/micropython-lib) (`micropython/drivers/display/ssd1306`), a `framebuf.FrameBuffer`-subclassing driver for the SSD1306 I2C/SPI mono OLED controller, used by the new `display_i2c` node (only the `SSD1306_I2C` variant is wired up — `SSD1306_SPI` is out of scope, matching the SPI/I2C node-family split). Vendored unmodified — see `device-runtime/src/vendor/ssd1306/README.md` for the full provenance/hash story, including the shallow-clone pitfall worth reading before a future vendoring session repeats it. |

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
for the full spike write-up.

**Six of these seven were promoted to real `editor/` runtime dependencies
2026-08-16** — same status Litegraph/Drawflow had before Litegraph's
2026-08-14 promotion into `editor/public/vendor/`; see the "Editor runtime
dependencies" table above for their live entries.
`rete-dock-plugin` is the one exception and stays POC-only permanently —
sub-decision 2 of `rete-migration-decision.md` deliberately drops it in
favor of the hand-rolled HTML5 drag-and-drop already proven in
`pocs/poc-rete/src/PaletteSidebar.vue`.

| Package | Version installed | License | Notes |
|---|---|---|---|
| rete | 2.0.6 | MIT | **Promoted to `editor/`.** Headless core. Registry's own `time` field: this exact version published 2025-06-30 and is still the `latest` dist-tag — over a year stale by npm-publish-date, a correction against the spike briefing's looser "actively maintained, June 2026" framing. |
| rete-area-plugin | 2.3.2 | MIT | **Promoted to `editor/`.** Canvas rendering surface; published 2026-07-08, genuinely current |
| rete-connection-plugin | 2.0.5 | MIT | **Promoted to `editor/`.** Wire drag gesture; published 2024-08-30 |
| rete-render-utils | 2.0.3 | MIT | **Promoted to `editor/`.** Shared rendering utilities, peer dep of rete-vue-plugin; published 2024-08-30 |
| rete-vue-plugin | 2.1.3 | MIT | **Promoted to `editor/`.** Vue 3 node/control renderer; published 2026-07-10, genuinely current |
| rete-dock-plugin | 2.0.4 | MIT | **Not promoted — deliberately dropped** (sub-decision 2). Palette drag-and-drop plugin; published 2025-04-27. Stays here as the frozen record of what was evaluated, not a candidate going forward. |
| vue | 3.5.41 | MIT | **Promoted to `editor/`.** Peer dep of rete-vue-plugin |

## Vendored in the POCs (frozen historical reference, not live v1 dependencies)

Physically present in `pocs/`, evaluated and validated there, but not
yet real dependencies of anything under `editor/` or `device-runtime/` —
listed for completeness/audit trail since the files exist in this repo,
not because any current build depends on them.

| Library | Version | License | Where |
|---|---|---|---|
| Litegraph.js | 0.7.18 | MIT | `pocs/poc-c/litegraph.min.js`, `pocs/poc-d/litegraph.min.js` — chosen per design doc §11/§15.3 as the real v1 canvas library. **Now also a live dependency**, copied into `editor/public/vendor/litegraph/` — see the "Vendored in `editor/`" table above; this POC copy is kept as the historical/frozen reference the live copy was taken from, not a second independent instance. |
| Drawflow | 0.0.60 | MIT | `pocs/poc-c/drawflow/` — **evaluated and dropped** (§11/§15.3: needed hand-rolled type-checking, execution engine, and can't reach multi-select at all); kept only as the comparison record, not a candidate going forward |

## Backend (pip, `backend/pyproject.toml`)

**New 2026-09-07**, minimal backend build (`docs/working-notes/outstanding-items/backend-auth-overview.md`,
[P1]): platform/framework/serial-library choice was already made and its license checked in
`docs/working-notes/backend-platform-decision.md` §6 before any code existed; this entry records what's
actually installed and verified now that it is. Flagged to Mike before installing per `CLAUDE.md`'s
dependency convention, applied to pip the same as npm. Versions/licenses below are from the installed
packages' own metadata (`pip show <package>`), not recalled from memory -- re-verify the same way after any
update, same practice as the npm tables above.

| Package | Version installed | License | Notes |
|---|---|---|---|
| aiohttp | 3.14.3 | Apache-2.0 AND MIT (dual, per its own metadata) | HTTP/WebSocket server (`backend/src/thingstudio_backend/app.py`). Chosen over FastAPI specifically for not carrying Starlette/Pydantic/Uvicorn's weight for capabilities this backend doesn't need -- see `backend-platform-decision.md` §3. Installs from a prebuilt wheel; no arbitrary install script runs at `pip install` time. |
| pyserial | 3.5 | BSD (3-clause) | Serial I/O (`backend/src/thingstudio_backend/serial_relay.py`), wrapped in `asyncio.to_thread` rather than taking on the (dead-upstream) `pyserial-asyncio` -- see `backend-platform-decision.md` §4. Same package already tracked, unpinned, under "`test/hil/` tooling" below for a different, older use (`test/hil/run_fault_isolation_checks.py`) -- this is the first place it's a real pinned `pyproject.toml` dependency. |
| pytest | 9.1.1 | MIT | Test runner, `backend/test/`. Dev/test-only (`[project.optional-dependencies].test`), not a runtime dependency of the shipped backend. |
| pytest-asyncio | 1.4.0 | Apache-2.0 | `asyncio`-aware test support for `backend/test/test_ws_relay.py`/`test_middleware.py`'s `async def test_*` cases. Dev/test-only, same as pytest above. |

Verified this session in a scratch venv outside the live-mounted repo (`/tmp`, not under `backend/`), same
discipline as the editor's npm-install workaround (`CLAUDE.md`) -- the actual `pip install` populating a real
venv under `backend/` is Mike's own step, run from a real Terminal, for the same shared-mount/cross-platform-
binary reason (`aiohttp` ships platform-specific compiled wheels, same hazard class as npm's native bindings).

## Documentation build tooling (pip)

Builds the user docs (`mkdocs.yml`, `docs/user-guide/`) into `site/`. Since 2026-09-23 the built site also ships
to users: the backend serves it at `/docs/` (`backend/src/thingstudio_backend/docs_site.py`), so
mkdocs-material's own CSS/JS (MIT) is redistributed inside every built copy, not just used at build time.
Versions and licenses confirmed 2026-09-23 from the installed packages' own metadata in a scratch venv
(`License-Expression`: mkdocs `BSD-2-Clause`, mkdocs-material `MIT`).

| Package | Version | License | Notes |
|---|---|---|---|
| mkdocs | 1.6.1 | BSD-2-Clause | Static site generator. Build-time only. |
| mkdocs-material | 9.7.7 | MIT | Theme (`mkdocs.yml`'s `theme.name: material`). Its CSS/JS is in every built site the backend serves. `theme.font: false`, so no Google Fonts are fetched or bundled. |

Both pinned in `.github/workflows/docs.yml`'s `pip install` step -- update the pin there in the same change if
either version changes here. Not gated by `CLAUDE.md`'s npm-specific install-flag rule (these are pip, not npm
packages), but flagged and tracked here per that rule's own spirit, same as `test/hil/`'s `pyserial` entry above.
Installing them is Mike's own step, run from a real Terminal -- same shared-mount reasoning as this project's
npm-install-from-the-sandbox restriction (`CLAUDE.md`).

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
