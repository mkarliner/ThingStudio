# neopixel

Drives a WS2812 / NeoPixel strip: sets the pixels from each message and writes. Uses MicroPython's built-in
`neopixel` module. Pin numbers are checked against your [board](../boards.md).

## Properties

- **pin** — the strip's data pin.
- **count** — how many pixels.
- **order** — the wire colour order of your strip: `GRB` (most WS2812), `RGB`, `RGBW` or `GRBW`.

## Wiring

**Input** — a colour, or a set of them:

```python
msg = {'payload': 0xff4400, 'topic': ''}                         # the whole strip
msg = {'payload': [0xff0000, 0x00ff00, 0x0000ff], 'topic': ''}   # one colour per pixel
msg = {'payload': {'index': 2, 'colour': 0x00ff00}, 'topic': ''} # one pixel
```

A colour is a 24-bit `0xRRGGBB` (red, green, blue, 0–255 each). An `RGBW` or `GRBW` strip takes a 32-bit
`0xWWRRGGBB` for the white channel; a plain `0xRRGGBB` leaves white off.

## Behavior

The whole strip is written on every message, so the last message sets the colours. The node has no output.

Two `neopixel` nodes on the same pin share one strip, so they must have the same count and order, or the compile
stops. See [Hardware is shared](index.md#hardware-is-shared).
