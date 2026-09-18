#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/cyd-display-orientation-test.py
#
# Follow-up to cyd-display-test-pattern.py, after a real photo of that
# script's output on Mike's CYD unit (2026-09-18) let us solve the color
# mismatch exactly: working backward through all 6 bars (BGR channel
# swap, then full inversion) predicts every observed hue with no
# mismatches -- RED->observed olive/yellow, GREEN->observed
# purple/magenta, BLUE->observed cyan, WHITE->observed black,
# YELLOW->observed red, CYAN->observed blue. All six independently
# confirm the same two-parameter fix. st7789py_mpy's ST7789.init()
# hardcodes is_bgr=False and inversion_mode(True) -- both tuned for
# TiDAL's specific panel, both wrong for this one: needs BGR order and
# inversion OFF.
#
# The same photo also showed the header text mirrored -- a second, R
# separate bug from the same root cause: that init() ALSO hardcodes
# vert_mirror=True, horz_mirror=True in its _set_mem_access_mode() call,
# which (per the driver's own logic -- read, not assumed: vert_mirror
# being true short-circuits past the rotation-derived value entirely)
# discards the rotation value and just sets the ML bit. Another
# TiDAL-specific choice, not a general default.
#
# NOT editing the vendored st7789py.py file itself -- this project's
# vendoring convention is pinned-commit + hash-verified, so the fix
# belongs in how display_spi's eventual codegen CALLS the driver
# (rotation/mirror/BGR as real node properties, not baked into one
# hardcoded init() path), not in the vendored source. This script proves
# out the right values by calling the driver's own public methods
# directly after init(), the same thing correct codegen would do.
#
# MADCTL affects how already-written GRAM is scanned out to the panel --
# confirmed by reading the ST77xx command set (MADCTL is a real-time
# addressing-order register, not a one-shot init flag) -- so this script
# draws the test frame ONCE, then cycles through 4 orientation candidates
# by changing MADCTL alone, ~4s each, without re-pushing pixel data. BGR
# color order + inversion-off are held constant across all 4 (already
# confirmed from the photo); only rotation/mirror varies.
#
# Deliberately NOT trying the MV-family rotations (4-7, TiDAL's own
# family) here -- those swap the controller's row/column addressing,
# which would conflict with this script's fixed WIDTH=240/HEIGHT=320
# CASET/RASET windowing (self.width/self.height are never swapped by
# st7789py_mpy when MADCTL changes) and could produce a genuinely
# corrupted-looking result that's a windowing artifact, not new
# orientation information. 0-3 (MY/MX combinations only) keep width and
# height semantics fixed and just mirror axes -- the safe set to try
# first for a panel already confirmed to be native portrait at 240x320.
#
# Run the same way as cyd-display-test-pattern.py (st7789py.py must
# already be on the board):
#   mpremote connect /dev/tty.usbserial-XXXX run \
#       test-flows/cyd-display-orientation-test.py
#
# Watch the screen and note which candidate (printed to console as it's
# shown) has upright, left-to-right-readable "CYD 240x320" text and a
# RED bar at the top -- paste back which one, plus this script's console
# output.

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

# --- the confirmed fix: inversion off, BGR on ---
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

print("drawing test frame once (MADCTL changes below don't need a redraw)...")
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

print("frame drawn -- cycling orientation candidates, ~4s each")
print("(BGR on, inversion off held constant in every candidate below)")

candidates = [
    (0, False, False, "identity (no mirror)"),
    (1, False, False, "MX (horizontal mirror)"),
    (2, False, False, "MY (vertical mirror)"),
    (3, False, False, "MX|MY (180 degree rotate)"),
]

for rotation, vm, hm, label in candidates:
    display._set_mem_access_mode(rotation, vm, hm, True)  # is_bgr=True
    print("NOW SHOWING: rotation=%d (%s)" % (rotation, label))
    time.sleep(4)

print("cycle done -- which candidate had upright, left-to-right text and RED on top?")
print("paste back the label, plus this whole console output")
