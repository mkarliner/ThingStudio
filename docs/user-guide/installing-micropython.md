# Step 3: Install MicroPython

Thingstudio runs on top of [MicroPython](background/micropython.md), so the board needs it first. You install it once
per board.

A new board usually doesn't have MicroPython. If yours already has it, or you're not sure, go to
[step 4](connecting.md). If MicroPython is missing, the console says so when you connect, and links back here.

Thingstudio can install it for you, on the chips it can write.

## Install from Thingstudio

Thingstudio writes the firmware itself: over a serial port for the ESP32 family, and onto a mounted drive for
RP2040, RP2350 and nRF52 boards.

!!! tip "ESP32 without PSRAM? Use a custom image"
    ESP32 boards without PSRAM can be very tight on memory, as the ESP32's WiFi stack and FreeRTOS take quite a
    bit of RAM. We strongly suggest that you flash these boards with one of our
    [custom MicroPython images](custom-firmware.md). They include the runtime and the common libraries, and so
    release significant memory for your flow.

On a classic ESP32 with 4 MB of flash and no PSRAM, an ESP32-C3 or an ESP32-C5, pick
**Thingstudio custom image** as the **Firmware** when the dialog lists one for the chip. Its **Version** list holds
the published releases.
After flashing it, **Install runtime** writes only the boot script.

The list of builds comes from docs.thingstudio.net, so a new image appears without updating Thingstudio. Thingstudio
uses that list only when it carries Thingstudio's signature; offline, it uses the last list it saved, or the one it
was installed with. The line under **Version** says which.

1. Plug the board into USB. A Pico needs **BOOTSEL** held while you plug it in.
2. Choose **Tools → Install firmware…**.
3. Pick **Serial port** or **Mounted drive**, then the port or drive from the list. USB ports come first, shown as
   the path and the adapter's name (for example `/dev/ttyUSB0 -- CH340`). If an ESP32 isn't listed, hold **BOOT**,
   tap **RESET** and click ⟳; the line under the list says how many it found. If it still isn't listed, type the
   path in the box (on macOS a mounted Pico is `/Volumes/RPI-RP2`).
4. Pick the **Chip family**, the **Firmware** (**Official MicroPython (micropython.org)** or **Thingstudio custom
   image**), the **Build** and the **Version**. A board that names its own build is preselected.
5. Click **Flash**. **Erase all flash first** is ticked: it clears an old partition table, which is the usual
   reason a board doesn't boot after a successful install. The dialog shows each line the tool prints; a failure
   says what to fix.

The **Build** matters for the heap as much as for compatibility: an ESP32 with extra PSRAM wants
**ESP32 with PSRAM (WROVER / SPIRAM)**, and a single-core SOLO wants **ESP32 single-core (SOLO / UNICORE)**. Only the
chip families the editor can write are listed, and only builds whose hash is pinned, so what you flash is what was
tested.

The list covers every build Thingstudio pins, so **Or use your own image file** is only for the rest: a build for a
board Thingstudio doesn't list, a chip with no pinned build yet (the ESP32-C5), or an image you downloaded yourself. Pick the `.bin` or `.uf2`; the chip family you
choose decides the address, and the file's own header usually decides the family. **Address**, under **Install
options**, overrides the family's address. A Thingstudio custom image for a classic ESP32 needs `0x0` there: see
[Custom firmware](custom-firmware.md#install-by-hand).

Flashing erases the flow and all settings on the board. Afterwards, [connect](connecting.md) it
and [install the runtime](installing-runtime.md).

## Doing it yourself

For a chip Thingstudio can't write, or a build it doesn't pin, install MicroPython without the editor.

### Get the firmware

Download the firmware for your board from [micropython.org/download](https://micropython.org/download/). Pick your
exact board if it's listed, or the generic build for your chip:

| Chip | Generic build | File type |
| --- | --- | --- |
| ESP32 | `ESP32_GENERIC` | `.bin` |
| ESP32-S2 | `ESP32_GENERIC_S2` | `.bin` |
| ESP32-S3 | `ESP32_GENERIC_S3` | `.bin` |
| ESP32-C3 | `ESP32_GENERIC_C3` | `.bin` |
| ESP32-C5 | `ESP32_GENERIC_C5` | `.bin` |
| RP2040 (Pico, Pico W) | `RPI_PICO`, `RPI_PICO_W` | `.uf2` |
| RP2350 (Pico 2, Pico 2 W) | `RPI_PICO2`, `RPI_PICO2_W` | `.uf2` |

For any other chip, see [Other microcontrollers](#other-microcontrollers).

### RP2040 and RP2350: drag and drop

Copy the firmware onto the board as a file:

1. Hold the **BOOTSEL** button while you plug the board into USB.
2. A drive called `RPI-RP2` (or `RP2350`) appears.
3. Copy the `.uf2` file onto it.

The board restarts into MicroPython by itself.

### ESP32 family: esptool

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
| ESP32-C5 | `0x2000` |

`PORT` is the board's serial port. On macOS and Linux it starts with `/dev/`, on Windows it's `COM` followed by a
number. To find it, run `esptool.py flash_id` with no `--port`: esptool searches for the board and prints the port
it found.

If esptool can't talk to the board, put it into download mode and try again: hold **BOOT**, press and release
**RESET**, then release **BOOT**. Boards with a separate USB-serial chip usually do this by themselves. If writing
fails partway, leave out `--baud 460800`.

Press **RESET** when it finishes. A board that uses the chip's own USB (most ESP32-S2 and S3 boards) may show up on
a different port afterwards.

### Without a terminal: Thonny

[Thonny](https://thonny.org) installs MicroPython on the board through a GUI. Open
**Tools → Options → Interpreter** and use **Install or update MicroPython**.

When it's done, close Thonny. Like esptool, it needs the board's port to itself.

Thonny can't install MicroPython on an ESP32-C5. It writes the image at `0`, but a C5 needs `0x2000`, and Thonny
doesn't offer that address. The board then restarts in a loop printing `invalid header`. Use Thingstudio or
esptool instead. ([Thonny issue #3963](https://github.com/thonny/thonny/issues/3963))

### Other microcontrollers

Other chips, such as STM32, nRF or SAMD, each have their own way of installing MicroPython. See your board's page
on [micropython.org/download](https://micropython.org/download/) and the
[MicroPython documentation](https://docs.micropython.org/en/latest/).

[Supported hardware](supported-hardware.md) lists the chips Thingstudio is tested on. Another chip needs a
processor definition: see [Other boards](supported-hardware.md#other-boards).

## Next

Step 4: [connect your board](connecting.md) to Thingstudio.
