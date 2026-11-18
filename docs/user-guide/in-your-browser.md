# Use it in your browser

ThingStudio Web runs entirely in your browser, at [web.thingstudio.net](https://web.thingstudio.net/). There's
nothing to install. In Chrome or Edge on a desktop computer, the page reaches your board over its USB cable. It can
set up a blank board, deploy flows and show the board's output.

In other browsers, and on phones, the page can't reach a board. You can still build a flow, compile it and read the
MicroPython it makes.

You need a board with one of the processors in [Supported hardware](supported-hardware.md), and a USB cable that
carries data, not only power.

## Set up a board

The [Set up a board](https://web.thingstudio.net/setup) page puts MicroPython and the ThingStudio runtime on a
board.
Writing a new image erases everything on the board.

**ESP32 family:**

1. Plug the board in, click **Connect** and pick its port. The page names the chip it found.
2. Pick an image. ThingStudio's own image is listed first when there is one for the chip. Tick the box and click
   **Write it**.
3. Click **Install runtime** and pick the port again.

**Raspberry Pi Pico, or nRF52:**

1. Pick your board and click **Download the file**.
2. Hold the board's BOOTSEL button while you plug it in (double-tap reset on an nRF52). A drive appears.
3. Drag the file onto the drive. The board restarts by itself.
4. Click **Install runtime** and pick the board's port.

A board that already runs MicroPython needs only **Install runtime**.

## Use the editor

Click **Connect** and pick the board's port. The console names the board's LED pins, if its definition has any.
Then build a flow, or open one from **Examples**, and click **Compile → Deploy**.

**Tools** has the same board jobs as ThingStudio App: Check status, Board settings, Install runtime and Remove
flow. **Install firmware…** opens Set up a board.

## What stays on your computer

- **Flows** are saved as files you choose, with **File → Save As…**, and opened with **File → Open…**.
- **WiFi networks and MQTT brokers** you enter are kept in this browser tab until you close it, and sent nowhere.
  **File → Forget WiFi and broker details** clears them sooner.
- **The board** is reached over the USB cable. Nothing goes through a server.

The site sends your browser the editor and the board images, then steps out. Its server keeps a three-day access
log, to run the server and count visits.

## What needs ThingStudio App

- **Connecting to a board over WiFi.** A web page can reach a board only over USB. A deployed flow still uses WiFi,
  MQTT and HTTP as normal.
- **Custom nodes**, and **your own board definitions**. These are read from the `.thingstudio` folder on your
  computer. The browser shows them, but they can't be used there.
- **The `thingstudio-compile` command** and the [AI authoring](ai-authoring.md) tools.

The browser version always follows the newest ThingStudio. When a new runtime comes out, Connect says the board's
runtime is older than the editor's. Click **Install runtime** to update it.

[Install ThingStudio App](getting-started.md#step-1-install-thingstudio) to have all of it. It runs on your
computer and opens in your browser too.

## If something goes wrong

- **The port isn't listed.** Use a cable that carries data. Some boards need a USB serial driver first.
- **"Couldn't open the port".** Another program has it open: ThingStudio, Thonny or a serial monitor. Close it and
  try again.
- **Install runtime says "Waiting for the board".** Press the board's reset button while it waits.
- **An ESP32 doesn't answer on Connect.** Hold its BOOT button, tap RESET, release BOOT, and Connect again.
- **ESP32-S2 boards** need that every time they are written, and appear as a new port afterwards: pick it again.
- **A board on the chip's own USB, running other firmware** (a conference badge, say): the page can't switch it to
  download mode. Unplug it, hold BOOT while you plug it back in, then Connect and pick its port again. It has a new
  name in download mode.
- **A board that reaches download mode only through its own firmware**, such as the EMF 2022 Tidal badge, stays in
  it for about a second: too short to pick its port. Write its image with
  [ThingStudio App](getting-started.md#step-1-install-thingstudio). After that, Install runtime and the editor
  work here as usual.
