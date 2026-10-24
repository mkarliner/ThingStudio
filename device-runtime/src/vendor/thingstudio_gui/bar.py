# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/bar.py -- on the board: tsgui_bar.py
#
# Horizontal bar: an outline, filled from the left in proportion to the value between lo and hi (clamped).
# Unknown: a dashed outline, no fill. Stale: dim fill, or a hatched fill on mono. Usually grows to its rect.
#
# Segments (2026-10-24): square cells with small gaps instead of one outline, lit cells in the accent and the
# rest in the track. Same value, same range; "solid" is the old drawing, unchanged.

def natural(min_width=40, height=12):
    return (min_width, height)


def _dashed_rect(fb, x, y, w, h, c):
    for i in range(x, x + w, 3):
        fb.pixel(i, y, c)
        fb.pixel(i, y + h - 1, c)
    for j in range(y, y + h, 3):
        fb.pixel(x, j, c)
        fb.pixel(x + w - 1, j, c)


def _fraction(value, lo, span):
    try:
        frac = (float(value) - lo) / span
    except (TypeError, ValueError):
        raise ValueError("bar value must be a number, got %r" % (value,))
    return 0.0 if frac < 0 else 1.0 if frac > 1 else frac


def make(lo=0.0, hi=100.0, style="solid", segments=10):
    if hi <= lo:
        raise ValueError("bar needs hi > lo, got lo=%r hi=%r" % (lo, hi))
    span = hi - lo
    if style == "segments":
        return _segmented(lo, span, max(1, int(segments)))

    def draw(surface, rect, value, state):
        fb = surface.fb
        x, y, w, h = rect
        if state == 0:
            _dashed_rect(fb, x, y, w, h, surface.fg)
            return
        fb.rect(x, y, w, h, surface.fg)
        frac = _fraction(value, lo, span)
        fill = int((w - 4) * frac + 0.5)
        if fill <= 0:
            return
        if state == 2 and not surface.shades:
            for i in range(x + 2, x + 2 + fill, 2):
                fb.vline(i, y + 2, h - 4, surface.fg)
        else:
            fb.fill_rect(x + 2, y + 2, fill, h - 4, surface.accent_for(state))

    return draw


def _segmented(lo, span, segments):
    def draw(surface, rect, value, state):
        fb = surface.fb
        x, y, w, h = rect
        if state == 0:
            _dashed_rect(fb, x, y, w, h, surface.fg)
            return
        frac = _fraction(value, lo, span)
        gap = 2
        cell = max(1, (w - (segments - 1) * gap) // segments)
        lit = int(frac * segments + 0.5)
        track = surface.theme.get("track", surface.dim)
        for i in range(segments):
            colour = surface.accent_for(state) if i < lit else track
            fb.fill_rect(x + i * (cell + gap), y, cell, h, colour)

    return draw
