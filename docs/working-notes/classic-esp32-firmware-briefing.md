# Custom firmware for classic ESP32 — briefing

Written 2026-10-22 (revised the same day, from "CYD only" to classic ESP32 generally), after the
**CYD gate failure**: on a fresh runtime install, deploying the hero GUI flow hit `MemoryError
allocating 13317 bytes` and never ACKed (`decisions/gui-layout.md`, 2026-10-09 gate / 2026-10-22
result). Per the gate, the MVP ships a small set of custom images — this one is the classic-ESP32
image, and it is the whole set for that chip. Read
`frozen-firmware-spike-briefing.md` first for the technical basis; the decision record for what was
settled here is `decisions/classic-esp32-firmware.md`.

## Goal

A **supported-boards-only optional tier**: a prebuilt MicroPython image for **classic ESP32** with
Thingstudio's runtime, libraries and fonts frozen in, so those boards can run the GUI hero flow
without the heap/fragmentation failure. Stock firmware stays the default; the image is an opt-in
download.

One image covers every classic ESP32 board, not just one: pins and panel come from the board
descriptor in the editor, so the image carries no board-specific setup. The CYD is the board it is
proven on, not the only board it is for.

## Decisions settled 2026-10-22 (Mike)

1. **Target is classic ESP32** (Xtensa LX6, 4 MB, no PSRAM) — the `esp32` processor descriptor, not
   a board. CYD first verified; the WeMos D1-R32 is the same chip and needs nothing extra. S2/S3/C3
   stay out (different silicon, partitions or PSRAM), and so do the RP2040/RP2350 boards.
2. **Genuinely generic image** — no CYD pins, no panel init baked into firmware.
3. **Freeze the display/touch drivers too** (`st7789py`, `st7796py`, `ft6336u`) even though a
   headless board never imports them: they cost flash in a 3 MB slot, not heap.
4. **Optional, stock default** — but the failure must stay legible: when a Deploy ends without an
   ACK on a classic-ESP32 board, the console should point at the image rather than just time out.
5. **Docs + `esptool` for installing** — no editor flashing in v1. The backend owns the serial port;
   speaking the ROM bootloader protocol is a new subsystem with brick risk, and a half-right flasher
   is worse than a documented command. The same merged image can serve an editor flow later.
6. **No `HELLO` change** for the frozen set. `runtimeVersion` already gates Deploy, and the override
   property plus a shipped `/lib/_deps.json` do the rest (see below). Reporting frozen modules and
   hashes in `HELLO` would be an interface change with no diagnostic the version gate doesn't give.
7. **Checksums plus rebuildability** — publish SHA-256, and the build script, workflow and exact
   MicroPython/ESP-IDF versions, so anyone can rebuild the image. Signed firmware is deferred; the
   trigger to revisit is the first OTA-capable release, where delivery over the air raises the stakes.
8. **Single-app flash layout, merged image** — 3 MB app slot, 960 KB filesystem, no OTA slot. Dual
   OTA gives 1.5 MB per slot on 4 MB (MicroPython's own OTA table), which the frozen set is expected
   to exceed. Re-partitioning later costs one USB reflash, which is already the install path.

## What is already known (from the frozen-firmware spike)

- **Freezing saves about 75% of the heap those modules would use** (unix-port measurement; the CYD's
  problem is exactly the contiguous-block failure at import). Modules measured: `mqtt_as`,
  `thingstudio_gui`, GUI widget modules, fonts.
- **A pushed library can override a frozen one** if `/lib` comes before `.frozen` on `sys.path`
  (unix and ESP32 defaults put `.frozen` first). `deps.ensure_on_path()` appended and is changed to
  insert at position 0 under this brief, with a test — that is the property that keeps runtime and
  library updates cheap: the image still accepts pushed updates, so a bump is a push, not a reflash.
- **ROMFS** would keep the update story even cheaper, but stock builds for our boards have
  `MICROPY_VFS_ROM` off and no romfs partition. It still needs one image per board, then files are
  pushed into ROMFS. Worth measuring, not v1.
- **The board stages and firmware builds were never run** in the spike (the sandbox could not reach
  Espressif's toolchains). Everything here is unproven on hardware except the stock CYD baseline.

## Why the frozen set is not shadowed by Deploy

Deploy pushes the libraries a flow imports into `/lib`. With `/lib` first on `sys.path`, a pushed
copy wins over a frozen one — which would throw away the whole saving for exactly the big libraries
(GUI, fonts, drivers) that matter. The board solves this itself, with no protocol change:

- The image's build writes `/lib/_deps.json` — the same inventory `DEP_PUT`/`DEP_COMMIT` maintain —
  listing every frozen library with the hash the **editor** computes for it (compiled with the
  vendored `mpy-cross` WASM, `dependencyHash()`'s exact scheme; `firmware/classic-esp32/
  gen_deps_index.mjs`). `HELLO.dependencies` reports it, so the editor's existing
  `librariesToSend()` skips those libraries.
- Entries carry an empty file list on purpose: the bytes are frozen code, not files, so
  `deps.missing()` must not look for them on disk.
- If a hash doesn't match (an editor whose `mpy-cross` version differs), nothing breaks: the editor
  pushes a real copy, which updates the index and wins on `sys.path`. The saving is lost for that
  flow, correctness is not. That failure mode is why this needs no version negotiation.

A frozen image also has no runtime build marker, so `HELLO.runtimeBuild` reports `null` — "can't
confirm", which is what the editor's own check already treats it as.

## Scope of the image

**Frozen set** — everything `runtime_manifest.py` lists, derived from that file rather than a second
copy of it (`stage.py`), so the image can never disagree with what a stock install would push:

1. `mqtt_as`, `threadsafe_event`, the event/delay primitives, `aadc`, `encoder`, `ts_wifi`, `ts_mqtt`,
   `ts_http_server` (runtime dependencies and library code flows import).
2. `thingstudio_gui` and the `tsgui_*` widget modules, plus every font in the set.
3. `st7789py`, `st7796py`, `ft6336u`, `ssd1306`, `bme280_float`.
4. The runtime core (`CORE_FILES`) and the listener, so the board boots straight into the listener
   and a Deploy only pushes the flow.

Do **not** freeze the flow or board settings; they stay on the filesystem and are wiped by a flash,
which the docs must say.

**Boot**: a frozen module cannot be the boot script, so the image's filesystem gets a three-line
`/main.py` that imports the frozen listener and calls `main()` (`firmware/classic-esp32/main.py`).

## Build and distribution

1. **Pin MicroPython** (`v1.28.0`, what the CYD reports) and the ESP-IDF container
   (`espressif/idf:v5.4`); build from a tag, not master.
2. A custom board directory (`firmware/classic-esp32/board/`) on `BOARD=thingstudio_classic_esp32`:
   stock `sdkconfig.base` + BLE, 4 MB flash, size-optimised, our single-app partition table.
3. Build on a developer machine or `.github/workflows/firmware.yml`; the sandbox cannot build ESP32
   firmware. The artifact is a release asset, never a committed binary.
4. **`deps.ensure_on_path()` inserts `/lib` at position 0** before shipping, with a unix-port test
   for the order and a real-hardware check that a pushed library overrides the frozen copy.
5. **Package**: one merged `thingstudio-classic-esp32-<runtime>-<sha>.bin` (flash at 0x0, so the
   offsets can't be got wrong), SHA-256 beside it, plus `_deps.json`. No `curl | sh` route: the
   release page is the download, and `install.sh` is short enough to read first.
6. **Repo placement**: build inputs live in this repo. A separate firmware repo would need a
   submodule or a pinned copy of the runtime, and "the image is stale relative to the runtime" would
   become a silent failure mode — the frozen set *is* `runtime_manifest.py`. A separate repo earns
   its keep only at multiple image variants on their own release cadence, or key custody for signing.
7. **Docs**: a page naming the chip family, what is included, what a flash erases, how to flash from
   macOS/Linux/Windows, and how to go back to stock. Link it from the gate result. Written when the
   first image exists, not before.

## Verification

- **Rerun the CYD gate on the custom image** (the acceptance): fresh flash, hero GUI flow ↔ a
  different flow, five cycles, no manual resets; it must pass where stock failed.
- **Memory**: the spike's S0-S5 table (free, largest block, IDF free/largest) on the custom image;
  compare with the stock failure. Record the numbers.
- **Deploy-skips-frozen**: after flashing, a GUI flow's console line should name the libraries as
  already on the board, not push them; `/lib` should stay empty for those.
- **Override**: a pushed library at a different hash must win over the frozen copy; a runtime update
  must deploy without reflashing.
- **Version discipline**: the image's runtime version must equal the editor's
  `EDITOR_TARGET_VERSION`; a mismatch must be the normal Deploy refusal, not a silent broken flow.
- **Panel variants**: only Mike's CYD is confirmed ST7789; an ILI9341 batch needs a different driver,
  which this image does not carry. Say so in the docs.

## Remaining risks

1. **The build is unproven.** No stage of it has run on hardware or in CI yet; the first build will
   find its own problems (freeze paths, board-directory cmake, size).
2. **Image size vs the 3 MB slot** — if it overflows, drop fonts or `ssd1306`; measure before deciding.
3. **`mpy-cross` drift** — the image's index hashes must match the editor's; a drift costs the
   saving, not correctness (see above), but it is worth a check in the docs' troubleshooting page.
4. **`runtimeBuild` is `null`** on these boards by construction; a user comparing build SHAs sees
   "can't confirm" rather than a mismatch.

## Suggested order

1. Clear the CYD clean-gate rerun (the port was wedged after the failure) and confirm the failure from
   an idle start. Record the numbers.
2. Build the first image (now scripted), flash it, measure S0-S5.
3. Rerun the five-cycle gate on it.
4. Then the packaging/flashing docs page and the release asset.
