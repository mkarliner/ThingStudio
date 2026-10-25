# Custom image for classic ESP32

A MicroPython firmware image with Thingstudio's runtime and every flow library frozen in. Frozen
modules are read from flash instead of loaded into RAM, which is what lets a 4 MB, no-PSRAM classic
ESP32 run a GUI flow that runs out of memory on stock MicroPython.

One image, any classic ESP32 board: board pins come from the board descriptor in the editor, not
from the firmware. The CYD is the board it is verified on.

- Scope and open work: `docs/working-notes/classic-esp32-firmware-briefing.md`
- Why it is built this way: `docs/working-notes/decisions/classic-esp32-firmware.md`

## What is in it

Everything `device-runtime/runtime_manifest.py` lists -- the runtime core, the listener, every
vendored library, every font -- frozen under its on-board module name. `stage.py` derives the list
from that manifest, so the image cannot ship a different set from the one a stock install would push.

Stock MicroPython is otherwise unchanged: same drivers, same filesystem, BLE included.

Not in it: the flow, board settings, WiFi credentials. Those live on the filesystem and a flash
erases them.

## Build

Needs ESP-IDF and the Xtensa toolchain, so a developer machine or
`.github/workflows/firmware.yml` (which builds in the `espressif/idf` container).

```sh
git clone --depth 1 --branch v1.28.0 https://github.com/micropython/micropython.git ~/micropython
make -C ~/micropython/ports/esp32 submodules
MICROPY_DIR=~/micropython firmware/classic-esp32/build.sh
```

Output in `out/`: one merged image, its `.sha256`, `main.py` (the boot script written to the board) and
`_deps.json` (the inventory, frozen into the image as `deps_frozen.py`).

## Install

```sh
PORT=/dev/ttyUSB0 firmware/classic-esp32/install.sh        # Linux
PORT=/dev/cu.usbserial-14420 firmware/classic-esp32/install.sh   # macOS: your own port from ls /dev/cu.*
```

Needs `esptool` (3.x installs it as `esptool.py`, 5.x as `esptool`; the script uses either) and
`mpremote` (`pip install esptool mpremote`). `mpremote` pulls in `pyserial` for itself; the script
does not need it in the system Python.

That flashes the image at offset 0 and writes one file that stays on the filesystem: `/main.py`, the
three-line boot script that imports the frozen listener. The library inventory is frozen into the
image (`deps_frozen.py`), so Deploy skips the frozen libraries without a file on the board; a
`/lib/_deps.json` that Deploy later writes still wins over it. Flashing erases flows, settings and
WiFi credentials.

If you prefer to see the commands, they are `esptool.py write_flash 0x0 <image>` and two
`mpremote fs cp` lines -- read `install.sh`, it is short.

## Publishing an image

The image is built here and attached to a release by hand, and the publishing steps are scripted so only a tested
image can go out (`docs/working-notes/decisions/classic-esp32-firmware.md`).

1. Build (`build.sh`, above) and flash it to a board. Run a flow on it.
2. Record that it worked:

   ```sh
   firmware/classic-esp32/record-tested.sh out/thingstudio-classic-esp32-<version>-<sha>.bin \
       "CYD (ESP32-2432S028)" "what you ran and saw"
   ```

   That writes `tested.json`, keyed by the image's sha256. Commit it.
3. Attach it to the release the tag created:

   ```sh
   firmware/classic-esp32/publish.sh v<version>            # attach and verify, leaves the draft
   firmware/classic-esp32/publish.sh v<version> --publish  # ... and publish
   ```

`publish.sh` refuses an image that is not in `tested.json`, one built from a commit the tag does not contain, one
whose `.sha256` disagrees, a release that is not a draft, and any upload that does not read back with the same hash.
It also writes the image's name, hash, tested board and date into the release notes. Needs `gh`, logged in.

The user guide names the tested image file, and `editor/test/firmware-assets.test.ts` fails the build if the page
names one that is not in `tested.json` -- so publishing a new image means updating that line, and the test says so.

## What is verified

Only the CYD so far: the image builds and boots on its own, `HELLO` lists every frozen library, a GUI
flow runs where stock MicroPython hit `MemoryError`, and Deploy skips the frozen libraries. What is
**not** verified: deploying one GUI flow over another on this board. That is a board limit, not a
firmware one — a running display flow leaves the split heap without a block big enough for the next
flow, so the answer is `Tools → Remove flow…`, power cycle, deploy
(`docs/user-guide/debugging.md`). Panel drivers for ST7789, ST7796 and the FT6336U touch controller
are frozen in; an ILI9341 CYD batch needs different drivers, which this image does not carry.

Flash layout is a single 3 MB app slot (see `board/partitions.csv`); there is no OTA slot. Moving to
OTA later costs one reflash, which is how the image is installed anyway.
