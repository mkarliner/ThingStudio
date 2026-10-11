# Debugging & troubleshooting

What the console and compiled source show, and what to do when a board or deploy fails.

## Console and compiled source

The **console** shows what the board and Thingstudio report: deploy results, node errors, and what `debug` nodes
and `print()` send. **Clear** empties it.

Its **Show** menu sets how much it shows:

- **Normal:** your flow's output, warnings, errors, and the results of what you do, such as a deploy.
- **Info:** adds routine reports: board detected, versions, memory, libraries sent, network status.
- **Debug:** adds raw protocol messages and the board's boot output.

Hidden lines are kept, so choosing Info or Debug later shows what was already logged.

The **Compiled source** panel shows the MicroPython your flow compiles to.

The editor's version is next to its name in the toolbar, and in **Help → About Thingstudio**. A `+` after it means
you built it from uncommitted changes. Include the versions when you report a problem.

### Memory

With **Show** set to **Info**, a `[memory]` line after each connect and deploy shows the board's free RAM. On an
ESP32 it also shows the ESP-IDF heap and its largest free block. WiFi, MQTT and TLS use the ESP-IDF heap, not
MicroPython's. If WiFi won't join while MicroPython has plenty free, a low ESP-IDF figure is the likely cause. The
[FAQ](faq.md) explains where an ESP32's memory goes.

## Commands and the Python prompt

The command box under the console runs Python on the board. Type a line and press Enter; the result appears in the
console. The up and down arrows bring back earlier commands.

```python
gc.mem_free()
import machine; machine.Pin(15).value()
os.listdir()
```

Commands run alongside your flow, and variables you set stay for the next command. A command that takes time, such
as a `sleep` or a loop, holds up the flow until it finishes.

For MicroPython's own `>>>` prompt, click **Stop flow & open prompt**. The flow and the runtime stop; nothing is
deleted. What you type in the box now goes to that prompt, and Deploy is off. Click **Restart Thingstudio** to start
the runtime and the saved flow again.

To use the prompt from another program, such as Thonny or `mpremote`, click **Connected · Disconnect** first.

### Watching a board start up

To see a board's own startup messages, connect with `mpremote connect PORT` and no further command, or a serial
monitor that doesn't send Ctrl-C when it opens. A working runtime prints `LISTENER_BOOTING`, then
`LISTENER_READY`.

`mpremote repl` and Thonny's Shell interrupt the board as they connect, which looks like a board that never starts.
Close them before connecting from Thingstudio: only one program can use the port at a time.

## Board won't connect

When **Connect**, **Tools → Check status** or **Tools → Install runtime…** gets no proper reply, the console says
what the board sent instead, and what to do:

| Console says | What to do |
| --- | --- |
| Nothing came back | Usually no MicroPython. [Install MicroPython](installing-micropython.md). If it's there, press reset, then **Tools → Check status**. |
| MicroPython but no Thingstudio runtime | **Tools → Install runtime…**. |
| MicroPython replied but didn't enter install mode | Press reset and install again. |
| Board is in its bootloader | An ESP32 in download mode. Press reset, not BOOT. If it repeats, install MicroPython. |
| Board runs CircuitPython, or replied but not as MicroPython | [Install MicroPython](installing-micropython.md). |
| Runtime still starting | Wait, then **Tools → Check status**. |
| Install stalled | Replug the board, click **⟳**, and try again. If it repeats, restart Thingstudio. |

If the port itself won't open, the console says why:

| Console says | What to do |
| --- | --- |
| port in use | Close other serial monitors, IDEs, or editor tabs using the board. |
| port access refused | Replug the board and check port permissions. On Linux, check you're in the `dialout` group. |
| board gone from that port | Check the cable, click **⟳**, and connect again. |

The raw error stays in the message, in brackets. Include it if you report a problem.

## Deploy is grayed out

**Compile → Deploy** is grayed out when:

- the editor isn't connected to a board;
- the flow on the board is the one on the canvas, deployed and unchanged since;
- the flow is stopped at the Python prompt (click **Restart Thingstudio**);
- the board is restarting.

## Module missing on the board

A deploy can fail with `ImportError: no module named '...'`: the flow needs a module the board's MicroPython doesn't
have. The board keeps running its previous flow.

The usual cause is networking. MQTT, UDP, HTTP and WiFi nodes need the `network` and `socket` modules, which only
boards with WiFi or Ethernet have. A Raspberry Pi Pico has neither; a Pico W does. If the board reports no WiFi, the
console warns you before the deploy.

Other modules differ between ports and builds. If the import is in your own function node, check the module exists
for your board in the [MicroPython docs](https://docs.micropython.org/). A board that should have it may need a
different [MicroPython build](https://micropython.org/download/).

Thingstudio's own libraries, such as the MQTT client and display drivers, are sent by Deploy. See
[Libraries](flow-lifecycle.md#libraries).

## MemoryError or a library that won't load

On an ESP32 without external RAM (PSRAM), a flow can fail to load with `MemoryError` even though the `[memory]` line
shows free RAM. The free RAM is in pieces, and the library needs one large piece. This is most likely after a display
flow has run. Use **Tools → Reset board (hard)**, then deploy again. See the [FAQ](faq.md) for why an ESP32 has
little room.

If Deploy says the board is **too full to receive the flow**, the running flow is using the memory. Use
**Tools → Remove flow…**, then **Tools → Reset board (hard)**, then deploy.

## WiFi Internal State Error on deploy

On an ESP32, deploying a flow with MQTT nodes can fail with "Wifi Internal State Error". The board is still
reconnecting to the network the previous flow used, and refuses a new connection until that finishes. The MQTT nodes
retry up to three times. If it still fails, deploy again.

## Reading a node error

When a node fails on the board, the console shows a `[NODE_ERROR]` line naming the node and the error, and the node
is highlighted on the canvas. Network nodes (`udp send`, `udp receive`, `http request`, `mqtt publish`,
`mqtt subscribe`) also name the operation and the host and port. A network node error without them is worth
[reporting](https://github.com/mkarliner/ThingStudio/issues).

## I2C device not answering

A sensor node's status dot shows **disconnected**, with "no reply at 0x76", when nothing answers at its address.
Scan the bus to see what is there. Type these two lines in the command box, one at a time, with your bus and pins:

```python
i2c = machine.I2C(0, scl=machine.Pin(5), sda=machine.Pin(4))
[hex(a) for a in i2c.scan()]
```

An [i2c device](nodes/i2c.md) node set to **scan** does the same from a flow.

An empty list means nothing answered. Check these, in order:

- The pin numbers. On a Pico, GP4 and GP5 are physical pins 6 and 7.
- SDA and SCL swapped.
- Power (3.3 V) and ground to the device.
- Solder joints on the header pins.

An address different from the node's means the address is wrong, not the wiring.

## A toggle button goes back

A [gui toggle](nodes/gui.md#a-toggle-that-follows-the-real-device) with its input wired shows the state you asked
for until the input confirms it. If nothing arrives within **wait for confirmation** (5 s by default), it goes back
to its last state, shows a cross for a moment, and the console shows
`NODE_ERROR ... NoConfirmation: no confirmation within 5 s`.

Check these, in order:

- The device is reachable and the command reached it. Watch the command topic with a debug node.
- The input is wired to the device's *state* topic, not the command topic.
- The state is sent in a form the toggle matches. A toggle set to `true` and `false` ignores `ON` and `OFF`: set its
  **value type** to text.

## Native code (Tools → Native code)

The `gs4`, `gs2` and `mono` frame formats of [display spi](nodes/display-spi.md) compile part of their code to
native machine code, which needs the right architecture for the board's chip.

**Tools → Native code** defaults to **Arch: Auto**, which uses the processor of the board in the
[Board menu](boards.md). If Deploy fails with an architecture or native-module error, pick your board's chip from
the list and deploy again.

## Restarting the board

A board can run short of memory after several deploys, or after a flow that uses a lot of it, such as a display.
The console suggests a restart when a deploy fails with `MemoryError`, the board restarts while starting a flow, or an
ESP32 has too little memory left for WiFi.

The Tools menu has two restarts:

- **Tools → Restart board (soft)** restarts MicroPython. The saved flow starts again with clean memory. USB stays
  connected.
- **Tools → Reset board (hard)** resets the whole chip, like its reset button, and frees all memory. A board with
  native USB (Pico, ESP32-S2, S3 and C3) disconnects; click **Connect** when it's back.

Try the soft restart first after a `MemoryError`. When an ESP32 is short of memory for WiFi, only the hard reset
gives it back. The console says which to use. Deploy is off until the board is back, which can take several seconds.

## Board stuck restarting

A flow that crashes the board as it starts would crash it on every restart. If the saved flow doesn't stay up for 10
seconds on three restarts in a row, the board starts without it, and the console shows **[safe mode]**. Fix the flow
and deploy it again, or remove it.

**Tools → Remove flow…** deletes the saved flow from the board, for any flow that stops the board answering:

1. Select the board's port and choose **Tools → Remove flow…**.
2. If the console asks, press the board's reset button. Thingstudio keeps trying for a minute.
3. When it's done, click **Connect**.

The board then starts with the runtime only, as after a fresh install. The flow on your canvas isn't affected.
