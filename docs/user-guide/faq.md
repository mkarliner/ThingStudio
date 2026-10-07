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

## Which board should I use for a display and WiFi together?

An ESP32 with external RAM (PSRAM), such as many ESP32-S3 boards. MicroPython puts its heap in the external RAM,
leaving the chip's own RAM for WiFi. A classic ESP32 or ESP32-C3 without PSRAM can run a display and WiFi, but
only at lower colour depths and with little to spare.

## My WiFi flow worked before, but now the board crashes or won't join. Why?

On an ESP32, MicroPython's heap grows by taking memory from ESP-IDF when a flow needs more, and keeps it until the
chip is reset. After a flow that uses a lot of memory, such as a display, WiFi may not have enough left to start.
The console warns you before you deploy. Use **Tools → Reset board (hard)**: a soft restart doesn't give that
memory back. See [Restarting the board](debugging.md#restarting-the-board).

## Why does Deploy say the board needs the runtime installed again?

The editor and the runtime on the board talk a shared protocol. When an update changes it, a board with the older
runtime can't run flows from the newer editor, so Deploy stops and says so. Use **Tools → Install runtime…**, then
Connect and deploy again.

## How do I tell which version of the editor I'm running?

It's next to **Thingstudio** in the toolbar, and in **Help → About**. A `+` after it means the editor was built
from changes that weren't committed yet.
