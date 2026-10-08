# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/label.py -- on the board: tsgui_label.py
#
# Label widget: static text, or a bound value shown as text (unknown: "--"). Natural size matches the
# editor's measure (editor/src/gui/widgets.ts): static, the text's width; bound, max_chars of the font's widest
# glyph. Text is centred vertically in its rect and aligned left, centre or right.

UNKNOWN_TEXT = "--"


def _widest(font):
    w = 0
    for c in range(32, 127):
        w = max(w, font.get_ch(chr(c))[2])
    return w


def _width(font, s):
    return sum(font.get_ch(c)[2] for c in s)


def natural(font, text=None, max_chars=8):
    if text is not None:
        return (_width(font, text), font.height())
    return (_widest(font) * max_chars, font.height())


def make(font, text=None, align="left"):
    """Static when `text` is given (the value is ignored), else shows the bound value."""
    if align not in ("left", "center", "right"):
        raise ValueError("label align must be left, center or right, not %r" % (align,))

    def draw(surface, rect, value, state):
        x, y, w, h = rect
        if text is not None:
            s, colour = text, surface.fg
        else:
            s = UNKNOWN_TEXT if state == 0 else str(value)
            colour = surface.colour_for(state)
        tw = _width(font, s)
        if align == "center":
            x += max(0, (w - tw) // 2)
        elif align == "right":
            x += max(0, w - tw)
        ty = y + max(0, (h - font.height()) // 2)
        end = surface.text(font, s, x, ty, colour, rect[0] + w)
        if text is None and state == 2 and not surface.shades:
            surface.stale_mark(x, ty + font.height() - 1, end - x)

    return draw
