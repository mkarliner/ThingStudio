# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_gui_bands.py
#
# Banded rendering (vendor/thingstudio_gui/gui.py, BandSurface) under the real MicroPython unix port: a screen
# drawn strip by strip, the strips laid back together, is byte-identical to the same screen drawn into one full
# framebuffer -- in 4-bit grey and mono, with widgets that cross strip boundaries. And after a value changes,
# only the strips that widget crosses are sent again. Found needed on a CYD, 2026-10-08: a 38,400-byte gs4
# frame couldn't be allocated on a fragmented heap; a 40-row strip is 4,800 bytes.

import sys

import framebuf

import minitest

minitest.add_src_to_path()
_SRC = sys.path[0]
sys.path.insert(0, _SRC + "/vendor/thingstudio_gui")
sys.path.insert(0, _SRC + "/vendor/fonts")

try:
    import asyncio
except ImportError:
    import uasyncio as asyncio

import bar  # noqa: E402
import font_body16  # noqa: E402
import font_digits48  # noqa: E402
import gui  # noqa: E402
import label  # noqa: E402
import led  # noqa: E402
import readout  # noqa: E402

W, H = 240, 320
FORMATS = ((framebuf.GS4_HMSB, (W + 1) // 2), (framebuf.MONO_HMSB, (W + 7) // 8))


def _widgets(g):
    g.widget("title", label.make(font_body16, "Living room"))
    g.widget("temp", readout.make(font_digits48, font_body16, "C", 1, -20, 50), 1000)
    g.widget("pbar", bar.make(950, 1050))
    g.widget("alive", led.make(14))


# Rects deliberately straddle strip edges (rows 40, 80, 120 with 40-row strips).
PAGES = {"home": {"parent": None, "widgets": [
    ("title", (4, 30, 200, 17)), ("temp", (4, 70, 230, 48)), ("pbar", (4, 115, 232, 12)), ("alive", (220, 36, 14, 14))]}}


def _full(fmt, stride):
    g = gui.GUI()
    _widgets(g)
    buf = bytearray(stride * H)
    fb = framebuf.FrameBuffer(buf, W, H, fmt)
    g.add_surface(gui.FrameSurface("tft", fb, lambda f: None, PAGES, ["home"], fmt=fmt))
    g.set_value("temp", 21.4, now=0)
    g.set_value("pbar", 1013, now=0)
    g.set_value("alive", True, now=0)
    g.step(now=0)
    return buf


def _banded(fmt, stride):
    g = gui.GUI()
    _widgets(g)
    s = g.add_surface(gui.BandSurface("tft", W, H, fmt, PAGES, ["home"], band_rows=40, stride=stride, min_interval_ms=0))
    g.set_value("temp", 21.4, now=0)
    g.set_value("pbar", 1013, now=0)
    g.set_value("alive", True, now=0)
    screen = bytearray(stride * H)
    sent = []

    async def collect(n):
        for _ in range(n):
            y, rows = await s.next_band()
            screen[y * stride:(y + rows) * stride] = s.band_buf[:rows * stride]
            sent.append(y)

    asyncio.run(collect(8))  # 320 / 40 strips
    return g, s, screen, sent, collect


def test_strips_add_up_to_the_full_frame():
    for fmt, stride in FORMATS:
        full = _full(fmt, stride)
        _, _, screen, sent, _ = _banded(fmt, stride)
        assert sent == [0, 40, 80, 120, 160, 200, 240, 280], sent
        assert screen == full, "format %d: banded frame differs from the full one" % fmt


def test_only_strips_a_changed_widget_crosses_are_sent_again():
    g, s, screen, sent, collect = _banded(*FORMATS[0])
    del sent[:]
    g.set_value("temp", -5.0)  # rows 70..117: strips 40 and 80
    asyncio.run(collect(2))
    assert sent == [40, 80], sent


def test_a_strip_is_far_smaller_than_a_frame():
    s = gui.BandSurface("tft", W, H, framebuf.GS4_HMSB, PAGES, ["home"], band_rows=40, stride=120)
    assert len(s.band_buf) == 4800


def test_full_colour_strips_are_big_endian_on_the_wire_and_use_the_accent():
    # framebuf.RGB565 stores a pixel little-endian but an SPI panel wants big-endian: the screen node passes
    # byte-swapped colour constants, so the strip bytes are already in wire order. A light that is on and a
    # bar's fill are drawn in the accent (0x3EF1); text is white; the background stays black.
    stride = W * 2
    colours = (0xFFFF, 0x2C63, 0x0000, 0xF13E)  # fg, dim, bg, accent -- each byte-swapped, as the editor writes them
    g = gui.GUI()
    _widgets(g)
    s = g.add_surface(gui.BandSurface("tft", W, H, framebuf.RGB565, PAGES, ["home"], band_rows=8, stride=stride, min_interval_ms=0, colours=colours))
    g.set_value("temp", 21.4, now=0)
    g.set_value("pbar", 1013, now=0)
    g.set_value("alive", True, now=0)
    screen = bytearray(stride * H)

    async def collect():
        for _ in range(H // 8):
            y, rows = await s.next_band()
            screen[y * stride:(y + rows) * stride] = s.band_buf[:rows * stride]

    asyncio.run(collect())

    def px(x, y):
        o = y * stride + x * 2
        return bytes(screen[o:o + 2])

    assert px(227, 43) == b"\x3e\xf1", px(227, 43)  # centre of the light that is on: accent, high byte first
    assert px(5, 5) == b"\x00\x00"
    bar_row = 115 + 6
    assert px(10, bar_row) == b"\x3e\xf1"  # inside the bar's fill
    assert b"\xff\xff" in bytes(screen[70 * stride:118 * stride])  # the readout's digits are white
    assert len(s.band_buf) == 8 * stride == 3840


minitest.run([test_strips_add_up_to_the_full_frame, test_only_strips_a_changed_widget_crosses_are_sent_again, test_a_strip_is_far_smaller_than_a_frame, test_full_colour_strips_are_big_endian_on_the_wire_and_use_the_accent])
