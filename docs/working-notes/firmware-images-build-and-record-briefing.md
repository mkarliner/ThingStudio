# Firmware images: build, flash and record on the Mac — briefing

Status: task brief, 2026-11-05. Written for a session that works on Mike's Mac (through `device_bash` or with Mike
at the keyboard) with the boards plugged in. Background: `custom-firmware-family-briefing.md` (what PR #11 built)
and `firmware/README.md` (the scripts). Decisions: `decisions/custom-firmware.md`.

## The job

Produce, flash, test and record a runtime **15.0.0** image for each of the three targets, so the rule "every image
is rebuilt at each runtime bump" is met for the first time:

| Target | Board to test on | Written at |
|---|---|---|
| `esp32-c5` | ESP32-C5-340X | 0x2000 |
| `esp32-c3` | the C3 board that reports "ESP32C3 module" (or the LuatOS ESP32C3-CORE) | 0x0 |
| `classic-esp32` | CYD (ESP32-2432S028) | 0x0 |

**Done when** each target's `firmware/targets/<id>/tested.json` has an entry for a 15.0.0 image built from a clean
commit, Mike has committed and pushed them, and `python3 tools/firmware_targets.py current` prints no lines. Then
CI stops warning, and a release tag can pass the gate.

Not this job: publishing to a release (`firmware/publish.sh`, `tools/firmware_catalogue.py --image`). That
follows once Mike tags a release (`firmware/README.md`, "Publishing").

## Before starting

1. **Where are you?** Run `uname -s`. On `Darwin` you are on the Mac: the build can run here. On `Linux` you are in
   a VM or cloud container: the toolchain, the build and the serial ports have to be the Mac's, so hand Mike every
   command to run in his Terminal and read back what he pastes.
2. **The branch.** PR #11 (`custom-firmware-family`) was open on 2026-11-05. If it is merged, use `main`. The
   repo on the Mac is `~/Src/ThingStudio` (the shared mount). Git writes there are Mike's, never the session's
   (`CLAUDE.md`, "Git writes from the agent sandbox"). Hand him:

   ```sh
   cd ~/Src/ThingStudio && rm -f .git/index.lock
   git fetch origin && git checkout custom-firmware-family && git pull --ff-only
   git status --short -- device-runtime firmware      # must print nothing
   ```

   Anything uncommitted under `device-runtime/` or `firmware/` makes the build name its image `...-dirty.bin`, which
   `record-tested.sh` refuses. Commit or stash first; don't work around it.
3. **Thingstudio holds the serial port** while a board is connected. Disconnect in the editor (or quit
   Thingstudio) before `install.sh`, and reconnect afterwards. After switching branches, restart Thingstudio and
   hard-reload the editor tab (Cmd-Shift-R), or the tab keeps its old code.

## Once: the toolchain

ESP-IDF **v5.5.2** and MicroPython **v1.29.0**, the pins in every `target.json`. The Mac may already have ESP-IDF
5.4 for the old classic pin; leave it, install 5.5.2 next to it. Nothing here touches the repo.

```sh
brew install cmake ninja dfu-util
mkdir -p ~/esp && cd ~/esp
git clone -b v5.5.2 --recursive https://github.com/espressif/esp-idf.git esp-idf-5.5.2
~/esp/esp-idf-5.5.2/install.sh esp32,esp32c3,esp32c5
git clone --depth 1 --branch v1.29.0 https://github.com/micropython/micropython.git ~/micropython-1.29.0
. ~/esp/esp-idf-5.5.2/export.sh
make -C ~/micropython-1.29.0/ports/esp32 submodules
```

The clone and install take 10-20 minutes. `build.sh` refuses a MicroPython or ESP-IDF checkout at any other tag
and says which one is wrong.

Every new shell: `. ~/esp/esp-idf-5.5.2/export.sh && cd ~/Src/ThingStudio`.

## Per target: build, flash, test, record

Do the C5 first: it is the new chip and the one with the open memory question.

```sh
MICROPY_DIR=~/micropython-1.29.0 firmware/build.sh esp32-c5      # 3-5 minutes; image in firmware/out/esp32-c5/
ls /dev/cu.*                                                     # find the board's port
PORT=/dev/cu.usbserial-XXXX firmware/install.sh esp32-c5
```

The C5-340X's CH340E can't pull BOOT: if flashing doesn't start, hold BOOT, tap RESET, release BOOT, run again.

Then, in Thingstudio:

1. Connect. The console's version line must say 15.0.0, and `[libraries] … already on the board: …` must list the
   flow's libraries (Deploy sends none).
2. Note the `[memory]` line from the fresh boot (MicroPython free/largest, ESP-IDF free/largest).
3. Deploy a flow that exercises the chip, then deploy again **over it while it runs**, twice. Note `[memory]`
   after each.
   - C5 and C3: a BLE flow (`ble scan` → `debug`, or `ble characteristic out` with nRF Connect). Stock MicroPython
     hit `MemoryError` redeploying a BLE flow on both boards: whether this image fixes that is the question to
     answer. The C3 also: try a WiFi flow alongside BLE if the C3 has room (BLE briefing open item 2).
   - Classic: the CYD theme demo (`gui-hero-cyd-theme`), as for 14.1.0 in its `tested.json` entry.
4. A failure is a finding, not something to work around: write down the console line and its figures.

Record what happened, in words worth reading on a release page:

```sh
firmware/record-tested.sh firmware/out/esp32-c5/thingstudio-esp32-c5-15.0.0-<sha>.bin \
    "ESP32-C5-340X" "install clean; HELLO 15.0.0 with every library frozen; <flow> deployed 3x over a running flow; free RAM <x>, largest IDF block <y> with the flow running"
```

Repeat for `esp32-c3` and `classic-esp32`. Then Mike commits:

```sh
cd ~/Src/ThingStudio && rm -f .git/index.lock
git add firmware/targets/*/tested.json
git commit -m "firmware: record 15.0.0 images for classic-esp32, esp32-c3, esp32-c5 as tested"
git push
python3 tools/firmware_targets.py current       # prints nothing when all three are recorded
```

## Updating the docs with what you measured

In the same change as the records (the user-guide rules in `AGENTS.md`; `python3 tools/docs_lint.py` before
committing):

- `docs/user-guide/custom-firmware.md`, "Memory and the board": add the C3 and C5 rows (fresh boot, flow running,
  after two more deploys) and drop "The C3 and C5 images are not measured yet." If redeploying over a running flow
  worked on every board, "What it changes" can go back to saying so plainly; it says "more likely to fit" until
  then.
- If the C3 has too little ESP-IDF memory for WiFi with BLE: a short `faq.md` entry with the figure.
- `firmware/README.md` and `decisions/custom-firmware.md`: nothing, unless something about the build itself
  surprised you (then a line in `learnings/firmware-builds.md`).

## If something fails

- **`build: MicroPython checkout is …` / `ESP-IDF at … is …`:** wrong checkout or `export.sh` not sourced in this
  shell.
- **`install: … does not know chip esp32c5`:** an old `esptool.py` (macOS's default is 3.x) is first on the PATH.
  Sourcing `export.sh` puts ESP-IDF's esptool 5 first; otherwise `pip install -U esptool`.
- **A C5 that boot-loops with `invalid header`** was written at 0, not 0x2000: use `install.sh`, not Thonny
  (thonny/thonny#3963).
- **`port … never opened`:** Thingstudio still has the port; disconnect in the editor.
- **A build error inside ESP-IDF or MicroPython:** all three targets built cleanly at these exact tags in a cloud
  session on 2026-11-04, so suspect the Mac's environment first (`learnings/firmware-builds.md` has the sizes to
  compare: classic 1.75 MB, C3 1.85 MB, C5 2.06 MB).

## Open items to pick up while there (from `custom-firmware-family-briefing.md`)

- After the images are published and in `builds.json`: whether `esp32-c5-340x.json` and the C3 board files take
  the Thingstudio builds as their `variant` (as the D1 R32 and CYD take the classic image). Mike's call.
- BLE connection limit: NimBLE allows 4 (`learnings/firmware-builds.md`); a line in `docs/user-guide/nodes/ble.md`.

## Environment facts

- **Repo on the Mac is the shared mount**: no `git add/commit`, no `npm ci`/`vitest`/`make` from a sandbox
  against it (`CLAUDE.md`). Read-only git is fine but can leave `.git/index.lock`, so every git sequence for Mike
  starts with `rm -f .git/index.lock`.
- **Checks that need no toolchain** and are safe from anywhere: `python3 tools/firmware_targets.py check`,
  `python3 tools/firmware_targets.py current`, `python3 tools/firmware_catalogue.py --check`,
  `python3 tools/docs_lint.py` (all standard-library Python).
- **Build output** goes to `firmware/out/<target>/` (gitignored): the image, its `.sha256`, `main.py`,
  `_deps.json`, the staged frozen set. `build.sh` also writes a `boards/thingstudio_<target>/` directory and applies
  `firmware/patches/` inside the MicroPython checkout; that is expected.
- **Board quirks**: the C5 installs at 0x2000; the C5-340X needs the BOOT/RESET dance; the C5's stock build prints
  PSRAM errors at boot, the Thingstudio image doesn't; a C3 running BLE has ~6 KB of ESP-IDF heap on stock.
- **A cloud session can build too** (not flash): the recipe is in `learnings/firmware-builds.md`, but those builds
  use GitHub copies of two registry components, so they are never the images to record.
