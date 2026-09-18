# Minimal stand-in for MicroPython's `framebuf` module (a C extension on
# real hardware, unavailable in a plain CPython test process -- same
# "no MicroPython in this sandbox" constraint machine.py's own header
# documents). Added 2026-09-17 for the new display_i2c node's vendored
# driver, device-runtime/src/vendor/ssd1306/ssd1306.py, which subclasses
# `framebuf.FrameBuffer` (`class SSD1306(framebuf.FrameBuffer)`) purely to
# get a `.buffer` it manages itself -- SSD1306's own `show()`/write_data()
# push `self.buffer` to the bus directly, never call a drawing primitive
# on itself.
#
# Deliberately minimal: stores the wrapped buffer/width/height/format and
# nothing else. Real framebuf.FrameBuffer's drawing primitives (pixel,
# fill, hline, text, blit, ...) are NOT implemented here -- this project's
# display_spi/display_i2c nodes never call them (they push an
# already-rendered buffer built upstream, framebuffer-display-node-
# scoping.md's own "no drawing primitives" scope call), and no test here
# needs them. If a future function-node-based "draw with framebuf
# directly" test needs real pixel-level behavior, extend this mock then
# rather than guessing what's needed now.
MONO_VLSB = 0
MONO_HLSB = 1
MONO_HMSB = 2
RGB565 = 3
GS2_HMSB = 4
GS4_HMSB = 5
GS8 = 6


class FrameBuffer:
    def __init__(self, buffer, width, height, format_, stride=None):
        self.buffer = buffer
        self.width = width
        self.height = height
        self.format = format_
        self.stride = stride if stride is not None else width

    # fill() added 2026-09-17 -- ssd1306.py's own init_display() calls
    # `self.fill(0)` unconditionally as part of every display's setup
    # (not an optional drawing-primitive call a flow author opts into),
    # so display_i2c's tests can't construct a real SSD1306_I2C without
    # it. Implemented for MONO_VLSB only (the one format any vendored
    # driver here actually uses) -- a real fill() sets every pixel to
    # `col`, which for 1bpp MONO_VLSB (each byte = 8 vertically-stacked
    # pixels) is exactly "every byte 0x00 (col falsy) or 0xFF (col
    # truthy)", no per-pixel loop needed. Every other framebuf primitive
    # stays unimplemented -- see this file's header on why.
    def fill(self, col):
        if self.format != MONO_VLSB:
            raise NotImplementedError("pymock framebuf.FrameBuffer.fill() only implements MONO_VLSB")
        fill_byte = 0xFF if col else 0x00
        for i in range(len(self.buffer)):
            self.buffer[i] = fill_byte
