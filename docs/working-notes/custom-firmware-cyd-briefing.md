# Custom firmware for the CYD — briefing

Written 2026-10-22. Follows the **CYD gate failure** the same day (`decisions/gui-layout.md`, 2026-10-09 gate /
2026-10-22 result): after a fresh runtime install, deploying the hero GUI flow hit `MemoryError allocating 13317
bytes` and never ACKed. Per the gate, the MVP ships a small set of custom firmware images, classic ESP32 first. This
brief scopes that work. Read `frozen-firmware-spike-briefing.md` first — its desk findings are the technical basis.

## Goal

A **supported-boards-only optional tier**: a small set of prebuilt MicroPython firmware images with Thingstudio's
runtime, libraries and fonts frozen in, so a classic ESP32 (the CYD first) can run the GUI hero flow without the
heap/fragmentation failure. Stock firmware stays the default; a custom image is an opt-in download for a named
board.

## What is already known (from the frozen-firmware spike)

- **Freezing saves about 75% of the heap those modules would use** (unix-port measurement; the CYD's problem is
  exactly the contiguous-block failure at import). Modules measured: `mqtt_as`, `thingstudio_gui`, GUI widget
  modules, fonts.
- **A pushed library can override a frozen one** if `/lib` comes before `.frozen` on `sys.path` (unix and ESP32
  defaults put `.frozen` first; `deps.ensure_on_path()` currently appends `/lib`). This is the property that keeps
  runtime/library updates cheap: a custom image still accepts pushed updates, so a runtime bump is not automatically
  a reflash.
- **ROMFS** would keep the update story even cheaper (mount a read-only flash filesystem once), but stock builds for
  our boards have `MICROPY_VFS_ROM` off and no romfs partition. It still needs one custom build per board, then
  files are pushed into ROMFS. Worth measuring, not required for v1.
- **The board stages and firmware builds were never run** in the spike (the sandbox could not reach Espressif's
  toolchains). Everything below is unproven on hardware except the stock CYD baseline.

## Scope of the first image

**Board: the CYD (ESP32-2432S028, 4 MB, no PSRAM, ST7789 panel) only.** It is the gate's board and the one with the
proven failure. The Freenove S3 has PSRAM and does not need this; the C3 and Pico are later decisions.

**Frozen set, in order of heap value:**

1. `mqtt_as`, `threadsafe_event`, the event/delay primitives (runtime dependencies).
2. `thingstudio_gui` and the `tsgui_*` widget modules, plus the font modules a flow uses.
3. `st7789py`/`st7796py` and `ft6336u` (the display/touch drivers).
4. The runtime core (`device-runtime/src/*.py` and `runtime_manifest.py`'s `CORE_FILES`), so a stock-image board
   boots straight into the listener and Deploy only pushes the flow.

Do **not** freeze the flow or board settings; they stay on the filesystem and are wiped by a flash, which the docs
must say.

## Build and distribution

1. **Pin the MicroPython version** (the CYD reports 1.28.0) and the ESP-IDF version; build from a tag/commit, not
   master.
2. Build with `FROZEN_MANIFEST` listing the modules above, `BOARD=GENERIC` with the CYD's 4 MB flash setting and a
   partition table that leaves room for the filesystem (OTA layout already reserved per the project rule).
3. Do the build in GitHub Actions (`espressif/idf` image) or Mike's Mac — the sandbox cannot build ESP32 firmware.
   Commit a build script and manifest; the artifact is a release asset, not a repo binary.
4. **Patch `deps.ensure_on_path()` to insert `/lib` at position 0** before shipping, so pushed libraries override
   frozen ones. Add a test for the order and one real-hardware check that a pushed `mqtt_as`/driver overrides.
5. **Package**: `thingstudio-cyd-<version>.bin` (and the build's bootloader/partition pieces, or a merged image),
   with SHA-256 checksums on the GitHub release. No `curl | sh` install path; docs offer the release download and
   show the `esptool.py write_flash` command, plus the option to read the script.
6. **Docs**: a page naming the exact board, what is included, what a flash erases (flows, WiFi credentials, board
   settings), how to flash from macOS/Linux/Windows, and how to return to stock. Link it from the gate result.

## Verification

- **Rerun the CYD gate on the custom image** (the acceptance): fresh flash, hero GUI flow ↔ a different flow, five
  cycles, no manual resets; it must pass where the stock image failed.
- **Memory**: the spike's S0-S5 table (free, largest block, IDF free/largest) on the custom image; compare with the
  stock failure. Record the numbers.
- **Override**: a pushed library at a different hash must win over the frozen copy; a runtime update must deploy
  without reflashing.
- **Version discipline**: the image's runtime version must equal the editor's `EDITOR_TARGET_VERSION`; a mismatch
  must be the normal Deploy refusal, not a silent broken flow. Decide whether HELLO reports the frozen set and
  hashes (a protocol addition; not needed for v1 if the override works).
- **Variants**: only Mike's CYD is confirmed ST7789; the docs must say the image is for that panel family and that
  an ILI9341 batch needs a different image/driver.

## Risks and open questions (Mike)

1. **Optional or required at launch?** Recommendation: optional, stock default. The gate says custom images ship,
   not that every board gets one.
2. **First release board set** — CYD only (recommended), or also ESP32-C3 / Pico W?
3. **Flashing UX** — docs + esptool first (recommended), or an editor "install firmware" flow? The editor cannot
   flash today.
4. **HELLO reporting** — add frozen modules and hashes to HELLO (protocol change, needs approval), or rely on the
   `/lib` override and skip it?
5. **Signing** — checksums now; is signed firmware a release requirement? (The security policy's release-signing
   draft applies.)
6. **Partition/flash size** — confirm the CYD's real flash size and whether OTA is in scope; a merged image vs
   separate bootloader/partition/app binaries.

## Suggested order

1. Resolve the CYD clean-gate rerun (the port was wedged after the failure) and confirm the failure from an idle
   start. Record the numbers.
2. Build a first image with `mqtt_as` + fonts + GUI + drivers frozen; flash it; measure S0-S5.
3. Rerun the five-cycle gate on it. If it passes, freeze the runtime too and repeat.
4. Patch `/lib` ordering, test the pushed override, then write the packaging/flashing docs and release assets.
