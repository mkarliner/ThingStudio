# Thingstudio

Thingstudio is a visual way to program microcontrollers. In your web browser, you drag boxes onto a canvas and join
them with lines, in the style of [Node-RED](https://nodered.org/). Thingstudio turns the result into
[MicroPython](https://micropython.org/), a version of Python for microcontrollers, and sends it to your board. The
board then runs it on its own, with no computer attached.

!!! tip "Already know the background?"
    If you know Node-RED, MicroPython and event-driven code, skip to what's different:
    [coming from Node-RED](coming-from/node-red.md), [coming from MicroPython](coming-from/micropython.md) or
    [coming from Arduino and C](coming-from/arduino.md). Or go straight to [Getting started](getting-started.md).

## Programs that react

Most microcontroller programs are one big loop. Read the sensors, check the buttons, update the outputs, go round
again. It works, but every new job makes the loop longer and its timing harder to reason about.

Thingstudio programs are a set of reactions instead. When the button is pressed, turn on the light. Every ten
seconds, read the temperature. When a message arrives from the network, update the display. Nothing runs until
something happens, and many reactions can be waiting at once. This is
[event-driven programming](background/event-driven.md).

## Reactions as nodes and wires

Each reaction is drawn as a small chain of **nodes**. A node does one job: fire every second, read a pin, run some
Python, switch an output. **Wires** join one node's output to the next node's input. Together they make a **flow**.

Nodes pass **messages** along the wires. A message is a small bundle of data, with the main value in its
`payload`. A timer sends a message, a function node changes its payload, and a pin output node acts on it. More on
this in [flows, nodes and messages](background/flows-and-nodes.md).

This way of working comes from [Node-RED](background/node-red.md), a popular tool for home automation and IoT. In
Node-RED, flows run on a server or a Raspberry Pi. In Thingstudio, they run on the microcontroller.

## Running on the board

The board runs [MicroPython](background/micropython.md), a version of Python 3 made for microcontrollers. You install
it once, then Thingstudio adds a small runtime of its own on top.

When you click **Deploy**, the editor turns your flow into MicroPython code and compiles it. It sends the result to
the board over USB or WiFi, and the board swaps it in and starts running it. There's no firmware to flash, so
changing a flow and trying it again takes seconds. The board keeps the flow and runs it again after a restart.

## Where your own code goes

Nodes cover the common jobs: timers, pins, displays, sensors, WiFi, MQTT, HTTP. For anything else there's the
**function** node, which runs a few lines of your own Python on each message:

```python
msg['payload'] = msg['payload'] * 1.8 + 32
return msg
```

When you find yourself writing the same function node twice, you can make it a node of its own. See
[writing custom nodes](custom-nodes.md). And you can still reach the board's Python prompt from the editor at any
time.

## What you need

- A board with an ESP32-family or RP2040/RP2350 chip. See [boards and processors](boards.md).
- A USB cable that carries data, not just power.
- Enough Python to write a few lines, and enough electronics to wire an LED.

## Next

1. [Install MicroPython](installing-micropython.md) on your board, if it doesn't have it yet.
2. [Get started](getting-started.md): install Thingstudio and connect your board.
3. [Blink an LED](first-flow.md): your first flow.

These docs follow the latest code. The copy inside Thingstudio (the **Docs** button) matches the version you have
installed.
