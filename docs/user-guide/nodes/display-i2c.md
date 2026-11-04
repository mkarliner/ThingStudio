# display i2c

Shows a frame on an I2C monochrome OLED panel. The frame is drawn upstream, usually in a
[function](function.md) node with `framebuf`. [Supported hardware](../supported-hardware.md#displays) lists the
display chips.

## Properties

The property panel's **preset** picker saves a panel's setup under a name and loads it on another node (see
[Presets](../working-in-the-editor.md#presets)).

- **controller** — the display chip. Default `SSD1306`.
- **I2C bus** — the bus the panel is wired to. Required. See [I2C bus](i2c-bus.md).
- **address** — the I2C address, 0 to 127. Default `0x3C`, the usual SSD1306 address. In the flow file `addr`, a plain
  number: `60` is `0x3C`.
- **width (px)** — default 128.
- **height (px, multiple of 8)** — default 64.

A flow saved before I2C bus settings existed has its pins on the node. The editor moves them into an I2C bus when it
opens the flow; save the flow to keep the change.

## Wiring

**Input** — `payload` is the frame: a `MONO_VLSB` buffer of exactly `width * height / 8` bytes, `bytes` or
`bytearray`, as `framebuf.FrameBuffer` makes for a 1-bit surface. Send the buffer, not the `FrameBuffer` object.

This node has no output.

## Behavior

Each message replaces the whole picture. The node only shows frames; it has no drawing of its own.

`framebuf`'s `text()` draws a fixed 8x8 font, so a 128x64 panel holds 16 characters on each of 8 lines. This
function node draws a temperature from a [bme280](bme280.md) and sends the frame:

```python
import framebuf
buf = context.get('buf')
if buf is None:
    buf = bytearray(128 * 8)
    context.set('buf', buf)
fb = framebuf.FrameBuffer(buf, 128, 64, framebuf.MONO_VLSB)
fb.fill(0)
fb.text('%.1f C' % msg['payload']['temperature'], 0, 28, 1)
msg['payload'] = buf
return msg
```

A panel can share a bus with a sensor, at the bus's one clock; the default 100000 Hz suits both.

## Errors

- **A frame of the wrong size.** The console shows a `[NODE_ERROR]` naming this node and
  `display_i2c: expected 1024 bytes (128x64 MONO_VLSB), got 1000`. See
  [Reading a node error](../debugging.md#reading-a-node-error).
- **No I2C bus, or an address over 127.** Deploy stops and says which.
