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
#
# Styles (2026-10-24): "box" is the drawing above, unchanged. "filled" is a solid rounded button in the accent
# colour with text on it. "switch" draws a toggle as a track and knob (on: accent track, knob right; off: track
# colour, knob left); it needs a toggle button, so `make` refuses it for any other mode.

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


def _pill(fb, x, y, w, h, colour, filled):
    r = max(1, h // 2)
    if filled:
        fb.ellipse(x + r, y + r, r, r, colour, True)
        fb.ellipse(x + w - 1 - r, y + r, r, r, colour, True)
        fb.fill_rect(x + r, y, max(1, w - 2 * r), h, colour)
    else:
        fb.ellipse(x + r, y + r, r, r, colour)
        fb.ellipse(x + w - 1 - r, y + r, r, r, colour)
        fb.hline(x + r, y, max(1, w - 2 * r), colour)
        fb.hline(x + r, y + h - 1, max(1, w - 2 * r), colour)


def make(font, text=None, on_text=None, off_text=None, style="box"):
    toggle = on_text is not None
    if style == "switch" and not toggle:
        raise ValueError("a switch needs a toggle button (on text and off text)")

    def draw(surface, rect, value, state):
        x, y, w, h = rect
        fb = surface.fb
        if toggle:
            s = UNKNOWN_TEXT if value is None else (on_text if value else off_text)
        else:
            s = str(value) if value is not None else (text if text is not None else UNKNOWN_TEXT)
        pressed = state == 3
        if style == "switch":
            _switch(surface, rect, value, state, toggle)
            return
        if style == "filled":
            _filled(surface, rect, font, s, pressed, state)
            return
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
        surface.text(font, s, tx, ty, colour, x + w,
                     surface.fg if pressed else surface.background_for(rect))
        if state == 5:  # failed
            fb.line(x, y, x + w - 1, y + h - 1, surface.fg)
            fb.line(x, y + h - 1, x + w - 1, y, surface.fg)

    return draw


def _switch(surface, rect, value, state, toggle):
    """A toggle as a track and knob. No text: the knob's side is the state, and the shapes read on mono."""
    fb = surface.fb
    x, y, w, h = rect
    kr = max(1, (h - 6) // 2)
    if state == 0 or (toggle and value is None):  # unknown: outline track, knob centred
        _pill(fb, x, y, w, h, surface.fg, False)
        fb.ellipse(x + w // 2, y + h // 2, kr, kr, surface.fg, True)
        return
    on = bool(value)
    track = surface.accent_for(state) if on else surface.theme.get("track", surface.dim)
    _pill(fb, x, y, w, h, track, True)
    kx = x + w - 3 - kr if on else x + 3 + kr
    knob = surface.theme.get("on_accent", surface.background) if on else surface.fg
    fb.ellipse(kx, y + h // 2, kr, kr, knob, True)
    if state == 4:  # pending
        _dashes(fb, x, y, w, h, surface.fg, 1, 1)
    elif state == 5:  # failed
        fb.line(x, y, x + w - 1, y + h - 1, surface.fg)
        fb.line(x, y + h - 1, x + w - 1, y, surface.fg)


def _filled(surface, rect, font, s, pressed, state):
    fb = surface.fb
    x, y, w, h = rect
    if state == 0:  # unknown
        _pill(fb, x, y, w, h, surface.fg, False)
        colour = surface.fg
    elif pressed:
        _pill(fb, x, y, w, h, surface.fg, True)
        colour = surface.background
    else:
        _pill(fb, x, y, w, h, surface.accent_for(state), True)
        colour = surface.theme.get("on_accent", surface.background)
    if state == 4:  # pending
        _dashes(fb, x, y, w, h, surface.fg, 1, 1)
    elif state == 5:  # failed
        fb.line(x, y, x + w - 1, y + h - 1, surface.fg)
        fb.line(x, y + h - 1, x + w - 1, y, surface.fg)
    tw = _width(font, s)
    tx = x + max(0, (w - tw) // 2)
    ty = y + max(0, (h - font.height()) // 2)
    surface.text(font, s, tx, ty, colour, x + w, surface.background_for(rect))
