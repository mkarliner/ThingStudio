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

Output in `out/`: one merged image, its `.sha256`, and `_deps.json`.

## Install

```sh
PORT=/dev/ttyUSB0 firmware/classic-esp32/install.sh
```

That flashes the image at offset 0 and writes two files that stay on the filesystem:
`/main.py` (a three-line boot script importing the frozen listener) and `/lib/_deps.json` (the
library inventory, so Deploy skips what is already frozen). Flashing erases flows, settings and WiFi
credentials.

If you prefer to see the commands, they are `esptool write_flash 0x0 <image>` and two
`mpremote fs cp` lines -- read `install.sh`, it is short.

## What is verified

Only the CYD so far, and only what the five-cycle gate measured. The acceptance is the GUI gate in
the briefing, not this README. Panel drivers for ST7789, ST7796 and the FT6336U touch controller are
frozen in; an ILI9341 CYD batch needs different drivers, which this image does not carry.

Flash layout is a single 3 MB app slot (see `board/partitions.csv`); there is no OTA slot. Moving to
OTA later costs one reflash, which is how the image is installed anyway.
