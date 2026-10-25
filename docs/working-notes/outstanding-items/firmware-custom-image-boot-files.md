# A frozen image needs a boot script, and the runtime install should provide it

Status: open, found 2026-10-25 while writing the user docs for **Tools → Install firmware…**; direction settled the
same day (Mike: choose the clean shape, no compatibility hedge while there is no user base).

## The problem

Thingstudio's classic-ESP32 image holds the runtime and every library frozen, but a frozen module cannot be the boot
script, so `firmware/classic-esp32/install.sh` also writes `/main.py` over `mpremote`. A board flashed with the image
alone boots to the REPL and never sends `HELLO`, so the CYD's `firmware` block was withdrawn rather than shipped as a
trap.

The image also has no `/lib/_deps.json`. Without it, Deploy pushes its own copies of every library into `/lib`, where
`deps.ensure_on_path()` puts them ahead of the frozen ones — the heap saving the image exists for is lost.

## The shape we chose

Split what one "Install runtime…" does into the pieces an image actually needs, and let the board's own state decide:

1. **Boot script, always.** `/main.py` becomes one generated file for every case:
   `import listener` / `listener.main()`. The installer stops copying `listener.py` as `main.py`; the behaviour is
   the same once `listener` is importable from the filesystem or from flash.
2. **Runtime core, only when it is missing.** One REPL probe decides: `import listener` succeeds on a frozen image
   (and on a board already carrying the runtime), and fails on a blank stock board. Frozen → skip the core files;
   failed → push `CORE_FILES` as today. One command, two outcomes, no retry chain.
3. **Inventory, from the image.** The inventory is frozen into the image as a module (generated beside the image by
   the build from the same hashes `gen_deps_index.mjs` already computes), and `deps.py` prefers the file when Deploy
   has written one and falls back to the frozen module. No `/lib/_deps.json` in the image, no URL in the board
   block, nothing to download before a flash, and the hashes cannot drift from the image because the build emits
   both.

Consequence: no new board-descriptor key. The CYD's `firmware` block comes back as `runtime: "install"`, and
**Tools → Install runtime…** does the right thing on a frozen image instead of pushing a filesystem copy of the
runtime.

Rejected on the same call: an interim `inventory`/`files` URL in the board block. It exists only to avoid a rebuild
nobody has to run, and no board has been deployed to protect.

## Order of work

- **Done, 2026-10-25.** Backend: `raw_repl.is_frozen_image()` (one command, `import deps_frozen`) and
  `RuntimeInstaller.install()` writing the boot script always, the core files only on a stock board. Device
  runtime: `deps.read_index()` merges `deps_frozen.INVENTORY` under `/lib/_deps.json`, file first. Manifest:
  `MAIN_FILE`/`BOOT_SCRIPT`, and a stock install now pushes `listener.py` under its own name beside `main.py`.
  Build: `build.sh` writes `deps_frozen.py` into the frozen stage and `out/main.py` from the manifest;
  `install.sh`, `publish.sh` and the firmware README drop `/lib/_deps.json` (three release assets now). Runtime
  bumped to 14.1.0 with the editor target.
- **Left:** publish the rebuilt image (built 2026-10-25: `thingstudio-classic-esp32-14.1.0-5e168de.bin`, sha256
  `9a077d5ac89daba032f756a71fb27e40b377815c76eb1ac0cde09ed94cb13f33`), re-add the CYD's recipe pinned to that
  asset, then the hardware pass (blank CYD, one flash, **Install runtime…**, `HELLO` with the runtime version).
  `docs/user-guide/custom-firmware.md` still describes the four-asset install of the currently released image;
  update it with the release that carries the rebuilt image.
