# Custom firmware family (classic ESP32, C3, C5) — briefing

Status: handoff, 2026-11-04. One cloud session with Mike. The single classic-ESP32 image's tooling became a family of
targets, the C3 and C5 were added, and two rules came out of it. Branch `custom-firmware-family`, PR open against
`main`. **Next: Mike builds, flashes and records the three images on the Mac** (section "Next"; the
stand-alone task brief for that session is `firmware-images-build-and-record-briefing.md`).

Read first: `decisions/custom-firmware.md` (every call, dated), `firmware/README.md` (how to build, record, publish
and add a target). Previous thread: `ble-nodes-and-c5-bringup-briefing.md` (BLE PR #10 is still open; this work is
independent of it and based on `main`).

## What landed

- **Rules.** `AGENTS.md` "Scope is not shape" (under "No premature optimization"): one instance is a folder or
  entry, a decision narrowing to one says "A second one would need: …", tests iterate the registry. Mike's rule
  that every image is rebuilt at each runtime bump is in `decisions/custom-firmware.md`.
- **Layout.** `firmware/targets/{classic-esp32,esp32-c3,esp32-c5}/` with `target.json` (facts and per-target pins),
  `board/` (three files), `tested.json`. Shared scripts in `firmware/` take a target. `tools/firmware_targets.py`
  is the one reader (`list`, `env`, `check`, `current`). `.github/workflows/firmware.yml` removed (never built).
- **Pins.** Every target at MicroPython v1.29.0 and ESP-IDF v5.5.2; `build.sh` refuses any other checkout. The
  classic image moves up from v1.28.0 / ESP-IDF 5.4.
- **Gate.** The Release workflow refuses a tag unless each target has a tested image at the tag's runtime version,
  built from a commit the tag contains. CI warns on every push meanwhile (it warns today: no target has a 15.0.0
  image). `publish.sh` attaches all targets at once or none.
- **Catalogue.** `firmware_catalogue.py --image` creates a target's build entry from `target.json` on its first
  published image; `--check` runs `firmware_targets.check()` too. The editor's `firmware-assets.test.ts` iterates
  targets and requires the user guide to list each target's label.
- **Docs.** `custom-firmware.md` covers all three chips (table with addresses); links, FAQ (C5 PSRAM line),
  `installing-micropython.md`, `debugging.md`, `security-policy.md`, `third-party-licenses.md`, pinning decision.

Checked in this session: all three targets **build** here (see Environment) — classic 1.75 MB, C3 1.85 MB, C5
2.06 MB, merged layouts correct (C5 bootloader at file offset 0 = flash 0x2000). Not checked: any image on a board.
Those builds are `-dirty` and use GitHub copies of two registry components, so they are not release images.

## Next: build, flash, record (Mike, on the Mac)

1. ESP-IDF v5.5.2 (the Mac has 5.4 for the old classic pin):
   `git clone -b v5.5.2 --recursive https://github.com/espressif/esp-idf.git ~/esp/esp-idf-5.5.2 &&
   ~/esp/esp-idf-5.5.2/install.sh esp32,esp32c3,esp32c5`, then `. ~/esp/esp-idf-5.5.2/export.sh`.
2. MicroPython at v1.29.0: `git -C ~/micropython fetch --depth 1 origin tag v1.29.0 && git -C ~/micropython
   checkout v1.29.0 && make -C ~/micropython/ports/esp32 submodules` (a fresh clone is fine too).
3. On a clean checkout of the merged branch: `MICROPY_DIR=~/micropython firmware/build.sh esp32-c5` (then
   `esp32-c3`, `classic-esp32`). A dirty tree names the image `-dirty` and it cannot be recorded.
4. `PORT=/dev/cu.… firmware/install.sh esp32-c5`, connect, deploy a BLE flow twice over a running one (the C5 is
   the board that hit `MemoryError` redeploying a BLE flow on stock). Note the `[memory]` lines for the C3/C5 rows
   the user guide says are not measured yet.
5. `firmware/record-tested.sh firmware/out/esp32-c5/<image> "ESP32-C5-340X" "<what ran>"`, likewise the C3
   ("LuatOS ESP32C3-CORE" or the board that reports "ESP32C3 module") and the CYD. Commit the three `tested.json`.
6. Release as usual; `firmware/publish.sh v<version>`, then `tools/firmware_catalogue.py --image … --url …` per
   target.

## Open on this thread

1. **Board variants for the C3/C5 boards.** `esp32-c5-340x.json` has no `variant`; `luatos-esp32c3-core.json`
   names `esp32-c3-generic`. Once `thingstudio-esp32-c5`/`-c3` are in the catalogue, decide whether those boards
   point at them (as the D1 R32 does at the classic image, Mike 2026-10-31). `definitions.test.ts` requires a
   variant's build to exist, so it cannot be set before the first publish.
2. **Deploy over a running flow on the C3/C5 images** is the measurement that says whether the images fix the
   BLE thread's `MemoryError` item. The user guide's claim is deliberately soft ("more likely to fit") until then.
3. **BLE connection limit** (BLE briefing open item 3): NimBLE allows 4 on every ESP32 build
   (`learnings/firmware-builds.md`). Worth a line in `nodes/ble.md` on PR #10's branch, and possibly a compile-time
   check counting peers plus expected centrals.
4. **Already failing on `main`**, not touched here: `editor/test/cli-describe.test.ts`, 3 tests (the generated
   node catalog is stale against the node pages); the flaky `test_ws_relay` test from the BLE briefing.
5. The classic image's old 14.x versions stay in `builds.json`; an editor on 15 refuses to deploy to them. Drop
   them when 15.0.0 is published, or keep them for the record — Mike's call.

## Environment and commands (this session)

- Cloud container, repo cloned to `/home/claude/thingstudio` (`add_repo` with push), not the shared Mac mount, so
  `npm ci`, vitest and git commits here are safe. `gh` works through the REST API only (`gh api …`).
- **Editor**: `cd editor && npm ci --ignore-scripts`, `./node_modules/.bin/vitest run <files>`; `npm run build:cli`
  for the CLI tests.
- **Backend**: `python3 -m venv /tmp/bvenv && /tmp/bvenv/bin/pip install --require-hashes --no-deps -r
  backend/requirements.txt` plus `pytest pytest-asyncio`; `cd backend && PYTHONPATH=src /tmp/bvenv/bin/python -m
  pytest -q test`. System `python3 -m pytest` lacks the backend's deps.
- **Firmware checks, no toolchain**: `python3 tools/firmware_targets.py check`, `current --warn`,
  `python3 tools/firmware_catalogue.py --check`, `python3 firmware/stage.py firmware/out/ci/stage && node
  firmware/gen_deps_index.mjs firmware/out/ci/stage firmware/out/ci/_deps.json`.
- **Firmware builds in the cloud** (about 5 minutes per target on 2 cores): ESP-IDF v5.5.2 cloned from GitHub to
  `/tmp/esp/esp-idf`, `./install.sh esp32,esp32c3,esp32c5` (tools come from GitHub) then
  `IDF_PYTHON_CHECK_CONSTRAINTS=no python3 tools/idf_tools.py install-python-env` (the constraints file is on the
  blocked `dl.espressif.com`). MicroPython v1.29.0 at `/tmp/mp129` with `lib/berkeley-db-1.xx` and
  `lib/micropython-lib` inited by git (`make submodules` contacts the blocked component registry), and
  `ports/esp32/main/idf_component.yml` overriding `espressif/mdns` and `espressif/lan867x` with GitHub clones
  (`learnings/firmware-builds.md`). Then `. /tmp/esp/esp-idf/export.sh` and `MICROPY_DIR=/tmp/mp129
  firmware/build.sh <target>`. All of it is in `/tmp` and gone with the container.
- Blocked from the container: `micropython.org`, `dl.espressif.com`, `components.espressif.com`,
  `components-file.espressif.com`. GitHub and PyPI work.
- `docs`: `python3 tools/docs_lint.py`.
