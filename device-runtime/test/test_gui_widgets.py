# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_gui_widgets.py
#
# The hero app's widgets (vendor/thingstudio_gui/{label,readout,bar,led,pagedots}.py) under the real
# MicroPython unix port, drawing with the real fonts into real framebuf buffers in 4-bit grey and mono:
# natural sizes equal the editor's (shared fixture), nothing is drawn outside a widget's rect even for its
# widest value, and unknown / known / stale each look different -- by shade in grey, by pattern in mono.

import json
import sys

import framebuf

import minitest

minitest.add_src_to_path()
_SRC = sys.path[0]
sys.path.insert(0, _SRC + "/vendor/thingstudio_gui")
sys.path.insert(0, _SRC + "/vendor/fonts")

import bar  # noqa: E402
import button  # noqa: E402
import gui  # noqa: E402
import label  # noqa: E402
import led  # noqa: E402
import pagedots  # noqa: E402
import readout  # noqa: E402
import trend  # noqa: E402

_HERE = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
_FIXTURE = _HERE + "/../../editor/test/fixtures/gui-widget-sizes.json"
MODS = {"label": label, "readout": readout, "bar": bar, "led": led, "button": button, "pagedots": pagedots}
W, H = 340, 90
FORMATS = ((framebuf.GS4_HMSB, W * H // 2), (framebuf.MONO_HLSB, (W + 7) // 8 * H))


def _font(name):
    return __import__(name)


def _cfg(raw):
    return {k: (_font(v) if k in ("font", "units_font") else v) for k, v in raw.items()}


def _surface(fmt, size, carousel=("a",)):
    fb = framebuf.FrameBuffer(bytearray(size), W, H, fmt)
    pages = {p: {"parent": None, "widgets": []} for p in carousel}
    return gui.FrameSurface("t", fb, lambda f: None, pages, list(carousel), fmt=fmt)


def _pixels_outside(s, rect):
    x, y, w, h = rect
    bad = 0
    for j in range(H):
        for i in range(W):
            if (i < x or i >= x + w or j < y or j >= y + h) and s.fb.pixel(i, j) != s.background:
                bad += 1
    return bad


def _colours_inside(s, rect):
    x, y, w, h = rect
    seen = set()
    for j in range(y, y + h):
        for i in range(x, x + w):
            seen.add(s.fb.pixel(i, j))
    return seen


def _make(widget, raw):
    cfg = _cfg(raw)
    if widget == "readout":
        cfg.pop("lo", None), cfg.pop("hi", None)
        return readout.make(lo=raw.get("lo", -99), hi=raw.get("hi", 999), **cfg)
    if widget == "label":
        cfg.pop("max_chars", None)
        return label.make(**cfg)
    if widget == "bar":
        return bar.make()
    if widget == "led":
        return led.make(**cfg)
    if widget == "button":
        return button.make(cfg["font"], cfg.get("text"))
    cfg.pop("pages", None)
    return pagedots.make(**cfg)


def _widest_value(widget, raw):
    if widget == "readout":
        return raw.get("lo", 0) if len("%.*f" % (raw.get("decimals", 1), raw.get("lo", 0))) >= len(str(raw.get("hi"))) else raw.get("hi")
    if widget == "label":
        return "W" * raw.get("max_chars", 8)
    if widget == "button":
        return raw.get("text") or "W" * raw.get("max_chars", 8)
    return 100 if widget == "bar" else 1


def test_natural_sizes_match_the_editor():
    with open(_FIXTURE) as f:
        cases = json.load(f)["cases"]
    for c in cases:
        got = list(MODS[c["widget"]].natural(**_cfg(c["cfg"])))
        assert got == c["natural"], (c["widget"], c["cfg"], got, c["natural"])


def test_every_widget_stays_inside_its_rect_in_every_state_and_format():
    with open(_FIXTURE) as f:
        cases = json.load(f)["cases"]
    for fmt, size in FORMATS:
        for c in cases:
            nat = MODS[c["widget"]].natural(**_cfg(c["cfg"]))
            rect = (3, 5, nat[0], nat[1])
            draw = _make(c["widget"], c["cfg"])
            for state, value in ((gui.UNKNOWN, None), (gui.KNOWN, _widest_value(c["widget"], c["cfg"])), (gui.STALE, _widest_value(c["widget"], c["cfg"])), (gui.PRESSED, _widest_value(c["widget"], c["cfg"]))):
                s = _surface(fmt, size, ("a", "b", "c", "d"))
                s.fb.fill(0)
                draw(s, rect, value, state)
                bad = _pixels_outside(s, rect)
                assert bad == 0, (c["widget"], c["cfg"], state, fmt, bad)


def test_readout_states_look_different():
    r = readout.make(_font("font_digits32"), _font("font_body16"), "%", decimals=0, lo=0, hi=100)
    rect = (0, 0) + readout.natural(_font("font_digits32"), _font("font_body16"), "%", decimals=0, lo=0, hi=100)
    looks = {}
    for state, value in ((gui.UNKNOWN, None), (gui.KNOWN, 48), (gui.STALE, 48)):
        s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
        r(s, rect, value, state)
        looks[state] = _colours_inside(s, rect)
    assert looks[gui.KNOWN] == {0, 15}
    assert looks[gui.STALE] == {0, 6}  # dimmed, same digits
    assert 15 in looks[gui.UNKNOWN]
    # mono: stale adds a dotted underline the known value doesn't have
    counts = {}
    for state in (gui.KNOWN, gui.STALE):
        s = _surface(framebuf.MONO_HLSB, FORMATS[1][1])
        r(s, rect, 48, state)
        counts[state] = sum(1 for j in range(rect[3]) for i in range(rect[2]) if s.fb.pixel(i, j))
    assert counts[gui.STALE] > counts[gui.KNOWN]


def test_readout_formats_and_clips_out_of_range_values():
    f = _font("font_digits24")
    r = readout.make(f, decimals=1, lo=0, hi=9)
    rect = (0, 0) + readout.natural(f, decimals=1, lo=0, hi=9)
    s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    r(s, rect, 12345.678, gui.KNOWN)  # wider than its field: clipped, never painted over a neighbour
    assert _pixels_outside(s, rect) == 0


def test_bar_fills_in_proportion_and_clamps():
    draw = bar.make(0, 100)
    rect = (0, 0, 60, 10)
    s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    draw(s, rect, 50, gui.KNOWN)
    fill = int(56 * 0.5 + 0.5)
    assert s.fb.pixel(2 + fill - 1, 5) == 15 and s.fb.pixel(2 + fill, 5) == 0
    s.fb.fill(0)
    draw(s, rect, 500, gui.KNOWN)
    assert s.fb.pixel(57, 5) == 15
    s.fb.fill(0)
    draw(s, rect, None, gui.UNKNOWN)
    assert all(s.fb.pixel(i, 5) == 0 for i in range(2, 58))  # no fill when unknown
    try:
        draw(s, rect, "hot", gui.KNOWN)
    except ValueError as e:
        assert "hot" in str(e)
    else:
        raise AssertionError("non-number accepted")


def test_led_on_off_unknown():
    draw = led.make(14)
    rect = (0, 0, 14, 14)
    for value, state, centre in ((True, gui.KNOWN, 15), (False, gui.KNOWN, 0), (None, gui.UNKNOWN, 0)):
        s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
        draw(s, rect, value, state)
        assert s.fb.pixel(7, 7) == centre, (value, state)


def test_pagedots_follow_the_current_page():
    g = gui.GUI()
    g.widget("dots", pagedots.make(6, 4))
    fb = framebuf.FrameBuffer(bytearray(FORMATS[0][1]), W, H, framebuf.GS4_HMSB)
    pages = {p: {"parent": None, "widgets": [("dots", (0, 0, 36, 6))]} for p in ("a", "b", "c", "d")}
    s = g.add_surface(gui.FrameSurface("t", fb, lambda f: None, pages, ["a", "b", "c", "d"], fmt=framebuf.GS4_HMSB))

    def filled():
        return [i for i in range(4) if fb.pixel(i * 10 + 3, 3) == 15]

    g.step(now=0)
    assert filled() == [0]
    g.navigate("t", "next")
    g.navigate("t", "next")
    g.step(now=1000)
    assert filled() == [2]


def test_a_bad_value_is_reported_against_its_widget():
    g = gui.GUI()
    errors = []
    g.on_error = lambda who, e: errors.append((who, str(e)))
    g.widget("pressure", bar.make(900, 1100))
    fb = framebuf.FrameBuffer(bytearray(FORMATS[0][1]), W, H, framebuf.GS4_HMSB)
    g.add_surface(gui.FrameSurface("t", fb, lambda f: None, {"a": {"parent": None, "widgets": [("pressure", (0, 0, 60, 10))]}}, ["a"], fmt=framebuf.GS4_HMSB))
    g.set_value("pressure", "high", now=0)
    g.step(now=0)
    assert errors and errors[0][0] == "pressure" and "high" in errors[0][1], errors


def test_a_button_looks_different_held_down_and_shows_a_value():
    f = _font("font_body16")
    b = button.make(f, "Light")
    rect = (0, 0) + button.natural(f, "Light")
    looks = {}
    for state in (gui.KNOWN, gui.PRESSED):
        s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
        b(s, rect, None, state)
        looks[state] = sum(1 for j in range(rect[3]) for i in range(rect[2]) if s.fb.pixel(i, j) == 15)
    assert looks[gui.PRESSED] > looks[gui.KNOWN] * 2  # filled, not just outlined
    a = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    b(a, rect, "ON", gui.KNOWN)  # a value replaces the text
    c = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    b(c, rect, None, gui.KNOWN)
    assert [a.fb.pixel(i, 16) for i in range(rect[2])] != [c.fb.pixel(i, 16) for i in range(rect[2])]


def test_a_toggle_shows_on_off_and_its_unknown_pending_and_failed_looks_differ_and_stay_inside():
    f = _font("font_body16")
    b = button.make(f, None, "ON", "OFF")
    rect = (4, 4) + button.natural(f, "OFF")
    for fmt, size in FORMATS:
        looks = {}
        for name, value, state in (("on", True, gui.KNOWN), ("off", False, gui.KNOWN), ("unknown", None, gui.UNKNOWN),
                                   ("pending", True, gui.PENDING), ("failed", False, gui.FAILED), ("held", True, gui.PRESSED)):
            s = _surface(fmt, size)
            b(s, rect, value, state)
            assert _pixels_outside(s, rect) == 0, (name, "drew outside its rect")
            looks[name] = [s.fb.pixel(i, j) for j in range(H) for i in range(W)]
        names = list(looks)
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                assert looks[names[i]] != looks[names[j]], (names[i], names[j], "look the same")


class _Series:
    """What a journal sends, in the shape the widget reads."""

    def __init__(self, rows, values):
        nan = float("nan")
        self.rows = rows
        self.avg = [nan] * rows
        self.lo = [nan] * rows
        self.hi = [nan] * rows
        self.n = 0
        self.head = 0
        for a, lo, hi in values:
            self.avg[self.head], self.lo[self.head], self.hi[self.head] = a, lo, hi
            self.head = (self.head + 1) % rows
            self.n = min(self.n + 1, rows)


def _column_has_ink(s, x, y, h):
    return any(s.fb.pixel(x, j) != s.background for j in range(y, y + h))


def test_trend_draws_the_newest_on_the_right_and_leaves_gaps_empty():
    draw = trend.make(0, 100, 3)
    rect = (0, 0, 40, 30)  # 36 px inside -> 12 columns of 3
    nan = float("nan")
    series = _Series(8, [(50, 50, 50), (nan, nan, nan), (100, 100, 100)])
    s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    draw(s, rect, series, gui.KNOWN)
    # 3 rows: the oldest at columns 2 columns left of the newest; the newest sits against the right edge.
    right = 40 - 2
    assert _column_has_ink(s, right - 3, 0, 30)  # newest (100): full height
    assert not _column_has_ink(s, right - 6, 3, 24)  # gap
    assert _column_has_ink(s, right - 9, 3, 24)  # oldest (50)
    full = sum(1 for j in range(30) if s.fb.pixel(right - 3, j) == 15 or s.fb.pixel(right - 3, j) == s.accent)
    assert full >= 26


def test_trend_draws_min_max_whiskers_and_plain_lists():
    draw = trend.make(0, 100, 3)
    rect = (0, 0, 40, 40)
    s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    draw(s, rect, _Series(4, [(20, 10, 80)]), gui.KNOWN)
    centre = 40 - 2 - 3 + 1
    assert s.fb.pixel(centre, 40 - 2 - 28) == s.fg  # a line well above the bar's top (20% of 36 = 7 px)
    t = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    draw(t, rect, [10, None, 90], gui.KNOWN)  # a plain list, None is a gap
    assert _column_has_ink(t, 40 - 2 - 3, 2, 36) and not _column_has_ink(t, 40 - 2 - 6, 2, 36)


def test_trend_shows_only_what_fits_and_rejects_a_scalar():
    draw = trend.make(0, 10, 2)
    rect = (0, 0, 14, 20)  # 10 px inside -> 5 columns
    s = _surface(framebuf.GS4_HMSB, FORMATS[0][1])
    draw(s, rect, list(range(1, 11)), gui.KNOWN)  # 10 values, the last 5 are shown
    assert [i for i in range(2, 12) if _column_has_ink(s, i, 2, 16)] == [2, 4, 6, 8, 10]  # 5 columns of 2 px, one bar px each
    try:
        draw(s, rect, 42, gui.KNOWN)
    except ValueError as e:
        assert "series or a list" in str(e)
    else:
        raise AssertionError("a scalar was accepted")


def test_trend_unknown_known_and_stale_look_different_and_stay_inside():
    draw = trend.make(0, 100, 3)
    nat = trend.natural(10, 3, 30)
    rect = (3, 5) + nat
    for fmt, size in FORMATS:
        looks = {}
        for name, value, state in (("unknown", None, gui.UNKNOWN), ("known", [10, 40, 70, 100] * 3, gui.KNOWN), ("stale", [10, 40, 70, 100] * 3, gui.STALE)):
            s = _surface(fmt, size)
            s.fb.fill(0)
            draw(s, rect, value, state)
            assert _pixels_outside(s, rect) == 0, (name, fmt)
            looks[name] = [s.fb.pixel(i, j) for j in range(H) for i in range(W)]
        assert looks["unknown"] != looks["known"] and looks["known"] != looks["stale"]


def test_trend_natural_size():
    assert list(trend.natural(60, 3, 48)) == [184, 48]
    assert list(trend.natural(10, 2, 20)) == [24, 20]



minitest.run(
    [
        test_a_toggle_shows_on_off_and_its_unknown_pending_and_failed_looks_differ_and_stay_inside,
        test_natural_sizes_match_the_editor,
        test_every_widget_stays_inside_its_rect_in_every_state_and_format,
        test_readout_states_look_different,
        test_readout_formats_and_clips_out_of_range_values,
        test_bar_fills_in_proportion_and_clamps,
        test_led_on_off_unknown,
        test_pagedots_follow_the_current_page,
        test_a_bad_value_is_reported_against_its_widget,
        test_a_button_looks_different_held_down_and_shows_a_value,
        test_trend_draws_the_newest_on_the_right_and_leaves_gaps_empty,
        test_trend_draws_min_max_whiskers_and_plain_lists,
        test_trend_shows_only_what_fits_and_rejects_a_scalar,
        test_trend_unknown_known_and_stale_look_different_and_stay_inside,
        test_trend_natural_size,
    ]
)
