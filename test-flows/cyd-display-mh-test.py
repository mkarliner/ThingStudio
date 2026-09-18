#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/cyd-display-mh-test.py
#
# Follow-up to cyd-display-orientation-test.py. That script confirmed the
# color fix (BGR on, inversion off -- all 6 bars now render correctly,
# real photo 2026-09-18) but left text mirrored across all 4 MY/MX
# rotation-table candidates (0/1/2/3), unchanged. Since st7789py_mpy's
# _set_mem_access_mode() rotation table (read directly, not assumed)
# never sets the MH bit (Display Data Latch Order, MADCTL bit 0x04) --
# only MY/MX/MV -- and MH is a real, distinct MADCTL bit on some ST7789
# glass/FPC assemblies specifically for horizontal mirroring (separate
# from MX, column address order), this script bypasses the driver's
# buggy _set_mem_access_mode() wrapper entirely and writes MADCTL
# directly via display.write(), sweeping MH-inclusive combinations.
#
# Each candidate does a FRESH full redraw (not a MADCTL-only re-scan of
# stale GRAM, unlike the previous script) so there's no ambiguity about
# whether a result reflects the new setting cleanly.
#
# Run the same way (st7789py.py must already be on the board):
#   mpremote connect /dev/tty.usbserial-XXXX run \
#       test-flows/cyd-display-mh-test.py
#
# Watch for which candidate has upright, LEFT-TO-RIGHT readable
# "CYD 240x320" text (colors are already confirmed correct from the
# previous script -- this is purely about orientation now). Paste back
# which candidate label looked right, or if none did.

import gc
import time
import framebuf
from machine import Pin, SPI
import st7789py as st7789

SCK_PIN = 14
MOSI_PIN = 13
CS_PIN = 15
DC_PIN = 2
BACKLIGHT_PIN = 21

WIDTH = 240
HEIGHT = 320

# Raw MADCTL bits (device-runtime/src/vendor/st7789py_mpy/st7789py.py's
# own constants) -- BGR held on in every candidate (confirmed correct).
MY = 0x80
MX = 0x40
MV = 0x20
ML = 0x10
BGR = 0x08
MH = 0x04

gc.collect()

spi = SPI(2, baudrate=27_000_000, polarity=0, phase=0,
          sck=Pin(SCK_PIN), mosi=Pin(MOSI_PIN))
cs = Pin(CS_PIN, Pin.OUT, value=1)
dc = Pin(DC_PIN, Pin.OUT, value=0)
backlight = Pin(BACKLIGHT_PIN, Pin.OUT, value=1)

display = st7789.ST7789(
    spi, WIDTH, HEIGHT,
    reset=None, dc=dc, cs=cs, backlight=None,
    xstart=0, ystart=0,
)

print("initializing display (driver defaults, will override below)...")
display.init()
display.inversion_mode(False)
print("inversion_mode(False) applied")

WHITE = st7789.color565(255, 255, 255)
bar_colors = [
    ("RED", st7789.color565(255, 0, 0)),
    ("GREEN", st7789.color565(0, 255, 0)),
    ("BLUE", st7789.color565(0, 0, 255)),
    ("WHITE", WHITE),
    ("YELLOW", st7789.color565(255, 255, 0)),
    ("CYAN", st7789.color565(0, 255, 255)),
]
n_bars = len(bar_colors)
bar_height = HEIGHT // n_bars


def draw_frame():
    y = 0
    for i, (name, color) in enumerate(bar_colors):
        h = bar_height if i < n_bars - 1 else (HEIGHT - y)
        strip_buf = bytearray(WIDTH * h * 2)
        strip_fb = framebuf.FrameBuffer(strip_buf, WIDTH, h, framebuf.RGB565)
        strip_fb.fill(color)
        if i == 0:
            strip_fb.text("CYD 240x320", 8, 8, WHITE)
            strip_fb.text("test pattern", 8, 20, WHITE)
        if i == n_bars - 1:
            strip_fb.rect(30, 15, WIDTH - 60, max(h - 30, 4), WHITE)
        for j in range(0, len(strip_buf), 2):
            strip_buf[j], strip_buf[j + 1] = strip_buf[j + 1], strip_buf[j]
        display.blit_buffer(strip_buf, 0, y, WIDTH, h)
        del strip_buf, strip_fb
        gc.collect()
        y += h


candidates = [
    (BGR | MH, "BGR|MH"),
    (BGR | MH | MX, "BGR|MH|MX"),
    (BGR | MH | MY, "BGR|MH|MY"),
    (BGR | MH | MX | MY, "BGR|MH|MX|MY"),
]

for value, label in candidates:
    display.write(st7789.ST7789_MADCTL, bytes([value]))
    print("MADCTL = 0x%02X (%s) -- redrawing fresh frame" % (value, label))
    draw_frame()
    print("NOW SHOWING: %s" % label)
    time.sleep(5)

print("sweep done -- which candidate (if any) had upright, left-to-right text?")
print("paste back the label, plus this whole console output")
