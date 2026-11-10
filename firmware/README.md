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
  bench.py                                          flash, check and record every target's CI image
  stage.py gen_deps_index.mjs manifest.py patches/  the frozen set and the MicroPython patches, same for every target
  builds.json                                       what the editor's Install firmware dialog offers
  targets/<target>/
    target.json     the target's facts: chip, family, pinned MicroPython and ESP-IDF tags, flash address, sdkconfig
    bench.json      the board the bench tests it on, the flow it deploys, and any flashing hint
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

Each target pins its own versions in `target.json`. They start equal; a target moves on its own when it has to.

## What is in an image

Everything `device-runtime/runtime_manifest.py` lists -- the runtime core, the listener, every vendored library,
every font -- frozen under its on-board module name, plus `deps_frozen.py`, the inventory Deploy uses to skip what
is frozen. `stage.py` derives the set from the manifest, so an image cannot ship a different set from the one a
stock install pushes. Stock MicroPython is otherwise unchanged (BLE included), apart from `patches/`.

Not in it: the flow, board settings, WiFi credentials. They live on the filesystem, and a flash erases them.

## Build

**In CI (the usual route, from 2026-11-10):** the `Firmware images` workflow (`.github/workflows/firmware-images.yml`)
builds every target in Espressif's ESP-IDF container on each push to `main` that changes `device-runtime/`,
`firmware/` or `tools/firmware_targets.py`, and on demand from the Actions tab. Each target's image, `.sha256` and
`main.py` are a run artifact named `firmware-<target>-<commit>`, kept 90 days:

```sh
gh run download --name firmware-esp32-c5-$(git rev-parse HEAD) --dir firmware/out/esp32-c5
```

Built from a clean checkout, so never `-dirty`. Install, test and record them as below.

**On your own machine:** needs ESP-IDF at the target's `espIdf` tag and MicroPython at its `micropython` tag. `build.sh` refuses any other
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
A bump is finished when each target has a tested image at the new version.

**The bench (the usual route, from 2026-11-10).** Commit and push the bump; CI builds the images (Build, above).
Then, with ThingStudio closed and the boards to hand:

```sh
python3 firmware/bench.py                        # every target; or name some: firmware/bench.py esp32-c5
python3 firmware/bench.py --catalogue v0.12.0    # ... and add the images to builds.json for that release, signed
```

For each target it fetches CI's image for `HEAD`, asks for the board named in `targets/<target>/bench.json`, finds
its port, flashes it with `install.sh`, checks HELLO (runtime version, every frozen library at its hash), deploys
`bench.json`'s flow three times over itself, and shows the note it would record with the memory figures. Answer `y`
and it runs `record-tested.sh`. It ends with the `git` lines to commit the records. A failed check stops that target
and records nothing.

Needs `gh` (logged in), `esptool`, `mpremote`, `pyserial`, `node` and `editor/dist-cli` (`cd editor && npm run
build:cli`). It builds a native `mpy-cross` at the target's MicroPython tag into `~/.cache/thingstudio/` the first
time (a C compiler: `xcode-select --install` on a Mac), unless `THINGSTUDIO_MPY_CROSS` names one. Images you built
yourself: `--images-from firmware/out`.

**By hand.** First commit the bump itself, then for each target:

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

The editor offers the images in the newest catalogue it trusts: the signed `builds.json` on the docs site
(`docs.thingstudio.net/catalogue/`), the last one it saved from there, or the one it was installed with. So the
catalogue entries go into the commit the tag points at (an install made from that release lists them even offline),
and signing the catalogue publishes them to every install that can reach the site. An image's download URL is known
before the release exists.

1. Offer each image in the editor, with the URL it will have on the release:

   ```sh
   python3 tools/firmware_catalogue.py --image firmware/out/<target>/<image> \
       --url https://github.com/mkarliner/ThingStudio/releases/download/v<version>/<image>
   ```

   That adds the version to `builds.json`, creating the target's build entry from `target.json` the first time. It
   refuses an image whose hash is not in that target's `tested.json`. Then sign the catalogue (it raises its serial,
   so installs that already saw an older one take this one):

   ```sh
   python3 tools/catalogue_sign.py sign        # asks for the key's passphrase
   ```

   Commit `builds.json` and `builds.json.sig` with the version bump; `--check` and `catalogue_sign.py verify` (both
   in CI) and the editor's tests hold the files together. The Docs workflow publishes the catalogue only when its
   signature verifies.
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

## Signing keys (once)

Installs trust the docs site's catalogue only when a key in `firmware/catalogue-keys.json` signed it
(`decisions/firmware-catalogue.md`, 2026-11-06). Make two keys, on the machine that builds the images:

```sh
python3 tools/catalogue_sign.py keygen main    # the key you sign with
python3 tools/catalogue_sign.py keygen spare   # kept offline, used only if main is lost or leaked
```

Each private key goes to `~/.thingstudio-signing/`, encrypted with the passphrase you give. Copy the spare's file
and passphrase somewhere offline (a password manager), then delete it from the machine. Commit
`catalogue-keys.json`: installs from the next release on carry both public keys. If `main` is lost or leaked, sign
with `--key-id spare`, make a new spare, and ship it in the next release. The tool needs `cryptography`
(`pip install cryptography`, or the backend's own environment).

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
