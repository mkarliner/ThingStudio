# FAQ

## Why does my ESP32 have so little free memory?

An ESP32's RAM is shared between MicroPython and the chip's own software: ESP-IDF, its FreeRTOS scheduler, and
the WiFi stack. About half of a classic ESP32's 520 KB is taken before anything runs, by code that has to run from
RAM, the flash cache and fixed buffers. WiFi and the rest of ESP-IDF then take more as they run.

Measured on a CYD (classic ESP32, no external RAM) with a flow running:

| | KB |
|---|---|
| Used before the heap starts | ~287 |
| MicroPython's heap | 109 |
| ESP-IDF, FreeRTOS and WiFi, allocated while running | ~85 |
| Free | 33 |

So MicroPython gets about a fifth of the chip's RAM. The **[memory]** line in the console (shown at the **Info**
level) shows the current figures.

## Why does a Pico W have more room than an ESP32-C3, when the C3 has more RAM?

The Pico W's WiFi chip has its own processor and memory. On an ESP32 the whole WiFi stack runs on the main chip
and uses its RAM. So a 264 KB Pico W leaves more for your flow than a 400 KB ESP32-C3.

## Deploy failed with "MemoryError ... allocating 38400 bytes". Why, when there's more free memory than that?

Free memory is in pieces. A big buffer needs one piece that size, and after a while an ESP32 may not have
one. A 240x320 frame in 16 grays is 38,400 bytes. The [GUI nodes](nodes/gui.md) avoid this by drawing the
screen in strips. If your own `function` node builds a full frame, draw it in strips too, or restart
the board before deploying.

## Why doesn't Deploy clear the old flow or retry when the board runs out of memory?

Because a repair nobody asked for hides the limit. The editor used to stop the running flow and retry when a
deploy didn't fit; the retry then failed a step later, and the board was left stopped without anyone deciding
that. Now a deploy that doesn't fit fails once, with the board's free-memory figure, and the console says what
to do. The steps are yours to take: **Tools → Remove flow…**, **power cycle the board** (unplug and replug the
USB cable, or **Tools → Reset board (hard)**), then deploy. See
[MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load).

## Why isn't a soft restart enough after "too full to receive the flow"?

Because a soft restart reuses the same heap. It restarts the interpreter, so the flow's own objects go away, but
the heap regions MicroPython took as it grew stay where they were, and memory taken from the chip is not given
back. A board that couldn't find one big block before the soft restart still can't after it. Only cutting power
to the chip rebuilds the heap from scratch — hence the power cycle in the recipe above.

## Deploy failed a second time. Is the flow too big for my board?

Possibly, yes. Work through this in order:

1. **Tools → Remove flow…**, then **power cycle the board** (unplug and replug the USB cable, or
   **Tools → Reset board (hard)**), then deploy.
2. If it still fails, the flow may be too big for the board. Make it smaller (fewer GUI pages, fewer libraries, a
   smaller frame), use a board with more memory, or — on a classic ESP32 — run the
   [custom firmware](custom-firmware.md), which keeps the runtime and the libraries in the firmware.

Boards with little RAM have a point where a flow simply does not fit. Nothing in the editor can make room the
board does not have. The console shows how much memory the board had when it failed; see
[MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load).

## Why is Deploy sending the flow in pieces?

Some boards (classic ESP32 with no PSRAM) can't take a whole flow in one message once a display flow has run:
the memory is free but in pieces too small for one message. Deploy sends the flow in 5 KB pieces instead, each
confirmed before the next. Larger pieces keep a deploy quick; a board that can't take 5 KB has a memory problem
worth seeing rather than one to work around.

## Why does http request fail with "MemoryError" fetching a page?



The node reads the whole response body into memory at once. A page larger than the largest free block fails, even
when the console shows more free memory than the page size. A 56 KB page on an ESP32-C3 failed with
`MemoryError allocating 56722 bytes`; a 48-byte page worked. Point the node at a smaller response, or use a board
with PSRAM for large pages.

## My ESP32-S3 board has PSRAM, but the console shows only about 120 KB free. Why?

The firmware doesn't use the PSRAM. The generic ESP32-S3 build leaves it off. Flash the build for boards with
octal PSRAM (the `SPIRAM_OCT` variant) from [micropython.org/download](https://micropython.org/download/ESP32_GENERIC_S3/).
The console then shows megabytes free. Freenove's S3 display boards are an example: 121 KB before, 7.8 MB after.

## Which board should I use for a display and WiFi together?

An ESP32 with external RAM (PSRAM), such as many ESP32-S3 boards. MicroPython puts its heap in the external RAM,
leaving the chip's own RAM for WiFi. A classic ESP32 or ESP32-C3 without PSRAM can run a display and WiFi, but
only at lower color depths and with little to spare.

## My WiFi flow worked before, but now the board crashes or won't join. Why?

On an ESP32, MicroPython's heap grows by taking memory from ESP-IDF when a flow needs more, and keeps it until the
chip is reset. After a flow that uses a lot of memory, such as a display, WiFi may not have enough left to start.
The console warns you before you deploy. Use **Tools → Reset board (hard)**: a soft restart doesn't give that
memory back. See [Restarting the board](debugging.md#restarting-the-board).

## Why does opening a flow ask "Save changes to …?" even though I changed nothing?

That is the browser's file-permission dialog, not the editor. A page may read a file you pick, but to *write*
it back (Save) it needs your permission, and the browser asks with that wording: "Save changes to
`gui-hero-cyd.flow.json`? `https://127.0.0.1:8765` will be able to edit it." Accept it to let the editor save
back to that file. It is not about unsaved changes on the canvas, and it comes back after a page refresh
because browsers grant file access per page session. Opening from **Open…** or **Recent** is the same file;
nothing is written until you press Save.

## Why does Deploy say the board needs the runtime installed again?

The editor and the runtime on the board talk a shared protocol. When an update changes it, a board with the older
runtime can't run flows from the newer editor, so Deploy stops and says so. Use **Tools → Install runtime…**, then
Connect and deploy again.

## How do I tell which version of the editor I'm running?

It's next to **Thingstudio** in the toolbar, and in **Help → About**. A `+` after it means you built the editor
from uncommitted changes.

## My clock shows `--` and never the time. Why?

The ntp node hasn't synced yet. Its status says why: **waiting for WiFi**, or **NTP from *server* failed** when the
board can't reach the server. It tries again every 30 seconds. See [ntp](nodes/ntp.md#errors).

## My gui toggle shows `--`. Why?

A toggle with its input wired shows `--` until the input sends a value it recognises. It matches the input against
its *on sends* and *off sends* values, `true` and `false` unless you changed them. A Tasmota plug reports `ON` and
`OFF` as text: set the toggle's value type to text. See [a toggle that follows the real device](nodes/gui.md#a-toggle-that-follows-the-real-device).

## Why can't I use a touch node and a gui screen on the same panel?

Both would poll the same chip, and each would take touches from the other. A gui screen reads its panel itself.
Use the touch node only when you aren't using the GUI. Deploy stops and names both nodes if a panel is picked twice.

## Why can't a page resize, or a text element take a percentage width?

There is nothing to resize to: a page fills a display of one fixed size, and the layout is resolved when the flow
compiles, not by a browser at runtime. An element's cells, its font and its position are fixed numbers on the
board. See [Laying out a display](gui-layout.md).

## Why won't a function node's output wire into pwm out?

A function node's output has the type `any`, and `pwm out`'s input takes a `number`. The editor refuses a wire from
`any` to `number`, `int` or `string` inputs. See [Wiring](working-in-the-editor.md#wiring).

## Why is Compile → Deploy grayed out after a deploy?

The board already runs the flow on the canvas. Deploy comes back when you change the flow. See
[Deploy is grayed out](debugging.md#deploy-is-grayed-out).

## Why are the pin fields dropdowns?

Your processor names its pins instead of numbering them. The STM32 on a pyboard uses `X1`, `A13` and so on. Pin
fields then list the chip's own pins rather than take a number. See
[Pins that aren't numbers](boards.md#pins-that-arent-numbers).

## Why can't I use SPI bus 0 or 1 on an nRF52840?

On the nRF52840, SPI 0 and 1 share hardware with I2C 0 and 1, so a flow using both would fail on the board.
Thingstudio offers SPI on buses 2 and 3 only. See [Boards and processors](boards.md#built-in-processors).

## Why did my saved settings reset after I renamed the flow?

Saved values are kept per flow name. Renaming the flow makes it a new name to the board, so its values start from
the defaults. The old values are still on the board: rename the flow back to use them again, or clear them from the
[command box](debugging.md#commands-and-the-python-prompt).

## Why doesn't my Uno TFT shield work on a Wemos D1 R32?

The D1 R32 puts the shield's A2, A3 and A4 on GPIO 35, 34 and 36, which are input only on an ESP32. A parallel
TFT shield drives its RS, CS and RST lines from those pins, so it can't start. Wire GPIO 15 to A2 (RS), GPIO 33
to A3 (CS) and GPIO 32 to A4 (RST), then set those pins in the display node.

## Do I need a terminal to install MicroPython?

No, for boards Thingstudio can flash: the ESP32 family over a serial port, and a board whose bootloader mounts as a
drive (RP2040, RP2350, nRF52). Put the board in its bootloader and use **Tools → Install firmware…**. Other chips
have their own installation routes; see [Install MicroPython](installing-micropython.md).
