# Custom firmware

A Thingstudio custom image is MicroPython with Thingstudio's runtime and every flow library built in. Stock
MicroPython loads the runtime, the libraries and the flow into RAM. With a custom image, the runtime and libraries
run from flash instead, which leaves the RAM for the flow. On a small board, that is the difference between a flow
starting and failing with `MemoryError`.

There is one image per chip:

| Chip | Image | Written at |
|---|---|---|
| classic ESP32, 4 MB, no PSRAM | `thingstudio-classic-esp32-…bin` | 0x0 |
| ESP32-C3, 4 MB | `thingstudio-esp32-c3-…bin` | 0x0 |
| ESP32-C5, 4 MB, no PSRAM | `thingstudio-esp32-c5-…bin` | 0x2000 |

On stock MicroPython, flows that fit in memory run as usual. [Back to stock MicroPython](#back-to-stock-micropython)
says how to return to it.

The technique works on any board that runs MicroPython: freeze the runtime and the flow libraries into the
firmware. `firmware/` in the repository builds these images, and its README says how to add a chip.

## What it changes

The runtime and the flow libraries are frozen into the firmware, so MicroPython runs them from flash instead of
copying them into RAM.

Because the libraries are already there, Deploy does not send them. The console says so after connecting:

```
[libraries] this flow uses font_body12, … st7796py -- already on the board: font_body12, … st7796py
```

Two things follow from that:

- Deploying over a running flow is more likely to fit. On stock MicroPython, the runtime, the libraries and the
  flow fight over the same memory.
- The first deploy after flashing has more memory to work with than any later one. Judge a flow by a deploy over
  another flow, not by the first one.

The image carries no board-specific settings. Pins and displays come from the [board definition](boards.md), so
one image serves any board with that chip.

Each image is rebuilt and tested on a board at every runtime version. The runtime version an image carries is its
**Version** in the Install firmware dialog.

## What you need

- A board with one of the chips in the table above. The S2, S3 and C6 have no custom image, and neither do RP2040
  or RP2350 boards.
- A USB cable that carries data.

## Install from the editor

Flashing erases the board: its saved flow and all settings are gone afterwards.

1. Put the board in download mode if it needs it: hold **BOOT** and tap **RESET**.
2. Choose **Tools → Install firmware…**, pick **Serial port**, then the board's port.
3. Set **Chip family** to the board's chip and **Firmware** to **Thingstudio custom image**. If there is no
   **Thingstudio custom image** for the chip, no image for it has been published yet: use official MicroPython.
4. Pick a **Version**. Each version listed ran on a board before it was published, and the editor checks the
   download against its recorded SHA-256 before writing it.
5. Click **Flash**. The editor writes the image at the address in the table above.
6. [Connect](connecting.md), then choose **Tools → Install runtime…**. It writes only the boot script, `main.py`:
   the runtime is already in the image.

## Install by hand

You need `esptool` and `mpremote` on the computer: `pip install esptool mpremote`.

Each image is attached to the Thingstudio release it was published with. On the
[releases page](https://github.com/mkarliner/ThingStudio/releases), open the release whose assets include the image
version you want (the versions are the ones the editor lists), and download three files from it: the image for your
chip, its `.sha256` file and `main.py`.

1. Put the three files in one folder and go there. Check the image against its checksum:

   ```sh
   IMAGE=$(ls thingstudio-*.bin)   # the image you downloaded
   shasum -a 256 -c "$IMAGE.sha256"      # sha256sum -c on Linux
   ```

2. Put the board in download mode if your board needs it, then write the image. Use the chip and address from the
   table above. For a classic ESP32:

   ```sh
   esptool.py --chip esp32 --port /dev/ttyUSB0 write_flash 0x0 "$IMAGE"
   ```

   For an ESP32-C5, `--chip esp32c5` and `0x2000`. Written at 0, a C5 does not boot. On macOS the port looks like
   `/dev/cu.usbserial-14420`. On Windows it is `COM3` or similar.

3. If you held **BOOT** to get into download mode, press **RESET** now: without it the board stays in its
   bootloader, and `mpremote` fails with `could not enter raw repl`. Then write the boot script, the one file that
   lives on the filesystem rather than in the image:

   ```sh
   mpremote connect /dev/ttyUSB0 fs cp main.py :/main.py
   ```

   `main.py` starts the runtime that is frozen into the firmware. A board with the image and no `main.py` starts at
   the Python prompt instead. The image carries the list of libraries it froze, so Deploy skips them without a file
   on the board.

4. Reset the board. It starts the listener and prints `LISTENER_READY`.

The repository also has `firmware/install.sh`, which runs these steps in one command
(`PORT=/dev/ttyUSB0 firmware/install.sh esp32-c5`). Read it before running it: it erases the filesystem partition,
and its port name comes from `PORT`.

## Connect and deploy

Connect in the editor as usual. Two things confirm the image is running:

- the console's version line reports the image's runtime version, as listed under **Version** in the Install
  firmware dialog
- `[libraries] … already on the board: …` names every library the flow imports

Then deploy the flow.

## Memory and the board

The image does not add RAM. Measured on the CYD (classic ESP32-D0WD, 4 MB, no PSRAM) with a GUI flow, in KB:

| Board state | MicroPython free | Largest block | ESP-IDF free | ESP-IDF largest |
|---|---|---|---|---|
| Just booted, no flow | 142 | 105 | 129 | 108 |
| GUI flow running | 108 | 50 | 70 | 52 |
| GUI flow running, after two more deploys | 120 | 27 | 18 | 14 |

Read the third row before leaning on deploys: each deploy over a running flow leaves the heaps more fragmented, and
the chip's own heap shrinks as MicroPython takes from it. WiFi and Bluetooth draw from that chip heap, and the
console warns when it is low.

The C3 and C5, measured with an MQTT flow running over WiFi, after deploying it over itself, in KB:

| Board | MicroPython free | ESP-IDF free | ESP-IDF largest |
|---|---|---|---|
| ESP32-C3 module | 114 | 36 | 28 |
| ESP32-C5-340X | 94 | 29 | 17 |

Keeping frames small and recovering from a `MemoryError` are covered in [Memory](debugging.md#memory) and
[MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load).

## Back to stock MicroPython

[Install MicroPython](installing-micropython.md) with a standard build for the board, then
[install the runtime](installing-runtime.md) again. Flashing erases the board's flows and settings, as above.

## Reporting a problem

Reports on any board with these chips are welcome, listed or not. Include the board's name and the console's
version and `[memory]` lines from a fresh boot.
