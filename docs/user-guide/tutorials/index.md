# Tutorials

[Getting started](../getting-started.md) ends with a blinking LED. The first two tutorials continue from it, each
starting from the flow the last one ends with. The MQTT tutorial starts a new flow, and the sensor display is a separate
project.

1. [Two more blinks](two-more-blinks.md) — the blink again, two more ways: one with the LED's state on the
   hardware, one keeping it in the `function` node with `context`.
2. [Blink from your network](blink-from-your-network.md) — the same LED, driven by an `http in` node arriving over
   WiFi: putting the board on your network, finding it again, and what an open port on the board means.
3. [Blink from anywhere](blink-from-anywhere.md) — the same LED through an MQTT broker: publishing from the board,
   subscribing to switch it, and why every topic carries a number of your own.
4. [A sensor display](../sensor-display.md) — read a sensor and show it on a touch display. It is a work in
   progress.

The finished flow for each tutorial is in the [examples folder](../examples.md#where-the-folder-is). Open it
with **File → Open…** rather than copying it from the page.

If you've built something past the tutorials, what worked and what stalled is a useful report: what you tried next,
and what happened. [File it on the issue tracker](https://github.com/mkarliner/ThingStudio/issues).
