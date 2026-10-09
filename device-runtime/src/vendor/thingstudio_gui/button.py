# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/button.py -- on the board: tsgui_button.py
#
# Touch button: an outlined box with centred text. Held down it is drawn inverted (filled, text in the background
# colour). The text is the static `text`, unless a value arrives -- then the value is shown instead. A toggle
# (`on_text` given) shows on_text or off_text for True or False. Natural size: the text plus `pad` pixels all round.
# What a tap does is the GUI's business (gui.tap()); this only draws. States that read in mono as shape:
#   known     solid double outline
#   unknown   dashed single outline and "--"   (a controlled toggle before the flow has reported)
#   pending   dotted single outline            (asked for a value, waiting for the flow to confirm it)
#   failed    solid outline crossed by an X    (no confirmation in time; shown briefly)
#   pressed   filled

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


def _dashes(fb, x, y, w, h, colour, on, off):
    step = on + off
    for i in range(x, x + w, step):
        n = min(on, x + w - i)
        fb.hline(i, y, n, colour)
        fb.hline(i, y + h - 1, n, colour)
    for j in range(y, y + h, step):
        n = min(on, y + h - j)
        fb.vline(x, j, n, colour)
        fb.vline(x + w - 1, j, n, colour)


def make(font, text=None, on_text=None, off_text=None):
    toggle = on_text is not None

    def draw(surface, rect, value, state):
        x, y, w, h = rect
        fb = surface.fb
        if toggle:
            s = UNKNOWN_TEXT if value is None else (on_text if value else off_text)
        else:
            s = str(value) if value is not None else (text if text is not None else UNKNOWN_TEXT)
        pressed = state == 3
        if pressed:
            fb.fill_rect(x, y, w, h, surface.fg)
            colour = surface.background
        else:
            colour = surface.colour_for(state)
            if state == 4:  # pending
                _dashes(fb, x, y, w, h, surface.fg, 1, 1)
            elif state == 0 and toggle:  # unknown
                _dashes(fb, x, y, w, h, surface.fg, 4, 3)
            else:
                fb.rect(x, y, w, h, surface.fg)
                fb.rect(x + 1, y + 1, w - 2, h - 2, surface.fg)
        tw = _width(font, s)
        tx = x + max(0, (w - tw) // 2)
        ty = y + max(0, (h - font.height()) // 2)
        surface.text(font, s, tx, ty, colour, x + w)
        if state == 5:  # failed
            fb.line(x, y, x + w - 1, y + h - 1, surface.fg)
            fb.line(x, y + h - 1, x + w - 1, y, surface.fg)

    return draw
