# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/button.py -- on the board: tsgui_button.py
#
# Touch button: an outlined box with centred text; held down it is drawn inverted (filled, text in the
# background colour). The text is the static `text`, unless a value arrives -- then the value is shown instead
# (a toggle can send "ON"/"OFF"). Natural size: the text plus `pad` pixels all round.
# Pressing is the GUI's business (gui.touch()); this only draws, given state 3 (PRESSED) while held.

UNKNOWN_TEXT = "--"


def _width(font, s):
    return sum(font.get_ch(c)[2] for c in s)


def _widest(font):
    w = 0
    for c in range(32, 127):
        w = max(w, font.get_ch(chr(c))[2])
    return w


def natural(font, text=None, max_chars=8, pad=8):
    w = _width(font, text) if text else _widest(font) * max_chars
    return (w + 2 * pad, font.height() + 2 * pad)


def make(font, text=None):
    def draw(surface, rect, value, state):
        x, y, w, h = rect
        fb = surface.fb
        s = str(value) if value is not None else (text if text is not None else UNKNOWN_TEXT)
        pressed = state == 3
        if pressed:
            fb.fill_rect(x, y, w, h, surface.fg)
            colour = surface.background
        else:
            fb.rect(x, y, w, h, surface.fg)
            fb.rect(x + 1, y + 1, w - 2, h - 2, surface.fg)
            colour = surface.colour_for(state)
        tw = _width(font, s)
        tx = x + max(0, (w - tw) // 2)
        ty = y + max(0, (h - font.height()) // 2)
        surface.text(font, s, tx, ty, colour, x + w)

    return draw
