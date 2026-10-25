# Step 3: Install MicroPython

Thingstudio runs on top of [MicroPython](background/micropython.md), so the board needs it first. You install it once
per board.

A new board usually doesn't have MicroPython. If yours already has it, or you're not sure, go to
[step 4](connecting.md). If MicroPython is missing, the console says so when you connect, and links back here.

## Get the firmware

Download the firmware for your board from [micropython.org/download](https://micropython.org/download/). Pick your
exact board if it's listed, or the generic build for your chip:

| Chip | Generic build | File type |
| --- | --- | --- |
| ESP32 | `ESP32_GENERIC` | `.bin` |
| ESP32-S2 | `ESP32_GENERIC_S2` | `.bin` |
| ESP32-S3 | `ESP32_GENERIC_S3` | `.bin` |
| ESP32-C3 | `ESP32_GENERIC_C3` | `.bin` |
| RP2040 (Pico, Pico W) | `RPI_PICO`, `RPI_PICO_W` | `.uf2` |
| RP2350 (Pico 2, Pico 2 W) | `RPI_PICO2`, `RPI_PICO2_W` | `.uf2` |

For any other chip, see [Other microcontrollers](#other-microcontrollers).

## Install from Thingstudio

Thingstudio writes the firmware itself: over a serial port for the ESP32 family, and onto a mounted drive for
RP2040, RP2350 and nRF52 boards.

1. Put the board in its bootloader. Hold **BOOT** and tap **RESET** on an ESP32, or hold **BOOTSEL** while you
   plug in a Pico.
2. Choose **Tools → Install firmware…**.
3. Pick **Serial port** or **Mounted drive**, then the port or drive from the list. USB ports come first, shown as
   the path and the adapter's name (for example `/dev/ttyUSB0 -- CH340`). If the board isn't there, put it in
   download mode (step 1) and click ⟳; the line under the list says how many it found. If it still isn't listed,
   type the path in the box (on macOS a mounted Pico is `/Volumes/RPI-RP2`).
4. Pick the **chip family**, then the **build** and **version**. Only the families the editor can write are listed,
   and only builds whose hash is pinned, so what you flash is what was tested. A board that names its own build is
   preselected. The build matters for the heap as much as for compatibility: an ESP32 with extra PSRAM wants the
   **PSRAM (WROVER)** build, a single-core SOLO the **single-core** one. For a classic ESP32 there is also
   **Thingstudio image**, which carries the runtime and the flow libraries frozen — flash it, then **Install
   runtime** writes only the boot script.
5. Click **Flash**. **Erase all flash first** is ticked: it clears an old partition table, which is the usual
   reason a first install "succeeds" and then doesn't boot. The dialog shows each line the tool prints; a failure
   says what to fix.

The list covers every build Thingstudio pins, so **Or use your own image file** is only for the rest: the build for
your board isn't listed, or you want an image you downloaded yourself. Pick the `.bin` or `.uf2`, and the address comes from the chip family: `0x1000` for an ESP32 or ESP32-S2,
`0` for an ESP32-S3, C3, C6 or ESP8266. A mounted drive needs no address, and the file's own header usually tells
the editor which chip it is for.

Flashing erases the flow and all settings on the board. Afterwards, [connect](connecting.md) it
and [install the runtime](installing-runtime.md).

The rest of this page is the same job without the editor.

## RP2040 and RP2350: drag and drop

Copy the firmware onto the board as a file:

1. Hold the **BOOTSEL** button while you plug the board into USB.
2. A drive called `RPI-RP2` (or `RP2350`) appears.
3. Copy the `.uf2` file onto it.

The board restarts into MicroPython by itself.

## ESP32 family: esptool

If Thingstudio is connected to the board, click **Disconnect** first. Only one program can use the board's port at
a time. If another program has it open, esptool reports `Resource busy` or `could not open port`.

Install `esptool` once:

```sh
pip install esptool
```

Erase the flash, then write the firmware. `ADDRESS` depends on the chip:

```sh
esptool.py --port PORT erase_flash
esptool.py --port PORT --baud 460800 write_flash ADDRESS firmware.bin
```

| Chip | `ADDRESS` |
| --- | --- |
| ESP32, ESP32-S2 | `0x1000` |
| ESP32-S3, ESP32-C3 | `0` |

`PORT` is the board's serial port. On macOS and Linux it starts with `/dev/`, on Windows it's `COM` followed by a
number. To find it, run `esptool.py flash_id` with no `--port`: esptool searches for the board and prints the port
it found.

If esptool can't talk to the board, put it into download mode and try again: hold **BOOT**, press and release
**RESET**, then release **BOOT**. Boards with a separate USB-serial chip usually do this by themselves. If writing
fails partway, leave out `--baud 460800`.

Press **RESET** when it finishes. A board that uses the chip's own USB (most ESP32-S2 and S3 boards) may show up on
a different port afterwards.

## Without a terminal: Thonny

[Thonny](https://thonny.org) installs MicroPython on the board through a GUI. Open
**Tools → Options → Interpreter** and use **Install or update MicroPython**.

When it's done, close Thonny. Like esptool, it needs the board's port to itself.

## Other microcontrollers

Other chips, such as STM32, nRF or SAMD, each have their own way of installing MicroPython. See your board's page
on [micropython.org/download](https://micropython.org/download/) and the
[MicroPython documentation](https://docs.micropython.org/en/latest/).

[Supported hardware](supported-hardware.md) lists the chips Thingstudio is tested on. Another chip needs a
processor definition: see [Other boards](supported-hardware.md#other-boards).

## Next

Step 4: [connect your board](connecting.md) to Thingstudio.
