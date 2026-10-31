# Tutorials

Two tutorials, each one starting from the flow the last one left you with. [Getting started](../getting-started.md)
ends with a blinking LED; the first tutorial picks up from that flow.

1. [Read and set a pin](read-and-set-a-pin.md) — the function node reads the LED's pin and writes back the opposite
   of what it finds, in your own MicroPython; then it keeps the state in the node with `context`.
2. Blink from your network — the same LED, driven by an `http in` node arriving over WiFi: putting the board on
   your network, finding it again, and what an open port on the board means.

More are coming, in this order: publish and subscribe over MQTT, then pages for whatever the first users got stuck
on. If you've gone ahead of the tutorials and built something of your own, what worked and what stalled is the most
useful report you can send: what you tried next, and what happened —
[file it on the issue tracker](https://github.com/mkarliner/ThingStudio/issues).
