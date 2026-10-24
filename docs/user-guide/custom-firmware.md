# Custom firmware for classic ESP32

A MicroPython image with Thingstudio's runtime and every flow library built in, for classic ESP32 boards with no
PSRAM. It is what lets those boards run a GUI flow: stock MicroPython runs out of memory loading the display stack.

The image is optional. Stock MicroPython and the [runtime install](installing-runtime.md) work as usual, and nothing
in the editor changes. Use it when a flow on a 4 MB ESP32 stops with `MemoryError` and the steps in
[MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load) have not helped —
this is the third of them, "run a firmware image with the libraries built in".

The technique is not specific to this image or to this chip: freezing the runtime and the flow libraries into
MicroPython works on any board. This image exists because a classic ESP32 is the board where it changes the most,
and because building one needs an ESP-IDF toolchain. `firmware/classic-esp32/` in the repository is a working
example to copy for another board.

## What it changes

The runtime and the flow libraries are frozen into the firmware, which means MicroPython runs them from flash instead
of copying them into RAM. On a classic ESP32 that is the difference between a GUI flow starting and failing with
`MemoryError allocating 13317 bytes`.

Because the libraries are already there, Deploy does not send them. The console says so after connecting:

```
[libraries] this flow uses font_body12, … st7796py -- already on the board: font_body12, … st7796py
```

Two things follow from that, and both matter on a board with this little RAM:

- Deploying over a running GUI flow works. On stock MicroPython it fails: the runtime and the flow fight over the
  same memory.
- The first deploy after flashing has more memory to work with than any later one, because the board is not drawing
  yet. Judge a flow by a deploy over another flow, not by the first one.

The image carries no board-specific settings. Pins and the display come from the [board definition](boards.md), so
one image serves any classic ESP32 board. It is tested on the CYD.

## What you need

You need these:

- A classic ESP32 board with 4 MB of flash and no PSRAM (ESP32-D0WD and similar). This image is not for the S2, S3,
  C3 or C6, and not for RP2040 or RP2350 boards.
- A USB cable that carries data.
- `esptool` and `mpremote` on the computer: `pip install esptool mpremote`.
- Four downloads from the project's [releases page](https://github.com/mkarliner/ThingStudio/releases/latest): the image, its `.sha256` file, `_deps.json` and `main.py`.

## Install

Flashing erases the board: its saved flows, board settings and WiFi credentials are gone afterwards.

1. Download the four files from the [releases page](https://github.com/mkarliner/ThingStudio/releases/latest): the image, its `.sha256`, `_deps.json` and `main.py`. Put them
   in one folder and go there. Check the image against its checksum:

   ```sh
   IMAGE=thingstudio-classic-esp32-13.1.0-dad343f.bin
   shasum -a 256 -c "$IMAGE.sha256"      # sha256sum -c on Linux
   ```

2. Put the board in download mode if your board needs it, then write the image at address 0:

   ```sh
   esptool.py --chip esp32 --port /dev/ttyUSB0 write_flash 0x0 "$IMAGE"
   ```

   On macOS the port looks like `/dev/cu.usbserial-14420`. On Windows it is `COM3` or similar.

3. Write the files that live on the filesystem, not in the image:

   ```sh
   mpremote connect /dev/ttyUSB0 fs cp main.py :/main.py
   mpremote connect /dev/ttyUSB0 fs mkdir :/lib
   mpremote connect /dev/ttyUSB0 fs cp _deps.json :/lib/_deps.json
   ```

   `main.py` is the boot script: it starts the runtime that is frozen into the firmware. A board with the image and
   no `main.py` starts at the Python prompt instead.

   `_deps.json` is the list of libraries the board has, so Deploy skips them. Without it Deploy sends its own copies,
   which works but uses the memory the image was meant to save.

4. Reset the board. It starts the listener and prints `LISTENER_READY`.

The repository also has `firmware/classic-esp32/install.sh`, which runs these steps in one command. Read it before
running it: it erases the filesystem partition, and its port name comes from `PORT`.

## Connect and deploy

Connect in the editor as usual. Two things confirm the image is running:

- the console's version line reports runtime 12.1.0 or later
- `[libraries] … already on the board: …` names every library the flow imports

Then deploy the flow. A GUI flow that failed with `MemoryError` on stock MicroPython should run.

## Memory and the board

The image does not add RAM. A classic ESP32 has about 140 KB free for flows with this image and nothing running, and
a GUI flow takes most of what it has. Measured on the CYD (ESP32-D0WD, 4 MB, no PSRAM), in KB:

| Board state | MicroPython free | Largest block | ESP-IDF free | ESP-IDF largest |
|---|---|---|---|---|
| Just booted, no flow | 142 | 105 | 129 | 108 |
| GUI flow running | 108 | 50 | 70 | 52 |
| GUI flow running, after two more deploys | 120 | 27 | 18 | 14 |

Read the third row before leaning on deploys: each deploy over a running flow leaves the heaps more fragmented, and
the chip's own heap shrinks as MicroPython takes from it. A GUI flow still starts (a 9.5 KB flow needs far less than
the 27 KB block), but WiFi draws from that shrinking chip heap, and the console warns when it is low.

Two habits avoid the limits that remain:

- Keep frames small. The gui screen node sends a frame in strips for exactly this reason; a `function` node that
  builds a whole frame as one buffer still needs that buffer to be contiguous.
- When a deploy fails with `MemoryError`, the console says how much memory the board had. If the board cannot make
  room, [remove the flow and power cycle](debugging.md#memoryerror-or-a-library-that-wont-load) before deploying
  again. A soft restart does not help: it reuses the same heap. A power cycle also returns the chip heap that
  repeated deploys take.

## Back to stock MicroPython

Flash a standard MicroPython build for the board, then [install the runtime](installing-runtime.md) again. The stock
flow of [Installing MicroPython](installing-micropython.md) to [Install the runtime](installing-runtime.md) covers
both steps. Flashing erases the board's flows and settings, as above.

## Reporting a problem

Reports on any classic ESP32 board are welcome, listed or not. Include the board's name and the console's version and
`[memory]` lines from a fresh boot.
