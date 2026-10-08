# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/readout.py -- on the board: tsgui_readout.py
#
# Numeric readout with units: a big number in a digits font, right-aligned in a field wide enough for any
# value from lo to hi at `decimals` places (each digit counted at the widest digit's width, so "11.1" can't
# be narrower than its field and "88.8" can't overflow it), then the units in a body font, sharing the number's
# baseline. A value outside lo..hi still shows, clipped to the field. Unknown: "--". Stale: dimmed, or a dotted underline on mono. Natural size matches the editor's
# measure (editor/src/gui/widgets.ts).

UNKNOWN_TEXT = "--"
DIGITS = "0123456789"


def _width(font, s):
    return sum(font.get_ch(c)[2] for c in s)


def _field(font, lo, hi, decimals):
    """Width of the widest formatted value in lo..hi: digits at the widest digit's width, others as drawn."""
    dw = max(font.get_ch(c)[2] for c in DIGITS)
    fmt = "%%.%df" % decimals
    best = 0
    for v in (lo, hi):
        w = 0
        for c in fmt % v:
            w += dw if c in DIGITS else font.get_ch(c)[2]
        best = max(best, w)
    return max(best, _width(font, UNKNOWN_TEXT))


def _units_offset(font, units_font):
    return max(0, font.baseline() - units_font.baseline())


def natural(font, units_font=None, units="", decimals=1, lo=-99, hi=999, gap=4):
    w = _field(font, lo, hi, decimals)
    h = font.height()
    if units:
        w += gap + _width(units_font, units)
        h = max(h, _units_offset(font, units_font) + units_font.height())
    return (w, h)


def make(font, units_font=None, units="", decimals=1, lo=-99, hi=999, gap=4):
    if units and units_font is None:
        raise ValueError("readout with units needs a units font")
    if hi < lo:
        raise ValueError("readout needs hi >= lo, got lo=%r hi=%r" % (lo, hi))
    fmt = "%%.%df" % decimals
    field = _field(font, lo, hi, decimals)
    nat_h = natural(font, units_font, units, decimals, lo, hi, gap)[1]

    def draw(surface, rect, value, state):
        x, y, w, h = rect
        if state == 0:
            s = UNKNOWN_TEXT
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            s = fmt % value
        else:
            s = str(value)
        colour = surface.colour_for(state)
        top = y + max(0, (h - nat_h) // 2)
        sx = x + max(0, field - _width(font, s))
        surface.text(font, s, sx, top, colour, x + min(field, w))
        if state == 2 and not surface.shades:
            # Just below the baseline, but never outside the rect (a font with no descent has no room below).
            surface.stale_mark(sx, min(top + font.baseline() + 1, y + h - 1), x + field - sx)
        if units:
            surface.text(units_font, units, x + field + gap, top + _units_offset(font, units_font), colour, x + w)

    return draw
