# BLE nodes and ESP32-C5 bring-up — briefing

Status: handoff, 2026-11-04. Two days with Mike (2026-11-03/04, one cloud session): Bluetooth LE nodes in three
phases, the ESP32-C5 brought up as a board, package libraries (runtime 15.0.0), and the fixes those turned up.
Phase 3 is PR #10, open. **Next: custom firmware images for the ESP32-C5 and C3** (section "Next").

Read first: `ble-nodes-scoping.md` (the design, phase by phase) and `decisions/ble-nodes.md` (every call, Mike's
and the session's, dated). Hardware evidence: `learnings/hardware-bringup-hil-rig.md` (the C5 entries).

## Where things are

| What | State |
|---|---|
| PR #6 — BLE phase 1 (`ble scan`, `ble advertise`), ESP32-C5 processor + ESP32-C5-340X board, CLI checks custom nodes, inject re-type fix | merged |
| PR #7 — flow libraries may be packages (`aioble/core.py`), runtime **15.0.0** | merged |
| PR #8 → #9 — BLE phase 2 (GATT server: `ble characteristic in/out`, `ble uart in/out`, `ble` config) | merged (#8 merged into `ble-nodes` by mistake; #9 carried it to `main`) |
| Branch `ble-phase-3` — phase 3 (central: `ble peer` config, `ble read/write/notify`), `ts_ble` split into a package, radio-stays-on fix, console scroll fix | **PR #10, open** |

Branches `ble-nodes`, `ble-phase-2`, `dep-catalog-packages` are merged and can be deleted.

## What the BLE work is

- **`ts_ble`** (`device-runtime/src/vendor/thingstudio_ble/ts_ble/`) — Thingstudio's own library on MicroPython's
  raw `bluetooth` module, not `aioble` (it claims the radio's IRQ at import). A package of three parts: the core
  (radio, scan, advertise, advertising data, value encodings; 6.3 KB `.mpy` for the C5), `ts_ble.server` (GATT
  server + Nordic UART, 2.4 KB), `ts_ble.central` (GATT client, 6.2 KB). Each node imports only its part. The pymock
  copy (`editor/test/fixtures/pymock/ts_ble/`) is checked byte-identical by `ts-ble.test.ts`.
- **One radio, keyed singletons**: `runtime.shared('ble'|'ble_scan'|'ble_gatt'|'ble_peer', ...)`. The GATT service
  table is built at compile time from the whole flow (`core-packages/ble-shared.ts`) and registered once.
- **The radio stays on between flows.** Redeploy cleanup stops scans, advertising and links and detaches the
  handler, but never `active(False)`: off-then-on between flows left the C5's controller refusing the next scan
  (`OSError(-519)`, HCI 0x07) until a power cycle — found by a BLE_TRACE, not reproducible at the REPL. Cost,
  documented (FAQ, `nodes/ble.md`): the stack keeps its ESP-IDF memory until a reset.
- **Central path** (`_Peer`): finding → connecting → discovering → connected, each step bounded, a failure reported
  once and retried after 10 s, never a different device, nothing queued while disconnected. Gotcha found on the
  board: `gattc_discover_descriptors(conn, start, end)` searches strictly *after* `start` (NimBLE) — pass the value
  handle.
- **Security**: someone in Bluetooth range is tier **Accept** (`security-policy.md` §2, §3.6): unpaired GATT
  server (Mike's call), central connects only to the peer a flow names.

Checked on hardware (ESP32-C5-340X central, an ESP32-C3 board (reports "ESP32C3 module") as peer, nRF Connect): scan, advertise,
characteristic read/write/notify, UART echo, central read/write/notify against the C3, redeploys with the
radio-stays-on fix, the package install of `ts_ble` on both boards.

## Open on this thread

1. **Redeploying over a busy BLE flow can fail with `MemoryError`** (C5: 50 KB free, no 5 KB block for a deploy
   piece; C3: 6 KB ESP-IDF heap and ~30 KB MicroPython heap with a GATT flow). Mike's 2026-10-23 rule stands: no
   stop-first deploy sequence; the guidance is Remove flow…, (power cycle), deploy — and **a firmware image with the
   libraries built in**. That is the next piece of work (below). Not yet re-tested after the package split: a
   scan-only flow now loads only the 6.3 KB core.
2. **A C3 running a BLE flow has ~6 KB of ESP-IDF heap** — WiFi alongside BLE is unlikely to fit. Worth a FAQ line
   once measured with a WiFi flow.
3. **Connection limit** per board isn't checked at compile time (the C5's isn't known). Over it, the extra peers
   report failure on the board.
4. **Suggested tasks queued for Mike** (cards in the app): flaky
   `backend/test/test_ws_relay.py::test_install_runtime_relays_progress_before_the_result` (fails ~1 in 3, on main
   too); an editor tab left open across a Thingstudio update compiles with old node code — compare builds on
   reconnect and refuse Deploy until reloaded (cause of a confusing `'_Radio' object has no attribute 'gatt'`).
5. **Classic-ESP32 custom image needs a rebuild**: it is runtime 14.1.0; an editor on 15 refuses to deploy to it.

## Next: custom firmware images for the ESP32-C5 and C3

Mike, 2026-11-04: "surely the answer is once again a custom c5 (and c3) build?" — yes, per
`decisions/classic-esp32-firmware.md` (2026-10-23: "a firmware image with the libraries built in … or the same
technique on another board"); the classic image already showed three deploys over a running GUI flow.

Shape (proposed, not started):

- Generalise `firmware/classic-esp32/` into a family with a board folder per target (classic, C3, C5).
  `stage.py`, `gen_deps_index.mjs`, `tested.json`, `record-tested.sh`, `publish.sh` are target-agnostic in what they
  freeze; `build.sh` pins `MPY_VERSION="v1.28.0"` and ESP-IDF 5.4 and one `BOARD`.
- The C5 needs MicroPython **1.29.0** (the board runs `ESP32_GENERIC_C5` 1.29.0) and the ESP-IDF that release pins —
  check `ports/esp32/README.md` at the tag before assuming 5.5. Decide with Mike: one pin for all targets, or per
  target.
- Per target: `sdkconfig` fragments (`sdkconfig.base`, `sdkconfig.riscv`, `sdkconfig.ble`, the C5's
  `sdkconfig.240mhz` and PSRAM line — the ESP32-C5-340X's C5-FH4 module has **no PSRAM**, so drop
  `sdkconfig.spiram_quad`), flash size, partitions, and the C5's **0x2000** image start (`builds.json` entries can
  carry their own `address`; the classic image is a merged image at 0).
- Freeze everything, `ts_ble` (a package) included: CI's frozen-set check already counts packages.
- **Builds run on Mike's Mac** (decided 2026-10-23: local, not `firmware.yml`); this cloud session can't install
  ESP-IDF. Write the scripts and board folders, Mike builds, flashes, and records with `record-tested.sh`.
- Docs: `docs/user-guide/custom-firmware.md` (now classic-only), the firmware dialog's builds, `supported-hardware.md`.

## Environment and commands (this session)

- Cloud container, repo at `/home/user/thingstudio`, pushed with the session's GitHub access (`add_repo` with push;
  the first attempt was blocked by auto mode, allowed on Mike's say-so). `gh` works through the REST API only
  (`gh api repos/mkarliner/ThingStudio/pulls ...`); `gh pr create` fails (no GraphQL). Retargeting a PR's base was
  blocked by auto mode — ask Mike or do it in the GitHub UI.
- **Editor**: `cd editor && npm ci --ignore-scripts`, `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/vitest
  run`, `npm run build:cli`, then `node dist-cli/thingstudio-compile.mjs --board board:esp32-c5-340x <flow>`
  (custom nodes: `--custom-nodes <dir>`; arch follows the board). Catalog: `node dist-cli/thingstudio-compile.mjs
  --describe-all --markdown > ../docs/user-guide/nodes-catalog.md`. This is a fresh clone, not the shared Mac mount,
  so npm here is safe.
- **MicroPython 1.29.0 unix port + mpy-cross**, built from `device-runtime/test/README.md`'s recipe in the session
  scratchpad (`git clone --depth 1 --branch v1.29.0`, `make -C mpy-cross`, `make -C ports/unix submodules all`):
  `test_ts_ble.py`, `test_deps.py`, `test_runtime.py`, `test_listener_integration.py`/`test_exchanges.py` (with
  `MICROPYTHON_BIN`/`MPY_CROSS_BIN`). A new session rebuilds it (~3 min).
- **Backend**: a scratch venv from `backend/requirements.txt` (`pip install --require-hashes --no-deps -r ...`), then
  `PYTHONPATH=src <venv>/bin/python -m pytest -q test`.
- **Docs**: `python3 tools/docs_lint.py` (US spelling: "grays", not "greys").
- Network: `micropython.org`, `www.espressif.com`, `documentation.espressif.com` are blocked from the cloud
  container; GitHub is reachable (ESP-IDF and MicroPython sources were read from it).
- **On Mike's Mac**, after pulling a branch: restart Thingstudio *and* hard-reload the editor tab (Cmd-Shift-R) —
  the tab reconnects by itself but keeps its old code. A changed `ts_ble` reaching a board running a BLE flow:
  Tools → Remove flow…, power cycle, then deploy. The editor's command box takes one line (`;` and list
  comprehensions). The ESP32-C5 installs MicroPython at **0x2000** (esptool or the firmware dialog; Thonny writes
  at 0 and the board boot-loops with `invalid header`).
- Thonny issue (address 0x2000 for C5/P4): filed upstream by Mike, 2026-11-04: thonny/thonny#3963. When it is fixed, update the Thonny note in
  `installing-micropython.md`.
