# Debugging & troubleshooting

## Console and compiled source

The **console** shows what the board and Thingstudio report: deploy results, node errors, and what `debug` nodes
and `print()` send. **Clear** empties it. Scroll up to read or copy: the console stops following new lines until you
scroll back to the bottom.

Its **Show** menu sets how much it shows:

- **Normal:** your flow's output, warnings, errors, and the results of what you do, such as a deploy.
- **Info:** adds routine reports: board detected, versions, memory, libraries sent, network status.
- **Debug:** adds raw protocol messages and the board's boot output.

Hidden lines are kept, so choosing Info or Debug later shows what was already logged.

The **Compiled source** panel shows the MicroPython your flow compiles to.

The editor's version is next to its name in the toolbar, and in **Help → About Thingstudio**. A `+` after it means
you built it from uncommitted changes. Include the versions when you report a problem.

### Memory

With **Show** set to **Info**, the console prints a `[memory]` line after each connect and deploy. On an ESP32 it
looks like this:

```text
[memory] MicroPython 118 KB free · ESP-IDF heap 64 KB free, largest block 31 KB
```

- **MicroPython … free** is the memory your flow and its libraries run in. It is the total free, not the largest
  piece.
- **ESP-IDF heap … free** is the memory the chip's own software uses, including WiFi, MQTT and TLS. **largest
  block** is the biggest single piece of it. Only ESP32 boards report this part.

Which figure matters depends on the failure:

- A deploy or a library failing with `MemoryError` is about MicroPython's memory. The total can look healthy while
  no single piece is big enough. See
  [MemoryError or a library that won't load](#memoryerror-or-a-library-that-wont-load).
- WiFi failing to start on an ESP32 is about the ESP-IDF heap. Below about 30 KB WiFi may not start, and the console
  warns before a deploy when less is free. **Tools → Reset board (hard)** returns that memory; a soft restart
  doesn't. See [Restarting the board](#restarting-the-board).

A real memory failure says `MemoryError`, `memory allocation failed` or names memory. A network error with a low
figure beside it is still a network error: if the board has joined WiFi and the console says it can't reach a
broker or host, memory isn't the cause. For an MQTT broker, see [MQTT broker unreachable](#mqtt-broker-unreachable).
The [FAQ](faq.md) explains where an ESP32's memory goes.

## Commands and the Python prompt

The command box under the console runs Python on the board. Type a line and press Enter; the result appears in the
console. The up and down arrows bring back earlier commands. The box takes one line: a pasted block of several
lines is joined into one, which Python reads as a `SyntaxError`. Put statements on one line separated by `;`, and
write a loop as a list comprehension, for example `[print(i) for i in range(3)]`.

```python
gc.mem_free()
import machine; machine.Pin(15).value()
os.listdir()
```

Commands run alongside your flow, and variables you set stay for the next command. A command that takes time, such
as a `sleep` or a loop, holds up the flow until it finishes.

The stored application values are available as `settings`:

```python
settings.namespaces()      # each flow's name and how many values it holds
settings.clear()           # clear the current flow's values
settings.clear_all()       # clear every flow's values
```

Use these if a saved value is wrong, or a flow you no longer deploy left values behind. Clearing takes effect
immediately; the next read returns the default. **Tools → Clear device settings…** does the same from the editor:
choose the current flow, or every flow.

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

## Install firmware… fails or lists nothing

**Tools → Install firmware…** writes MicroPython onto a board in its bootloader. Each refusal names the step:

| What the dialog says | What to do |
| --- | --- |
| (no serial ports found), or the board's port is missing | Put the board in download mode — hold **BOOT**, tap **RESET**, release **BOOT** — then click ⟳. |
| (no mounted drives found), or the drive you want isn't listed | Hold **BOOTSEL** while plugging the board in, then click ⟳. If it's mounted somewhere the list doesn't look, type the path in the box under the list — on macOS a Pico shows up as `/Volumes/RPI-RP2`. |
| A port named `/dev/ttyS0`, `/dev/ttyS1`… | Those are the computer's own serial ports, not the board. USB ports are listed above them, labelled with their path and the adapter's name (`/dev/ttyUSB0 -- CH340`). |
| (no build for this chip — choose a file) | The catalog has no pinned image for that chip family. Under **Or use your own image file**, pick the `.bin` or `.uf2` from [micropython.org/download](https://micropython.org/download/). |
| The chip family list is empty, or the catalog can't be read | This install's `firmware/builds.json` is missing or malformed; the dialog says which line. A reinstall replaces it. |
| The catalog from docs.thingstudio.net was refused | The list on the site didn't carry a valid Thingstudio signature, or is older than one this computer already has. The dialog uses the saved or installed list instead, so flashing still works. Report it ([Help → Report a problem](faq.md#where-do-i-ask-a-question-or-report-a-problem)) with the reason in the line. |
| … is not a .uf2, or is a .uf2 sent to a serial port | A mounted drive takes the `.uf2` build, a serial port the `.bin`. Pick the matching file. |
| choose the chip family, so esptool knows which chip and address to use | A file on its own doesn't say which chip it is for. Pick the family; if the image is the reason, the editor reads it out of the file. |
| The board doesn't start after flashing, or its serial output repeats `invalid header` | The address or the family was wrong: `0x1000` for an ESP32 or ESP32-S2, `0x2000` for an ESP32-C5, `0` for an ESP32-S3, C3, C6 or ESP8266, and `0` for a [Thingstudio custom image](custom-firmware.md) on a classic ESP32. A board maker's manual may give another address for its own demo images; for MicroPython, use these. Thonny can't write a C5 at `0x2000` ([Install MicroPython](installing-micropython.md#without-a-terminal-thonny)). Flash again with the right family; the board is recoverable. |
| esptool is not installed on this machine | The backend's Python has no `esptool`: `pip install esptool`, then restart Thingstudio. |
| esptool exited N at … on PORT | The write stopped; the dialog's log has the tool's own lines. Check the cable and the bootloader mode, and retry. In **Install options**, try a slower speed, or tick **Disable the stub loader**. |
| the flash did not finish within … | The tool stopped answering. Unplug and replug the board, then flash again. |

**Erase all flash first** is on by default: a board that had a different layout (a previous MicroPython, or a
vendor image) needs it, or the new image can be written and still not boot.

A flash that finishes but leaves the board silent usually means it is waiting for **Tools → Install runtime…**: a
stock MicroPython build has no runtime at all, and the Thingstudio custom image carries one but not the boot script that
starts it.

## A full runtime on a custom-image board

On the Thingstudio custom image, **Tools → Install runtime…** writes only the boot script, `main.py`; the runtime
is already in the firmware. A full copy of the runtime on the board's filesystem can only come from flashing the
image without **Erase all flash first** over an older install that had one.

To see what is on the filesystem, type this in the command box:

```python
import os; print(os.listdir('/'))
```

A board with only the boot script lists `main.py` among a few small files. A full runtime adds a long list of its
own files. Flash the image again with **Erase all flash first** ticked, then install the runtime.

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

The `[memory]` line can show free RAM while a deploy still fails with `MemoryError`: the free RAM is in pieces, and
a flow or a library needs one piece big enough to fit. This is common on ESP32 boards without PSRAM once a display
flow has run.

When a deploy fails this way, work through these in order:

1. **Tools → Remove flow…** — so nothing is resumed at start-up.
2. **Power cycle the board** — unplug its USB cable and plug it back in, or **Tools → Reset board (hard)**.
3. Deploy again.

Removing the flow alone doesn't help: the running flow keeps its memory until the chip restarts. A soft restart
doesn't either: it restarts the interpreter over the same heap regions and returns no chip memory. Only a power
cycle gives the board a clean heap.

If it still fails after the power cycle, the flow may be too big for this board. Then do one of these:

- **Make the flow smaller.** Use fewer GUI pages, import fewer libraries, pick a smaller frame. The gui screen node
  sends a frame in strips for this reason; a `function` node that builds a whole frame at once still needs one big
  block.
- **Use a board with more memory.** A board with PSRAM can start flows that a board without it cannot.
- **Run a firmware image with the libraries built in.** The classic ESP32, ESP32-C3 and ESP32-C5 have ready-made
  ones: [Custom firmware](custom-firmware.md). On other boards, build your own by freezing the runtime and the flow
  libraries into MicroPython.

Deploy stops here on purpose; freeing or restarting is yours to invoke. When the board looks short of memory before
a deploy starts, the console says so in one line (`only 19 KB free on the board, this flow is 10 KB -- it may not
fit`) and deploys anyway. The figure is total free memory, not the largest block, so it is a hint, not a verdict.

## WiFi Internal State Error on deploy

On an ESP32, deploying a flow with MQTT nodes can fail with "Wifi Internal State Error". The board is still
reconnecting to the network the previous flow used, and refuses a new connection until that finishes. The MQTT nodes
retry up to three times. If it still fails, deploy again.

## MQTT broker unreachable

An `mqtt publish` or `mqtt subscribe` node shows a red dot, and the console says:

```text
mqtt connect to HOST:1883 failed after 3 attempts (… 'Timeout on socket write' …, wifi status 1010)
```

The editor adds a line after it, read from the board's WiFi status, such as
`[mqtt] Board is on WiFi but can't reach the broker HOST:1883 from its network.`

The raw line ends with the board's WiFi status. `wifi status 1010` means the board has joined WiFi and has an address
but can't reach the broker from its network: the cause is the network between the board and the broker, not the
board's memory. `201` or `202` means the board never joined WiFi; see
[The board hasn't joined WiFi](#the-board-hasnt-joined-wifi).

With `1010`, check in order:

- The host and port in the flow's MQTT broker. The board connects to exactly what the flow says.
- That the board's network can reach the broker. Your computer reaching it proves nothing: a laptop can reach a home
  broker over a VPN the board isn't on, and a board on a phone hotspot isn't on the home network.
- That the network lets port 1883 through. Some mobile networks block it.
- That the broker listens beyond localhost. Mosquitto 2 listens on localhost only, unless its configuration has
  `listener 1883` and either `allow_anonymous true` or a password file.

Then do one of these:

- Put the board on the broker's network.
- Use the public test broker `test.mosquitto.org`, port 1883. It is public: anyone can read what you publish, so
  use a topic nobody else will, such as one with a random number in it (`thingstudio/4821937/temperature`). A broker
  on your own network is better if you have one.
- Relay through a computer the board can reach. With Remote Login on, run
  `ssh -g -N -L 0.0.0.0:1883:BROKER:1883 localhost` on that computer, and set the flow's broker to that computer's
  address.

### The board hasn't joined WiFi

On an ESP32, status `201` means the network wasn't found, and `202` means joining failed authentication, usually a
wrong password. Check, in order:

- The network name and password in the flow's WiFi credential: ✎ next to the **WiFi** field.
- Whether the flow has both MQTT nodes and a `wifi status` node. In a flow with MQTT nodes, MQTT manages the WiFi
  connection and `wifi status` only reports on it. If the join fails, remove the `wifi status` node and deploy
  again.
- The ESP-IDF figure on the `[memory]` line. Below about 30 KB WiFi may not start; use
  **Tools → Reset board (hard)**. See [Memory](#memory).

The console can also show "Wifi Internal State Error". For that error at deploy time, see
[WiFi Internal State Error on deploy](#wifi-internal-state-error-on-deploy).

## Deploy resends a piece, or fails part-way

Deploy sends the flow, and each library it uses, in pieces, and waits for the board to confirm each one. Over a
USB-serial chip such as the CYD's, a piece can arrive damaged or its confirmation can get lost. The console then
shows `resending (1/2)`, and Deploy carries on.

If a piece still fails after three tries, Deploy stops and says so, and the flow on the board is unchanged. Deploy
again. If it keeps happening, try another USB cable or port, close anything else using the serial port, or connect
over WiFi.

## The console shows `[protocol] illegal` or `PROTOCOL_ILLEGAL`

The editor and the board follow a fixed set of moves when they talk. A line starting `[protocol] illegal` (from the
editor) or `PROTOCOL_ILLEGAL` (from the board) means one of them made a move that isn't in that set. It is a bug in
Thingstudio, not something you did. Deploy carries on or fails cleanly either way. Please
[report it](https://github.com/mkarliner/ThingStudio/issues) with the console lines around it.

## Reading a node error

When a node fails on the board, the console shows a `[NODE_ERROR]` line naming the node and the error, and the node
is highlighted on the canvas. Network nodes (`udp send`, `udp receive`, `http request`, `mqtt publish`,
`mqtt subscribe`) also name the operation and the host and port. A network node error without them is worth
[reporting](https://github.com/mkarliner/ThingStudio/issues).

A node error stops the chain the node is in, from its source onward, until the next deploy: a `timer` sends nothing
more, an `inject` ignores clicks. The flow's other chains keep running.

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

## Deploy fails with an architecture or native-module error

The `gs4`, `gs2` and `mono` frame formats of [display spi](nodes/display-spi.md) compile part of their code to
native machine code, which needs the right architecture for the board's chip.

**Tools → Native code** defaults to **Arch: Auto**, which uses the processor of the board in the
[Board menu](boards.md). If Deploy fails with an architecture or native-module error, pick your board's chip from
the list and deploy again.

## Restarting the board

A board can run short of memory after several deploys, or after a flow that uses a lot of it, such as a display.
The console suggests a restart when a deploy fails with `MemoryError`, when the board restarts while starting a flow,
or when an ESP32 has too little memory left for WiFi.

The Tools menu has two restarts:

- **Tools → Restart board (soft)** restarts MicroPython. The saved flow starts again with a clean interpreter and the
  flow's own objects are gone; the heap stays as it was. USB stays connected.
- **Tools → Reset board (hard)** resets the whole chip, like its reset button, and frees all memory. A board with
  native USB (Pico, ESP32-S2, S3 and C3) disconnects; click **Connect** when it's back.

A soft restart clears a flow's own leftovers, such as a big buffer a faulty node left behind. A deploy that doesn't
fit needs the steps under [MemoryError or a library that won't load](#memoryerror-or-a-library-that-wont-load), and
an ESP32 short of memory for WiFi needs the hard reset. The console says which. Deploy is off until the board is
back, which can take several seconds.

## Board stuck restarting

A flow that crashes the board as it starts would crash it on every restart. If the saved flow doesn't stay up for 10
seconds on three restarts in a row, the board starts without it, and the console shows **[safe mode]**. Fix the flow
and deploy it again, or remove it.

**Tools → Remove flow…** deletes the saved flow from the board, for any flow that stops the board answering:

1. Select the board's port and choose **Tools → Remove flow…**.
2. If the console asks, press the board's reset button. Thingstudio keeps trying for a minute.
3. When it's done, click **Connect**.

The board then starts with the runtime only, as after a fresh install. The flow on your canvas isn't affected.
