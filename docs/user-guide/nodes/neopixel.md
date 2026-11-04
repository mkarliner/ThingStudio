# neopixel

Lights a WS2812 (NeoPixel) strip: sets its pixels from each message, then writes the strip.

## Properties

- **pin** — the strip's data pin. Default 13.
- **count** — how many pixels the strip has. Default 8. Must be 1 or more.
- **order** — the color order of your strip: `GRB`, `RGB`, `RGBW` or `GRBW`. Default `GRB`, which most WS2812
  strips use. The `W` orders are for strips with a white channel.

## Wiring

**Input** — `payload` in one of three forms:

```python
msg['payload'] = 0xff4400                            # one color for the whole strip
msg['payload'] = [0xff0000, 0x00ff00, 0x0000ff]      # one color per pixel, from the first
msg['payload'] = {'index': 2, 'colour': 0x00ff00}    # one pixel; 'color' works too
```

A color is `0xRRGGBB`, 0 to 255 for each of red, green and blue. A strip with a white channel takes
`0xWWRRGGBB`; a plain `0xRRGGBB` leaves white off. A list shorter than the strip leaves the other pixels as they
were; one longer than the strip is cut off.

This node has no output.

## Behavior

Each message sets the pixels it names and writes the whole strip. Pixels a message doesn't name keep their color.

## Errors

- **A payload that isn't a color**, or an index past the end of the strip. The node's status dot turns red with the
  error, and nothing is written. See [Node status](../working-in-the-editor.md#node-status).
- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
