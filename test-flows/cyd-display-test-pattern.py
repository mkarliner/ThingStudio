#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/cyd-display-test-pattern.py
#
# Visual confirmation test for CYD's display controller-variant question
# (docs/working-notes/cyd-touch-gui-flash-budget-briefing.md item 1).
# Pushes a real frame through the ALREADY-VENDORED st7789py_mpy driver
# (device-runtime/src/vendor/st7789py_mpy/st7789py.py, proven on TiDAL)
# directly to the CYD panel, using framebuf.FrameBuffer + the manual
# RGB565 byte-swap -- same pipeline display_spi's real codegen uses
# (docs/working-notes/framebuffer-st7789-display-briefing.md's "Lessons
# from the TiDAL session", item 4: "Applies identically to ILI9341 or any
# other controller ... not a fresh investigation, just do the swap").
#
# 2026-09-18: first version allocated one 240x320x2 = 153600-byte
# contiguous framebuf for the whole screen at once -- MemoryError on real
# hardware (classic ESP32, not S3): "memory allocation failed, allocating
# 153600 bytes". TiDAL's panel is 135x240 = 64800 bytes, well under
# whatever this board's actual free/contiguous heap turns out to be;
# CYD's larger 240x320 panel is not. Rewritten below to build and push
# one color-bar strip at a time (~25KB each) instead of one full-frame
# buffer -- real, on-hardware evidence relevant to item 4's flash/memory
# budget concerns and the "full-frame-only contract" question flagged in
# framebuffer-display-node-scoping.md's LVGL section: a single-shot full
# frame buffer may not always fit as a naive assumption, at least not on
# every board this project targets, independent of the LVGL question.
#
# Why this test, not just the ID-register probe
# (test-flows/cyd-controller-id-probe.py): register reads on real CYD
# units are known-unreliable (an independent CYD diagnostic tool doesn't
# even attempt automatic ID detection -- see the briefing). A clean,
# correctly-colored render through a specific driver is the strongest
# evidence this project can get without a datasheet in hand -- garbled
# colors, an offset image, or a blank screen are all informative too.
#
# Current working hypothesis (NOT yet driver-confirmed): ST7789(V), based
# on three independent signals gathered this session -- see the briefing's
# item 1 for the full trail. This script is exactly the test that would
# turn "hypothesis" into "confirmed."
#
# Requires st7789py.py already copied to the board's filesystem (it's a
# real import, not inlined -- mirrors how display_spi's own codegen will
# actually use it):
#
#   mpremote connect /dev/tty.usbserial-XXXX fs cp \
#       device-runtime/src/vendor/st7789py_mpy/st7789py.py :st7789py.py
#   mpremote connect /dev/tty.usbserial-XXXX run \
#       test-flows/cyd-display-test-pattern.py
#
# Pins: mischianti.org's documented values (same ones
# cyd-controller-id-probe.py used, and confirmed against an independent
# CYD diagnostic tool's own pinout) -- MISO=12, MOSI=13, SCK=14, CS=15,
# DC=2, backlight=21. RST is tied high in hardware (no GPIO) -- passed as
# reset=None, which st7789py.py's own reset_low()/reset_high() already
# guard with `if self.reset:` (confirmed by reading the driver, not
# assumed -- same as framebuffer-display-node-scoping.md flagged).
#
# xstart/ystart explicitly 0, 0 -- st7789py.py's built-in offset table
# only covers 240x240 and 135x240 (raises ValueError otherwise), so CYD's
# 240x320 has no auto default; 0,0 is the standard no-offset guess for a
# panel at its native resolution, unverified until this actually renders
# cleanly.
#
# Backlight polarity is UNCONFIRMED for CYD (the briefing flags this as a
# real risk, not a formality -- TiDAL's was active-low, contradicting
# display_spi's hardcoded active-high default). This script tries
# active-high first. If the screen stays dark despite no errors, that's
# the signal to retry with backlight.value(0) instead of assuming
# something else is wrong.
#
# What to look for, paste back what you actually see:
#   - 6 solid color bars, top to bottom: RED, GREEN, BLUE, WHITE, YELLOW,
#     CYAN -- each should be its named color, not shifted (e.g. RED
#     showing as BLUE is the classic RGB/BGR order symptom; WHITE showing
#     as BLACK or vice versa is the classic inversion symptom).
#   - White "CYD 240x320" text near the top of the RED bar.
#   - A white rectangle OUTLINE (not filled -- deliberately different
#     from TiDAL's filled circle) near the bottom, in the CYAN bar.
#   - Whether the image fills the whole screen with no black margin/crop
#     (a margin would point at the xstart/ystart GRAM-offset guess being
#     wrong) and whether it's right-side up / not mirrored.
#   - Whether the 6 bars are seamless (no visible gap/misalignment between
#     strips -- would indicate a windowing bug in the chunked push, not a
#     controller-identity issue).

import gc
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
print("free mem before init:", gc.mem_free())

spi = SPI(2, baudrate=27_000_000, polarity=0, phase=0,
          sck=Pin(SCK_PIN), mosi=Pin(MOSI_PIN))
cs = Pin(CS_PIN, Pin.OUT, value=1)
dc = Pin(DC_PIN, Pin.OUT, value=0)
backlight = Pin(BACKLIGHT_PIN, Pin.OUT, value=1)  # active-high guess -- see header

display = st7789.ST7789(
    spi, WIDTH, HEIGHT,
    reset=None,          # RST tied high in hardware, no GPIO
    dc=dc, cs=cs, backlight=None,   # backlight handled by our own Pin above,
                                     # not the driver -- matches display_spi's
                                     # real design (a separate gpio_out node
                                     # drives backlight on TiDAL; doing the
                                     # same here rather than assuming the
                                     # driver's own backlight handling is
                                     # right for CYD's polarity)
    xstart=0, ystart=0,
)

print("initializing display...")
display.init()
print("init done -- building + pushing test frame, one strip at a time")

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

y = 0
for i, (name, color) in enumerate(bar_colors):
    h = bar_height if i < n_bars - 1 else (HEIGHT - y)  # last strip takes any remainder
    strip_buf = bytearray(WIDTH * h * 2)
    strip_fb = framebuf.FrameBuffer(strip_buf, WIDTH, h, framebuf.RGB565)
    strip_fb.fill(color)

    if i == 0:
        strip_fb.text("CYD 240x320", 8, 8, WHITE)
        strip_fb.text("test pattern", 8, 20, WHITE)

    if i == n_bars - 1:
        # Outline rectangle, deliberately NOT a filled circle -- can't be
        # mistaken for a stale TiDAL render.
        strip_fb.rect(30, 15, WIDTH - 60, max(h - 30, 4), WHITE)

    # The byte-swap lesson from TiDAL, applied identically here, per-strip.
    for j in range(0, len(strip_buf), 2):
        strip_buf[j], strip_buf[j + 1] = strip_buf[j + 1], strip_buf[j]

    display.blit_buffer(strip_buf, 0, y, WIDTH, h)
    print("pushed %-6s strip: y=%d h=%d" % (name, y, h))

    del strip_buf, strip_fb
    gc.collect()
    y += h

print("done -- describe what's actually on screen and paste this whole output")
