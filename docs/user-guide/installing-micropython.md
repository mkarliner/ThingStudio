# Installing MicroPython

Thingstudio runs on top of MicroPython. Your board needs MicroPython before Thingstudio can install its runtime on it.

If your board already has MicroPython, skip this page and go to [Getting started](getting-started.md).

## Is MicroPython already installed?

A new board usually ships with something else on it, or nothing at all. To check, install Thingstudio and
[connect the board](getting-started.md#connect-a-board). The console then says one of these:

- **"The board has MicroPython but not the Thingstudio runtime."** MicroPython is installed. Skip this page and
  [install the runtime](getting-started.md#install-the-runtime).
- **"Nothing came back at all."** or **"The board replied, but not as MicroPython."** Install MicroPython, below.
- **"This board is running CircuitPython."** Install MicroPython in its place, below.

## Before you install MicroPython

Click **Disconnect** in Thingstudio, and close any other program using the board, such as a serial monitor or the Arduino IDE. Only one program can use the port at a time. If Thingstudio still has it open, esptool and Thonny can't reach the board. esptool reports this as `Resource busy` or `could not open port`.

## Get the firmware

Download the firmware for your board from [micropython.org/download](https://micropython.org/download/). Pick your exact board if it's listed, or the generic build for your chip:

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

Install `esptool` once:

```sh
pip install esptool
```

Put the board into download mode. Hold **BOOT**, press and release **RESET**, then release **BOOT**. Many boards with a separate USB-serial chip do this for you, so try without it first.

Erase the flash, then write the firmware. The address depends on the chip:

```sh
esptool.py --port PORT erase_flash
esptool.py --port PORT --baud 460800 write_flash ADDRESS firmware.bin
```

| Chip | `ADDRESS` |
| --- | --- |
| ESP32, ESP32-S2 | `0x1000` |
| ESP32-S3, ESP32-C3 | `0` |

`PORT` is the board's serial port. Names vary by operating system and board: on macOS and Linux they start with `/dev/`, on Windows they're `COM` followed by a number. To find yours, run `esptool.py flash_id` with no `--port`; esptool searches for the board and prints the port it found. If writing fails partway, leave out `--baud 460800`.

Press **RESET** when it finishes. Boards that use the chip's own USB (most ESP32-S2 and S3 boards) may show up on a different port afterwards. Click **⟳**, next to the port list in Thingstudio, to refresh the list.

## Without a terminal

[Thonny](https://thonny.org) can install MicroPython for you. Open **Tools → Options → Interpreter** and use **Install or update MicroPython**.

When it's done, close Thonny before connecting from Thingstudio. The same one-program rule applies in both directions.

## Next

Install the Thingstudio runtime on the board: see [Install the runtime](getting-started.md#install-the-runtime).
If you haven't installed Thingstudio on your computer yet, start at [Install](getting-started.md#install).
