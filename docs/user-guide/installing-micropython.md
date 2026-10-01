# Step 2: Install MicroPython

Thingstudio runs on top of [MicroPython](background/micropython.md), a version of Python for microcontrollers. Your
board needs MicroPython before Thingstudio can use it. You install it once.

A new board usually doesn't have MicroPython. If you know yours does, go to [step 3](connecting.md). If you're not
sure, go to step 3 anyway: Thingstudio tells you if MicroPython is missing, and links back here.

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

## RP2040 and RP2350: drag and drop

1. Hold the **BOOTSEL** button while you plug the board into USB.
2. A drive called `RPI-RP2` (or `RP2350`) appears.
3. Copy the `.uf2` file onto it.

The board restarts into MicroPython on its own.

## ESP32 family: esptool

If Thingstudio is connected to the board, click **Disconnect** first. Only one program can use the board's port at
a time. If another program has it open, esptool reports `Resource busy` or `could not open port`.

Install `esptool` once:

```sh
pip install esptool
```

Put the board into download mode. Hold **BOOT**, press and release **RESET**, then release **BOOT**. Many boards
with a separate USB-serial chip do this for you, so try without it first.

Erase the flash, then write the firmware. The address depends on the chip:

```sh
esptool.py --port PORT erase_flash
esptool.py --port PORT --baud 460800 write_flash ADDRESS firmware.bin
```

| Chip | `ADDRESS` |
| --- | --- |
| ESP32, ESP32-S2 | `0x1000` |
| ESP32-S3, ESP32-C3 | `0` |

`PORT` is the board's serial port. Names vary by operating system and board: on macOS and Linux they start with
`/dev/`, on Windows they're `COM` followed by a number. To find yours, run `esptool.py flash_id` with no `--port`;
esptool searches for the board and prints the port it found. If writing fails partway, leave out `--baud 460800`.

Press **RESET** when it finishes. Boards that use the chip's own USB (most ESP32-S2 and S3 boards) may show up on a
different port afterwards.

## Without a terminal: Thonny

[Thonny](https://thonny.org) is a free Python editor for beginners. It works with MicroPython boards, and can
install MicroPython for you. Open **Tools → Options → Interpreter** and use **Install or update MicroPython**.

When it's done, close Thonny. Like esptool, it needs the board's port to itself.

## Other microcontrollers

Other chips, such as STM32, have their own way of installing MicroPython. See your board's page on
[micropython.org/download](https://micropython.org/download/) and the
[MicroPython documentation](https://docs.micropython.org/en/latest/).

Thingstudio is built and tested on the ESP32 and RP2 chips above. To try another chip, you'll need to
[add a processor definition](boards.md#adding-a-processor).

## Next

Step 3: [connect your board](connecting.md) to Thingstudio.
