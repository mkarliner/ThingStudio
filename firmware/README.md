# Custom firmware images

MicroPython images with Thingstudio's runtime and every flow library frozen in, one per **target** chip. Frozen
modules are read from flash instead of loaded into RAM, which is what lets a small board run flows that run out of
memory on stock MicroPython.

One image per chip, any board on that chip: pins come from the board definition in the editor, not from the
firmware.

- User guide: `docs/user-guide/custom-firmware.md`
- Decisions: `docs/working-notes/decisions/custom-firmware.md` (all targets),
  `docs/working-notes/decisions/classic-esp32-firmware.md` (the first image's history)

## Layout

```
firmware/
  build.sh install.sh record-tested.sh publish.sh   shared; each takes a target, names none
  stage.py gen_deps_index.mjs manifest.py patches/  the frozen set and the MicroPython patches, same for every target
  builds.json                                       what the editor's Install firmware dialog offers
  targets/<target>/
    target.json     the target's facts: chip, family, pinned MicroPython and ESP-IDF tags, flash address, sdkconfig
    board/          mpconfigboard.h, sdkconfig.board, partitions.csv
    tested.json     every image of this target that ran on a board, keyed by sha256
  out/<target>/     build output (not committed)
```

`python3 tools/firmware_targets.py list` names the targets; `check` says whether each is complete.

| Target | Chip | MicroPython | ESP-IDF | Written at |
|---|---|---|---|---|
| `classic-esp32` | ESP32, 4 MB, no PSRAM | v1.29.0 | v5.5.2 | 0x0 |
| `esp32-c3` | ESP32-C3, 4 MB | v1.29.0 | v5.5.2 | 0x0 |
| `esp32-c5` | ESP32-C5, 4 MB, no PSRAM | v1.29.0 | v5.5.2 | 0x2000 |
| `esp32-s3` | ESP32-S3, 16 MB, Octal-SPIRAM | v1.29.0 | v5.5.2 | 0x0 |

Each target pins its own versions in `target.json`. They start equal; a target moves on its own when it has to.

## What is in an image

Everything `device-runtime/runtime_manifest.py` lists -- the runtime core, the listener, every vendored library,
every font -- frozen under its on-board module name, plus `deps_frozen.py`, the inventory Deploy uses to skip what
is frozen. `stage.py` derives the set from the manifest, so an image cannot ship a different set from the one a
stock install pushes. Stock MicroPython is otherwise unchanged (BLE included), apart from `patches/`.

Not in it: the flow, board settings, WiFi credentials. They live on the filesystem, and a flash erases them.

## Build

Needs ESP-IDF at the target's `espIdf` tag and MicroPython at its `micropython` tag. `build.sh` refuses any other
checkout.

```sh
git clone --depth 1 --branch v1.29.0 https://github.com/micropython/micropython.git ~/micropython
make -C ~/micropython/ports/esp32 submodules
. ~/esp/esp-idf/export.sh                      # ESP-IDF v5.5.2
MICROPY_DIR=~/micropython firmware/build.sh esp32-c5
```

Output in `out/<target>/`: the merged image `thingstudio-<target>-<version>-<sha>.bin`, its `.sha256`, and
`main.py` (the boot script install writes to the board). Uncommitted changes under `device-runtime/` or `firmware/`
name the image `...-dirty.bin`, which cannot be recorded or published. So commit first, build second: the image
records a commit, not a working tree.

## Install

```sh
PORT=/dev/ttyUSB0 firmware/install.sh esp32-c5                 # Linux
PORT=/dev/cu.usbserial-14420 firmware/install.sh classic-esp32  # macOS: your own port from ls /dev/cu.*
```

Needs `esptool` and `mpremote` (`pip install esptool mpremote`). It erases the filesystem partition, writes the
image at the target's address, and copies `main.py` to the board. Flashing erases flows, settings and WiFi
credentials. Read the script first: it is short.

A board without auto-reset wiring (the ESP32-C5-340X) needs BOOT held while you tap RESET before flashing, and
stays in the bootloader afterwards: `install.sh` then stops after writing the image and prints the two manual
steps (press RESET, copy `main.py` with `mpremote`, press RESET).

## At every runtime bump: rebuild every target

An image freezes the runtime, so a runtime bump makes every published image one the editor refuses or runs stale.
A bump is finished when each target has a tested image at the new version. First commit the bump itself, then for
each target:

1. Build at the bump's commit (or later), flash it, run a flow on a board of that chip.
2. Record it:

   ```sh
   firmware/record-tested.sh firmware/out/<target>/thingstudio-<target>-<version>-<sha>.bin \
       "<board>" "<what you ran and saw>"
   ```

   That writes `targets/<target>/tested.json`. Commit it.

CI warns while a target is behind (`tools/firmware_targets.py current --warn`), and the release workflow refuses a
tag until every target has a tested image at the tag's runtime version, built from a commit the tag contains.

## Publishing

The editor offers the images listed in the `builds.json` it was installed with, so the catalogue entries go into
the commit the tag points at. An image's download URL is known before the release exists.

1. Offer each image in the editor, with the URL it will have on the release:

   ```sh
   python3 tools/firmware_catalogue.py --image firmware/out/<target>/<image> \
       --url https://github.com/mkarliner/ThingStudio/releases/download/v<version>/<image>
   ```

   That adds the version to `builds.json`, creating the target's build entry from `target.json` the first time. It
   refuses an image whose hash is not in that target's `tested.json`. Commit `builds.json` with the version bump;
   `--check` (in CI) and the editor's tests hold the files together.
2. Tag the release (after the records above are committed). The Release workflow makes a draft.
3. Attach every target's image:

   ```sh
   firmware/publish.sh v<version>            # attach and verify, leaves the draft
   firmware/publish.sh v<version> --publish  # ... and publish
   ```

   It takes the newest image in each `out/<target>/` and uploads nothing unless all of them are at the tag's
   runtime version, recorded as tested, built from a commit the tag contains and match their `.sha256`. Every
   upload is read back and compared. The release notes name each image, its hash and its tested board. Needs `gh`,
   logged in. Until it runs, the catalogue's new URLs answer 404, so publish the release promptly.

## Adding a target

A target is a folder, not a code change. Copy the nearest one to `targets/<new-id>/`, then:

- `target.json`: the chip's facts. `family` is the processor definition's id (`editor/src/definitions/processors/`),
  and `chip` must equal that processor's `flash.chip`. `portSdkconfig` lists the port's own fragments, as in
  MicroPython's `ports/esp32/boards/mpconfigboard_<chip>_common.cmake` and the chip's generic board.
- `board/`: `mpconfigboard.h` (keep the stock MCU name, so the editor recognises the chip), `sdkconfig.board`
  (flash size, anything chip-specific), `partitions.csv` (a `vfs` data partition is required).
- `tested.json`: `{}`.

`python3 tools/firmware_targets.py check` says what is missing. Add the target to the table above and to the user
guide's page, whose test lists every target. From then on it is part of every runtime bump and every release.
