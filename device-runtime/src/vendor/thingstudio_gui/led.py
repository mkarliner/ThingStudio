# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/led.py -- on the board: tsgui_led.py
#
# Status light: a filled circle when the value is truthy, an outline when falsy. Unknown: a dashed outline.
# Stale: dim fill, or an outline with a centre dot on mono.
#
# A chip is the same value as a filled rounded pill with short text (2026-10-24). It takes a font (the label is
# text), so `make` gets one; the plain light keeps its exact old call and drawing when style is "light".

UNKNOWN_TEXT = "--"
_PAD_X = 4
_PAD_Y = 3


def _width(font, s):
    w = 0
    for ch in s:
        w += font.get_ch(ch)[2]
    return w


def natural(diameter=12, style="light", text=None, font=None):
    """`text` is the widest label the chip can show (the caller picks from on/off/--)."""
    if style == "chip":
        if font is None:
            raise ValueError("a chip needs a font")
        return (max(diameter, _width(font, text or "") + 2 * _PAD_X), max(diameter, font.height() + 2 * _PAD_Y))
    return (diameter, diameter)


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


def make(diameter=12, style="light", on_text="On", off_text="Off", font=None):
    if style == "chip":
        if font is None:
            raise ValueError("a chip needs a font")
        return _chip(on_text, off_text, font)
    r = diameter // 2

    def draw(surface, rect, value, state):
        fb = surface.fb
        x, y, w, h = rect
        cx = x + w // 2
        cy = y + h // 2
        rr = min(r, w // 2, h // 2) - 1
        if rr < 1:
            return
        if state == 0:
            fb.ellipse(cx, cy, rr, rr, surface.fg)
            for i in range(cx - rr, cx + rr + 1):
                for j in range(cy - rr, cy + rr + 1):
                    if (i + j) % 3 == 0:
                        fb.pixel(i, j, surface.background_for(rect))
            return
        on = bool(value)
        if state == 2 and not surface.shades:
            fb.ellipse(cx, cy, rr, rr, surface.fg)
            if on:
                fb.pixel(cx, cy, surface.fg)
            return
        fb.ellipse(cx, cy, rr, rr, surface.accent_for(state) if on else surface.colour_for(state), on)

    return draw


def _chip(on_text, off_text, font):
    def draw(surface, rect, value, state):
        fb = surface.fb
        x, y, w, h = rect
        bg = surface.background_for(rect)
        if state == 0:
            _pill(fb, x, y, w, h, surface.fg, False)
            text, colour = UNKNOWN_TEXT, surface.fg
            text_bg = bg
        else:
            on = bool(value)
            text = on_text if on else off_text
            if on:
                colour = surface.theme.get("on_accent", surface.background)
                fill = surface.accent_for(state)
            else:
                colour = surface.colour_for(state)
                fill = surface.theme.get("track", surface.dim)
            _pill(fb, x, y, w, h, fill, True)
            # The glyph cells clear to the pill's own fill, not the screen behind it (the CYD showed black
            # boxes behind the chip's letters, 2026-10-24).
            text_bg = fill
        tw = _width(font, text)
        tx = x + max(0, (w - tw) // 2)
        ty = y + max(0, (h - font.height()) // 2)
        surface.text(font, text, tx, ty, colour, x + w, text_bg)

    return draw
