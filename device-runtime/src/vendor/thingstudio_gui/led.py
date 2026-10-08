# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_gui/led.py -- on the board: tsgui_led.py
#
# Status light: a filled circle when the value is truthy, an outline when falsy. Unknown: a dashed outline.
# Stale: dim fill, or an outline with a centre dot on mono.


def natural(diameter=12):
    return (diameter, diameter)


def make(diameter=12):
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
                        fb.pixel(i, j, surface.background)
            return
        on = bool(value)
        if state == 2 and not surface.shades:
            fb.ellipse(cx, cy, rr, rr, surface.fg)
            if on:
                fb.pixel(cx, cy, surface.fg)
            return
        fb.ellipse(cx, cy, rr, rr, surface.accent_for(state) if on else surface.colour_for(state), on)

    return draw
