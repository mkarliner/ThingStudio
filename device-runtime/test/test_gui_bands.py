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


minitest.run([test_strips_add_up_to_the_full_frame, test_only_strips_a_changed_widget_crosses_are_sent_again, test_a_strip_is_far_smaller_than_a_frame])
