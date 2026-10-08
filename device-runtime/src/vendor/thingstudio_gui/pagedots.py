# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/pagedots.py -- on the board: tsgui_pagedots.py
#
# Page indicator: one dot per top-level page of its display, the current one filled. Not bound to a value:
# a page change repaints the screen, so it's always current.


def natural(pages, diameter=6, gap=4):
    return (pages * diameter + max(0, pages - 1) * gap, diameter)


def make(diameter=6, gap=4):
    r = diameter // 2

    def draw(surface, rect, value, state):
        fb = surface.fb
        x, y, w, h = rect
        current, count = surface.page_info()
        total = count * diameter + max(0, count - 1) * gap
        left = x + max(0, (w - total) // 2)
        cy = y + h // 2
        for i in range(count):
            cx = left + i * (diameter + gap) + r
            fb.ellipse(cx, cy, r - 1 if r > 1 else r, r - 1 if r > 1 else r, surface.fg, i == current)

    return draw
