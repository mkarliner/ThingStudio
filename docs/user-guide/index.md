# Thingstudio

Thingstudio is a visual, low-code way to program microcontrollers. You build a program, called a flow, in a
node-based editor in your web browser. Nodes are functional blocks, and wires carry data between them. The design is
inspired by [Node-RED](https://nodered.org/).

Thingstudio converts the flow to [MicroPython](https://micropython.org/), a version of Python for microcontrollers,
compiles it and sends it to your board. The flow is saved on the board. It runs without the editor connected, and
starts again after a reset or power cycle.

<figure markdown="span">
  [![The Thingstudio editor, showing a three-node flow: timer, function and gpio out](images/editor.png)](images/editor.png)<figcaption>The editor: nodes to drag in on the left, your flow in the middle, and on the right the selected
  node's settings and the board's console. Click to see it full size. [Canvas basics](canvas-basics.md#the-editor) labels every
  part.</figcaption>
</figure>

Everything runs on your own computer and your own boards. Thingstudio isn't a cloud service.

- **No account.** There's nothing to sign up for, and nothing is sent to us.
- **Works offline.** Once installed, it needs no internet connection, docs included.
- **Git friendly.** Thingstudio's files, your programs and your board definitions, are plain, indented
  JSON that you save where you like. They diff cleanly and sit happily in a git repository. Passwords and
  other credentials are stored separately, so a committed program holds no secrets.
- **Made to be extended.** Write your own [custom nodes](custom-nodes.md), and add your own
  [boards](boards.md#adding-a-board) and [processors](boards.md#adding-a-processor). You drop their files into
  a folder. There's nothing to rebuild.
- **Free and open source.** Thingstudio is under the
  [Apache 2.0 licence](https://github.com/mkarliner/ThingStudio/blob/main/LICENSE). You can use it, change it and
  build on it, including in commercial products.

!!! tip "Already know the background?"
    If you know Node-RED, MicroPython or Arduino, read what's different for you, or go straight to
    [Getting started](getting-started.md).

    - [Node-RED](coming-from/node-red.md)
    - [MicroPython](coming-from/micropython.md)
    - [Arduino and C](coming-from/arduino.md)

## What's different about programming with Thingstudio?

A typical microcontroller program, in Arduino for example, has a `setup()` section that runs once at boot, then a
main loop that runs forever. The loop might:

- read the sensors
- check the buttons
- update the outputs
- check the network
- go round again

Each new job makes the loop longer. A slow step, such as a network call, holds up everything else, and the timing
gets hard to reason about.

Thingstudio programs respond to events instead. When a button is pressed, turn on a light. Every ten seconds, read
the temperature. When a message arrives from the network, update the display. Each response runs only when its event
happens, and the board waits for many events at once. This is
[event-driven programming](background/event-driven.md).

Event-driven code is harder to write by hand. In MicroPython it means
[`asyncio`](https://docs.micropython.org/en/latest/library/asyncio.html): tasks, `await`, and code to start the
tasks and pass data between them. The program no longer reads top to bottom, and one blocking call stalls every
task. Thingstudio writes this code for you. You draw each event and what happens next, and Thingstudio generates the
tasks and the connections between them.

## Events, nodes and wires

A program is made of **nodes** joined by **wires**. There are three types of node:

- **Sources** start messages when something happens: a timer fires, a button is pressed, an MQTT message arrives.
- **Transforms** take a message in and send a message on: a function, a filter, a delay.
- **Sinks** act on a message: switch a pin, update a display, publish to MQTT.

A wire joins one node's output to the next node's input. The nodes and wires together make a **flow**. A flow can
hold any number of chains, each starting at a source.

Nodes pass **messages** along the wires. A message is a dict, with its main value in `payload`. More on this in
[flows, nodes and messages](background/flows-and-nodes.md).

This way of working comes from [Node-RED](background/node-red.md), a popular tool for home automation and IoT. In
Node-RED, flows run on a server or a Raspberry Pi. In Thingstudio, they run on the microcontroller.

## Your own Python

The [node reference](nodes/index.md) lists the built-in nodes. For anything they don't cover, use a
[function](nodes/function.md) node. It runs your Python on each message that arrives:

```python
# payload arrives in degrees C, leaves in degrees F
msg['payload'] = msg['payload'] * 1.8 + 32
return msg
```

`msg` is a dict, with the main value in `msg['payload']`. Return it to pass it on, or return nothing to stop it. A
function node can also keep state between messages and have more than one output.

To reuse code across flows, make it a [custom node](custom-nodes.md). A custom node has its own place in the palette
and its own properties in the property panel. It can transform messages, act on them, or send them on a schedule.

You can also run Python directly on the board from the editor. See
[Commands and the Python prompt](debugging.md#commands-and-the-python-prompt).

## Running on the board

The board runs [MicroPython](background/micropython.md), a version of Python 3 made for microcontrollers. You install
it once, then Thingstudio adds a small runtime of its own on top.

When you click **Deploy**, the editor turns your flow into MicroPython code and compiles it. It sends the result to
the board over USB or WiFi, and the board swaps it in and starts running it. There's no firmware to flash, so
changing a flow and trying it again takes seconds. The board keeps the flow and runs it again after a restart.

## Built on standard parts

Thingstudio tries not to reinvent the wheel.

- MicroPython's [`asyncio`](https://docs.micropython.org/en/latest/library/asyncio.html) provides the event-driven
  primitives.
- Tried and tested libraries provide extra functionality and hardware drivers, such as Peter Hinch's
  [`mqtt_as`](https://github.com/peterhinch/micropython-mqtt) and
  [`micropython-async`](https://github.com/peterhinch/micropython-async), and drivers from
  [`micropython-lib`](https://github.com/micropython/micropython-lib).
- What comes out is plain MicroPython. You can read it in the editor's **Compiled source** panel.

## What you need

- A board with an ESP32 or RP2040/RP2350 processor. [Supported hardware](supported-hardware.md) lists what's been
  tested. Other boards that run MicroPython may work.
- A USB cable that carries data, not just power.
- Some knowledge of Python, enough to write a few lines.
- Some knowledge of electronics, enough to wire up an LED.

## Next

[Getting started](getting-started.md) lists the steps from a new board to a blinking LED, and starts you on the
first one.

The docs on [docs.thingstudio.net](https://docs.thingstudio.net/) follow the latest code. The docs inside Thingstudio
(**Help → User guide**) match the version you have installed.
