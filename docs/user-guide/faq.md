# FAQ

## Where do I ask a question or report a problem?

Ask questions, and show what you've built, in [GitHub Discussions](https://github.com/mkarliner/ThingStudio/discussions).
Report a bug or a missing feature on the [issue tracker](https://github.com/mkarliner/ThingStudio/issues), or with
**Help → Report a problem**. Include the editor's version (**Help → About ThingStudio**), your board, and the console
lines around the problem. Share the flow file, not compiled output; see the next question.

## How do I share a flow when I ask for help?

Share the flow file: **File → Save**, then attach or paste the `.flow.json`. It holds the nodes and wiring and no
passwords: the WiFi and broker logins stay on your computer
([The ThingStudio folder](thingstudio-folder.md#credentials)). Don't paste the **Compiled source** panel, a downloaded
`.py` or the console's compiled output: they contain the resolved WiFi password and broker login. If you pasted it somewhere
public, change the password.

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

Free memory is in pieces, and a big buffer needs one piece that size. A 240x320 frame in 16 grays is 38,400 bytes.
The [GUI nodes](nodes/gui.md) draw in strips to avoid this; a `function` node that builds a full frame should too.
See [MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load).

## Why isn't a soft restart enough after "too full to receive the flow"?

A soft restart reuses the same heap; only a power cycle rebuilds it. See [MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load).

## Deploy failed a second time. Is the flow too big for my board?

Possibly. If a deploy still fails after **Tools → Remove flow…** and a power cycle, the flow may be too big for the
board. See [MemoryError or a library that won't load](debugging.md#memoryerror-or-a-library-that-wont-load) for what to do.

## Redeploying a BLE flow on an ESP32-C5 fails with "MemoryError". Why?

On stock MicroPython, the Bluetooth stack keeps its memory between flows, and the runtime, libraries and new flow
have to fit in what is left. Install the [ThingStudio custom image](custom-firmware.md): it redeploys the same flow
with room to spare. Or choose **Tools → Remove flow…**, power cycle the board, then deploy.

## Why does http request fail with "MemoryError" fetching a page?

The node reads the whole response body into memory at once. A page larger than the largest free block fails, even
when the console shows more free memory than the page size. A 56 KB page on an ESP32-C3 failed with
`MemoryError allocating 56722 bytes`; a 48-byte page worked. Point the node at a smaller response, or use a board
with PSRAM for large pages.

## Which MicroPython build does my ESP32-S3 need for its PSRAM?

The kind of PSRAM decides, not the flash size. Quad PSRAM, usually 2 MB (modules such as N8R2), works with the
generic build: it finds the PSRAM at startup. Octal PSRAM, usually 8 MB (modules such as N16R8), needs the octal
build (`SPIRAM_OCT`). On the generic build an octal board's PSRAM stays unused and the console shows only about
120 KB free. Freenove's S3 display boards are octal: 121 KB free before, 7.8 MB after.

## My ESP32-C5 prints "PSRAM chip is not connected" at boot. Is it broken?

No. The generic ESP32-C5 build looks for PSRAM, and many C5 modules have none. It reports the failure, says
"continuing without it", and starts MicroPython with the chip's own RAM. The
[ThingStudio C5 image](custom-firmware.md) doesn't look for PSRAM, so it doesn't print this.

## Why does GPIO 10 pulse when my flow doesn't use it?

The runtime toggles GPIO 10 every 200 ms, on every board, as a liveness signal for Thingstudio's own test rig. It
starts with the runtime, so it runs with no flow deployed and keeps running when you change your flow. Leave
GPIO 10 unconnected, and don't use it in a flow: the runtime and the flow would both drive it.

## Which board should I use for a display and WiFi together?

An ESP32 with external RAM (PSRAM), such as many ESP32-S3 boards. MicroPython puts its heap in the external RAM,
leaving the chip's own RAM for WiFi. A classic ESP32 or ESP32-C3 without PSRAM can run a display and WiFi, but
only at lower color depths and with little to spare.

## My WiFi flow worked before, but now the board crashes or won't join. Why?

On an ESP32, MicroPython's heap grows by taking memory from ESP-IDF, and keeps it until the chip is reset. After a
flow that uses a lot of memory, such as a display, WiFi may have too little left to start. Use
**Tools → Reset board (hard)**: a soft restart doesn't give that memory back. See [Memory](debugging.md#memory) and
[Restarting the board](debugging.md#restarting-the-board).

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

It's next to **ThingStudio** in the toolbar, and in **Help → About ThingStudio**. A `+` after it means you built the editor
from uncommitted changes.

## My clock shows `--` and never the time. Why?

The ntp node hasn't synced yet. Its status says why: **waiting for WiFi**, or **NTP from *server* failed** when the
board can't reach the server. It tries again every 30 seconds. See [ntp](nodes/ntp.md#errors).

## My gui toggle shows `--`. Why?

A toggle with its input wired shows `--` until the input sends a value it recognizes. It matches the input against
its *on sends* and *off sends* values, `true` and `false` unless you changed them. A Tasmota plug reports `ON` and
`OFF` as text: set the toggle's value type to text. See [a toggle that follows the real device](nodes/gui.md#a-toggle-that-follows-the-real-device).

## Why can't I use a touch node and a gui screen on the same panel?

Both would poll the same chip, and each would take touches from the other. A gui screen reads its panel itself.
Use the touch node only when you aren't using the GUI. Deploy stops and names both nodes if a panel is picked twice.

## Why can't a page resize, or a text element take a percentage width?

There is nothing to resize to: a page fills a display of one fixed size, and the layout is resolved when the flow
compiles, not by a browser at runtime. An element's cells, its font and its position are fixed numbers on the
board. See [Laying out pages](nodes/gui.md#laying-out-pages).

## Why won't a function node's output wire into pwm out?

A function node's output has the type `any`, and `pwm out`'s input takes a `number`. The editor refuses a wire from
`any` to `number`, `int` or `string` inputs. See [Wiring](working-in-the-editor.md#wiring).

## Why does compile fail with "needs a WiFi network"?

An `mqtt publish` or `mqtt subscribe` node talks to its broker over WiFi, and it manages that connection itself, so
it needs real credentials: a WiFi config in the flow and a broker. Compile stops with one line naming what's
missing — "needs a WiFi network" or "needs an MQTT broker". Set the node's **WiFi** (or **MQTT Broker**) field;
every MQTT node in a flow shares that one setting. See [Config nodes](working-in-the-editor.md#config-nodes).

## Why do http in requests take a second to answer?

The flow answers immediately; the wait is the board's WiFi waking up. An idle board's radio sleeps (modem-sleep), and
a new request pays the wake and the connection set-up before anything the flow does. On a classic ESP32 behind a VPN
tunnel, requests took up to 1.2 s with the radio asleep and 0.15–0.20 s once it was warm. If the board has steady
network traffic, a flow that talks or sits connected, the wake cost goes away on its own.

## Why is Compile → Deploy grayed out after a deploy?

The board already runs the flow on the canvas. Deploy comes back when you change the flow. See
[Deploy is grayed out](debugging.md#deploy-is-grayed-out).

## Why are the pin fields dropdowns?

Your processor names its pins instead of numbering them. The STM32 on a pyboard uses `X1`, `A13` and so on. Pin
fields then list the chip's own pins rather than take a number. See
[Pins that aren't numbers](boards.md#pins-that-arent-numbers).

## Why can't I use SPI bus 0 or 1 on an nRF52840?

On the nRF52840, SPI 0 and 1 share hardware with I2C 0 and 1, so a flow using both would fail on the board.
ThingStudio offers SPI on buses 2 and 3 only. See [Boards and processors](boards.md#built-in-processors).

## Why did my saved settings reset after I renamed the flow?

Saved values are kept per flow name. Renaming the flow makes it a new name to the board, so its values start from
the defaults. The old values are still on the board: rename the flow back to use them again, or clear them from the
[command box](debugging.md#commands-and-the-python-prompt).

## Why doesn't my Uno TFT shield work on a Wemos D1 R32?

The D1 R32 puts the shield's A2, A3 and A4 on GPIO 35, 34 and 36, which are input only on an ESP32. A parallel
TFT shield drives its RS, CS and RST lines from those pins, so it can't start. Wire GPIO 15 to A2 (RS), GPIO 33
to A3 (CS) and GPIO 32 to A4 (RST), then set those pins in the display node.

## Do I need a terminal to install MicroPython?

No, for boards ThingStudio can flash: the ESP32 family over a serial port, and a board whose bootloader mounts as a
drive (RP2040, RP2350, nRF52). Put the board in its bootloader and use **Tools → Install firmware…**. Other chips
have their own installation routes; see [Install MicroPython](installing-micropython.md).

## Why are the ble nodes grayed out?

The chosen board has no Bluetooth LE that MicroPython's `bluetooth` module drives. The ESP32, S3, C3 and C5 have it.
The ESP32-S2 has no Bluetooth, and an nRF52840's MicroPython reaches its radio through a different module
(`ubluepy`), which these nodes don't use yet. Pick your board in the **Board** menu; see [boards](boards.md).

## Why doesn't ble scan show my device's name?

Many devices put their name only in the scan response, which a passive scan doesn't ask for. Turn on **active
scan**. Some never advertise a name: filter them by address or manufacturer id instead.

## Why did WiFi get slower when I added a ble scan?

On an ESP32 the WiFi and Bluetooth share one radio, taking turns. The longer the **scan window** against the **scan
interval**, the less time WiFi gets. The default listens 30 ms in every 320 ms; lower the window, or raise the
interval, if MQTT or HTTP become slow. See [ble scan](nodes/ble-scan.md).

## A phone or computer still shows the old characteristics after I changed the flow. Why?

Phones and computers remember a device's services between connections. After a deploy that changes the
characteristics, turn Bluetooth off and on, or forget the board in the Bluetooth settings, then connect again. In nRF Connect,
**Refresh services** in the device's menu does it too.

## A device connects, but no new values arrive. Why?

Reading shows the value once; to get each new one, the connected device has to subscribe. In nRF Connect, tap the
characteristic's arrow icon (notify). The [ble characteristic out](nodes/ble-characteristic-out.md) node's
**notify** must be on.

## Why does a ble peer stay on "finding"?

The board hasn't seen the device advertise. Check that it's on, in range, and not already connected to something
else, such as a phone app: most devices stop advertising while connected. A phone changes its address, so find a
phone by name. A [ble scan](nodes/ble-scan.md) node into a debug node shows what the board can see.

## After a Bluetooth flow, why does the board have less memory for the next one?

The Bluetooth radio stays on between flows once a ble node has started it: switching it off and on again can leave
the ESP32-C5's radio unable to scan until a power cycle. The radio keeps its share of ESP-IDF memory, the memory WiFi
and displays also use, even if the next flow has no ble nodes. **Tools → Reset board (hard)** gives it back. See
[Memory](debugging.md#memory).
