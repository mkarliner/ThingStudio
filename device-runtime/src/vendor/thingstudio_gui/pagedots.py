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
            rr = r - 1 if r > 1 else r
            if i == current:
                # The active page is a pill: the full-radius circle plus a bar through it, staying inside the
                # gap between slots (2026-10-24).
                extra = max(1, diameter // 2)
                fb.ellipse(cx, cy, rr, rr, surface.fg, True)
                fb.fill_rect(cx - extra, cy - rr, 2 * extra + 1, 2 * rr + 1, surface.fg)
            else:
                fb.ellipse(cx, cy, rr, rr, surface.fg)

    return draw
