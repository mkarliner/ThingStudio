# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/trend.py -- on the board: tsgui_trend.py
#
# A row of columns, oldest on the left, newest on the right, between lo and hi (clamped): a moving histogram.
# It draws what a journal node sends (an object with rows, n, head and the avg/lo/hi rings: each column is a bar
# up to the average, with a thin line from the row's min to its max), or any plain list of numbers (None is a
# gap), so a spectrum from a function node draws the same way. A gap (an unknown row, or None) is left empty.
# Unknown (no value yet): a dashed outline. Stale: dim bars, or every other column on mono. It shows the last
# (width - 4) // col_width rows, so a wider rect shows more history.

_NAN = float("nan")


def natural(columns=60, col_width=3, height=48):
    return (columns * col_width + 4, height)


def _dashed_rect(fb, x, y, w, h, c):
    for i in range(x, x + w, 3):
        fb.pixel(i, y, c)
        fb.pixel(i, y + h - 1, c)
    for j in range(y, y + h, 3):
        fb.pixel(x, j, c)
        fb.pixel(x + w - 1, j, c)


def _rows(value):
    """(count, get): get(i) is (avg, lo, hi) for the i-th oldest row."""
    if hasattr(value, "avg"):
        n = value.n
        rows = value.rows
        start = (value.head - n) % rows

        def get(i):
            k = (start + i) % rows
            return value.avg[k], value.lo[k], value.hi[k]

        return n, get

    def get_plain(i):
        v = value[i]
        if v is None:
            return _NAN, _NAN, _NAN
        v = float(v)
        return v, v, v

    return len(value), get_plain


def make(lo=0.0, hi=100.0, col_width=3):
    if hi <= lo:
        raise ValueError("trend needs hi > lo, got lo=%r hi=%r" % (lo, hi))
    if col_width < 1:
        raise ValueError("trend col_width must be 1 or more, got %r" % (col_width,))
    span = hi - lo

    def px(v, inner_h):
        frac = (v - lo) / span
        frac = 0.0 if frac < 0 else 1.0 if frac > 1 else frac
        return int(inner_h * frac + 0.5)

    def draw(surface, rect, value, state):
        fb = surface.fb
        x, y, w, h = rect
        if state == 0:
            _dashed_rect(fb, x, y, w, h, surface.fg)
            return
        fb.rect(x, y, w, h, surface.fg)
        try:
            n, get = _rows(value)
            first_row = get(0) if n else None  # raises on a value that isn't a series or a list
            if first_row is not None and len(first_row) != 3:
                raise TypeError
        except (TypeError, AttributeError, IndexError, ValueError):
            raise ValueError("trend value must be a series or a list of numbers, got %r" % (value,))
        inner_w = w - 4
        inner_h = h - 4
        cols = inner_w // col_width
        if cols < 1 or inner_h < 1 or n == 0:
            return
        shown = n if n < cols else cols
        first = n - shown
        base = y + h - 2
        right = x + w - 2
        bar_w = col_width - 1 if col_width > 1 else 1
        colour = surface.accent_for(state)
        hatched = state == 2 and not surface.shades
        for j in range(shown):
            a, lo_v, hi_v = get(first + j)
            if a != a:
                continue
            if hatched and j % 2:
                continue
            cx = right - (shown - j) * col_width
            bar = px(a, inner_h)
            if bar > 0:
                fb.fill_rect(cx, base - bar, bar_w, bar, colour)
            if lo_v == lo_v and hi_v == hi_v:
                top = px(hi_v, inner_h)
                bottom = px(lo_v, inner_h)
                if top > bottom:
                    fb.vline(cx + bar_w // 2, base - top, top - bottom + 1, surface.fg)

    return draw
