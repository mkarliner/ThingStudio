# The tutorial ladder

Five tutorials, each one starting from the flow the last one left you with. [Getting started](../getting-started.md)
ends with a blinking LED; the ladder picks up from there, one concept at a time, and you always have a flow that
runs.

1. [More blinking](more-blinking.md) — change the blink's speed, swap which half of it is lit, and read the LED's
   pin instead of counting.
2. Function and the pin — make the function node do all the work: read the pin and write the opposite, in your own
   MicroPython, and what the pin checker can and can't see.
3. Where the state lives — keep the LED's state in the function node with `context`, and meet the `change` node,
   which does it without code.
4. Blink from your network — drive the same flow over WiFi: connecting the board to your network, finding it
   again, and what an open port means on it.
5. Publish and subscribe — the same flow talking over MQTT, the way several devices and tools already speak to
   each other.

Tutorials 2–5 are being written now, in this same order. If you've gone ahead of them and built something of your
own, what worked and where it stalled is the most useful report you can send: what you tried next after a tutorial,
and what happened — [file it on the issue tracker](https://github.com/mkarliner/ThingStudio/issues).
