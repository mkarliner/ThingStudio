# Debugging & troubleshooting

## Console and compiled source

The **console** panel shows everything the connected board reports: deploy results, node errors, and anything a `debug` node prints. Clear it with the button in its corner.

Routine system reports are hidden unless you tick **Verbose**: network status, the listener starting up, and the raw protocol messages. Tick it when you're chasing a connection problem. Warnings, errors and your flow's own output always show. Hidden lines are kept, so ticking it later shows what was already logged.

The **source preview** panel shows the actual MicroPython the current canvas compiles to — useful for seeing exactly what a flow does, or for confirming a fix landed where you expected.

### Memory

After each connect and deploy, a **[memory]** line shows how much RAM the board has free. On ESP32 boards
it also shows the ESP-IDF heap and its largest free block. WiFi, MQTT and TLS use that heap, not
MicroPython's. If WiFi won't join while MicroPython still has plenty free, a low ESP-IDF figure is the
likely cause. The ESP32-C3 is the tightest.

## Board won't connect

When **Connect**, **Tools → Check status** or **Tools → Install runtime…** gets no proper reply, the console says what the board sent instead. Each case has a next step.

| Console says | What it means | What to do |
| --- | --- | --- |
| The board didn't reply at all | Usually no MicroPython on the board | [Install MicroPython](installing-micropython.md). If it's already there, press reset and try again. |
| MicroPython but not the Thingstudio runtime | MicroPython is fine; the runtime is missing | Choose **Tools → Install runtime…**. |
| The board is in its bootloader | An ESP32 is in download mode | Press reset without holding BOOT. |
| Running CircuitPython, or other firmware | Not MicroPython | [Install MicroPython](installing-micropython.md). |
| The runtime is starting up | It's still booting | Wait a few seconds, then choose **Tools → Check status**. |

The raw error from the backend stays in the message in brackets. Include it if you report a problem.

### Watching a board start up

To see a board's own startup messages, connect with `mpremote connect <port>` and no further command, or a serial monitor that doesn't send Ctrl-C when it opens. A working runtime prints `LISTENER_BOOTING`, then `LISTENER_READY`.

`mpremote repl` and Thonny's Shell interrupt the board as they connect. That looks just like a board that never starts, even when it's fine. Close them before connecting from Thingstudio; only one program can use the port at a time.

## Commands and the Python prompt

The box under the console runs Python on the board. Type a line and press Enter; the result appears in the console. Up and down arrows bring back earlier commands.

```python
gc.mem_free()
import machine; machine.Pin(15).value()
os.listdir()
```

Commands run alongside your flow, and variables you set stay for the next command. A slow command (a long `sleep`, a loop) pauses the flow until it finishes, so keep them short.

For a full Python prompt, click **Stop flow & open prompt**. The flow and Thingstudio stop, and the board waits at MicroPython's own `>>>` prompt. Nothing is deleted. Anything you type in the box now goes straight to that prompt. Deploy is off while you're there. Click **Restart Thingstudio** when you're done; the board restarts Thingstudio and your saved flow.

You can also use the prompt from another program, such as Thonny or `mpremote`: click **Disconnect** first.

## Restarting the board

A board can run short of memory after several deploys, or after a flow that uses a lot of it, such as a display.
The console suggests a restart when that's the likely problem: a deploy fails with `MemoryError`, the board restarts
while starting a flow, or an ESP32 reports too little memory left for WiFi.

- **Tools → Restart board (soft)** restarts MicroPython. The saved flow starts again with clean memory. USB stays
  connected.
- **Tools → Reset board (hard)** resets the whole chip, like its reset button. It frees all memory, including what
  WiFi needs on an ESP32. A board with native USB (Pico, ESP32-S2/S3/C3) disconnects; click **Connect** when it's
  back.

Try the soft restart first.

## Board stuck restarting

A flow that crashes the board as it starts would crash it again on every restart. Thingstudio stops this itself: if the saved flow doesn't stay up for 10 seconds on three restarts in a row, the board starts without it. The console shows **[safe mode]**. Fix the flow and deploy it again, or remove it.

**Tools → Remove flow…** deletes the saved flow from the board. The board then starts with Thingstudio only, as after a fresh runtime install. Use it for any flow that stops the board answering:

1. Select the board's port and choose **Tools → Remove flow…**.
2. If the console says so, press the board's reset button. Thingstudio keeps trying for a minute, so the timing doesn't matter.
3. When it's done, click **Connect**.

The flow on your canvas isn't affected.

## Module missing on the board

A deploy can fail with `ImportError: no module named '...'`. The flow needs a module the board's MicroPython doesn't
have. The board keeps running its previous flow.

The usual cause is networking. MQTT, UDP, HTTP and WiFi nodes need the `network` and `socket` modules, which only
boards with WiFi (or Ethernet) have. A Raspberry Pi Pico has none; a Pico W does. If the board reports no WiFi, the
console warns you before the deploy.

Other modules differ between ports and builds. If the import is in your own function node, check the module exists
for your board in the [MicroPython docs](https://docs.micropython.org/). A board that should have it may need a
different [MicroPython build](https://micropython.org/download/).

Libraries Thingstudio provides, such as the MQTT client or display drivers, are sent by Deploy. See
[Libraries](flow-lifecycle.md#libraries).

## I2C device not answering

A sensor node's status dot shows **disconnected**, "no reply at 0x76", when nothing answers at its address.
Scan the bus to see what is there. Type these two lines in the command box, one at a time, with your bus
and pins:

```python
i2c = machine.I2C(0, scl=machine.Pin(5), sda=machine.Pin(4))
[hex(a) for a in i2c.scan()]
```

An `i2c` node set to **scan** does the same from a flow.

An empty list means nothing answered. Check, in this order:

- The pin numbers. On a Pico, GP4 and GP5 are physical pins 6 and 7.
- SDA and SCL swapped.
- Power (3.3 V) and ground to the device.
- Solder joints on the header pins.

A different address from the one set on the node means the address is wrong, not the wiring.

## Reading a node error

When a node raises an exception on the device, the board reports which node and what went wrong. Every network node (`udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, `mqtt_subscribe`) follows the same convention for its own errors: the operation and the host/port it was talking to are named directly in the message, not left for you to guess from a bare exception. If you see a raw, unattributed error with no context from a network node, that's worth reporting — every network node in this project is meant to wrap its own errors before they reach you.

## Native code (Tools → Native code)

A few nodes (currently `display_spi`'s `gs4`/`gs2`/`mono` frame formats) compile part of their code to native machine code, not portable bytecode. That needs the right target architecture for your board's chip.

**Tools → Native code** defaults to Auto, which uses the processor of the board in the [Board menu](boards.md) and shows the result, for example **Arch: xtensawin**. If Auto picks the wrong one, choose your board's chip from the list instead.

If Deploy fails with an architecture or native-module error, check this setting: pick your board's chip explicitly and redeploy.

## Known platform limitation: WiFi/MQTT connect ordering

On ESP32 boards, a flow with MQTT nodes can hit a WiFi connection error at deploy time ("Wifi Internal State Error"). The board is still reconnecting to a network an earlier flow used, and refuses a new connect until that finishes. The MQTT nodes stop that reconnect and try again, up to three times. If it still fails, deploy again. It's a platform timing issue, not a mistake in your flow.
