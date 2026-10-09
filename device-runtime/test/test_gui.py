# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_gui.py
#
# The GUI subsystem (vendor/thingstudio_gui/gui.py, phase 4 of gui-layout-widget-system-scoping.md) under
# the real MicroPython unix port, with real framebuf framebuffers and no hardware: value states and stale
# timers, rate-limited redraws of only what changed, navigation, the modal queue, remote views, and fault
# isolation when a widget's draw routine raises. Time is passed in explicitly, so nothing sleeps.

import framebuf

import minitest

minitest.add_src_to_path()
import sys  # noqa: E402

sys.path.insert(0, sys.path[0] + "/vendor/thingstudio_gui")
import gui  # noqa: E402

W, H = 32, 16


def _fb():
    buf = bytearray(W * H // 2)
    return buf, framebuf.FrameBuffer(buf, W, H, framebuf.GS4_HMSB)


def _box(colour):
    """A draw routine that fills its rect with a colour per state: unknown 1, known value, stale 2."""
    def draw(surface, rect, value, state):
        x, y, w, h = rect
        surface.fb.fill_rect(x, y, w, h, {gui.UNKNOWN: 1, gui.KNOWN: value if value is not None else 0, gui.STALE: 2}[state])
    return draw


def _setup(stale_after_ms=0, **surface_kw):
    g = gui.GUI()
    g.widget("temp", _box(0), stale_after_ms)
    g.widget("hum", _box(0))
    g.widget("alarm_text", _box(0))
    buf, fb = _fb()
    pushes = []
    pages = {
        "home": {"parent": None, "widgets": [("temp", (0, 0, 8, 8))]},
        "climate": {"parent": None, "widgets": [("hum", (8, 0, 8, 8))]},
        "detail": {"parent": "climate", "widgets": []},
        "power": {"parent": None, "widgets": []},
    }
    modals = {
        "alarm": {"widgets": [("alarm_text", (0, 8, 8, 8))], "priority": 1, "timeout_ms": 0},
        "info": {"widgets": [], "priority": 0, "timeout_ms": 1000},
        "fire": {"widgets": [], "priority": 5, "timeout_ms": 0},
    }
    s = gui.FrameSurface("tft", fb, lambda f: pushes.append(1), pages, ["home", "climate", "power"], modals, fmt=framebuf.GS4_HMSB, **surface_kw)
    g.add_surface(s)
    return g, s, fb, pushes


def test_values_start_unknown_and_draw_as_unknown():
    g, s, fb, pushes = _setup()
    assert g.state("temp") == gui.UNKNOWN
    assert g.step(now=0) == 1
    assert fb.pixel(0, 0) == 1
    g.set_value("temp", 7, now=10)
    assert g.state("temp") == gui.KNOWN
    g.step(now=200)
    assert fb.pixel(0, 0) == 7
    g.set_value("temp", None, now=300)  # payload None: back to unknown
    g.step(now=500)
    assert fb.pixel(0, 0) == 1


def test_stale_after_quiet_period():
    g, s, fb, _ = _setup(stale_after_ms=1000)
    g.set_value("temp", 7, now=0)
    g.step(now=0)
    g.step(now=999)
    assert g.state("temp") == gui.KNOWN
    g.step(now=1000)
    assert g.state("temp") == gui.STALE
    g.step(now=1200)
    assert fb.pixel(0, 0) == 2
    g.set_value("temp", 9, now=1300)
    assert g.state("temp") == gui.KNOWN


def test_message_rate_is_not_frame_rate():
    g, s, fb, pushes = _setup(min_interval_ms=100)
    g.step(now=0)
    for i in range(50):
        g.set_value("temp", 3 + i % 5, now=i)
        g.step(now=i)
    assert len(pushes) == 1  # the first frame only; still inside 100ms
    g.step(now=100)
    assert len(pushes) == 2
    g.step(now=300)
    assert len(pushes) == 2  # nothing dirty, nothing pushed


def test_only_dirty_widgets_redraw_and_off_page_values_wait():
    g, s, fb, pushes = _setup()
    g.step(now=0)
    g.set_value("hum", 5, now=1)  # hum is on "climate", not visible
    assert s.dirty == set()
    assert g.step(now=200) == 0
    g.navigate("tft", "next")
    g.step(now=400)
    assert fb.pixel(8, 0) == 5  # correct the moment its page appears
    assert fb.pixel(0, 0) == 0  # the home widget is gone


def test_navigation_carousel_tree_and_wrap():
    g, s, _, _ = _setup()
    seen = []
    s.on_page = seen.append
    assert g.navigate("tft", "next") == "climate"
    assert g.navigate("tft", "detail") == "detail"
    assert s.page_info() == (1, 3)
    assert g.navigate("tft", "next") == "power"  # next/prev move along the carousel from a drilled-in page
    assert g.navigate("tft", "next") == "home"  # wraps
    assert g.navigate("tft", "prev") == "power"
    g.navigate("tft", "detail")
    assert g.navigate("tft", "back") == "climate"
    assert g.navigate("tft", "back") == "climate"  # top level: back stays
    assert g.navigate("tft", "home") == "home"
    assert seen == ["climate", "detail", "power", "home", "power", "detail", "climate", "home"]


def test_no_wrap_stops_at_the_ends():
    g, s, _, _ = _setup(wrap=False)
    assert g.navigate("tft", "prev") == "home"
    g.navigate("tft", "power")
    assert g.navigate("tft", "next") == "power"


def test_bad_names_raise_naming_them():
    g, _, _, _ = _setup()
    for fn, args, text in (
        (g.navigate, ("tft", "sideways"), "sideways"),
        (g.navigate, ("oled", "next"), "oled"),
        (g.set_value, ("nope", 1), "nope"),
        (g.open_modal, ("tft", "flood", "x"), "flood"),
    ):
        try:
            fn(*args)
        except ValueError as e:
            assert text in str(e), str(e)
        else:
            raise AssertionError("no error for %r" % (args,))


def test_modal_queue_priority_and_close_reasons():
    g, s, fb, _ = _setup()
    closed = []
    g.on_modal_close = lambda d, m, r: closed.append((m, r))
    g.open_modal("tft", "info", "hello", now=0)
    g.open_modal("tft", "alarm", "too hot", now=0)  # higher priority takes the screen
    assert s.visible() == "alarm" and s.queued() == 1
    assert g.navigate("tft", "next") == "alarm"  # next/prev do nothing under a modal
    assert g.navigate("tft", "climate") == "alarm" and s.page == "climate"  # a goto changes the page underneath
    g.navigate("tft", "home")
    g.open_modal("tft", "fire", "FIRE", now=0)
    assert s.visible() == "fire" and s.queued() == 2  # nothing dropped
    assert g.navigate("tft", "back") == "alarm"  # back acknowledges; the next highest returns
    g.open_modal("tft", "alarm", None, now=10)  # condition cleared: the flow closes it
    assert s.visible() == "info"
    g.step(now=500)
    g.step(now=1010)  # info times out 1000ms after it was shown (at 10)
    assert s.visible() == "home"
    assert closed == [("fire", "ack"), ("alarm", "closed"), ("info", "timeout")]


def test_closing_a_queued_modal_and_updating_content():
    g, s, _, _ = _setup()
    closed = []
    g.on_modal_close = lambda d, m, r: closed.append((m, r))
    g.open_modal("tft", "alarm", "a", now=0)
    g.open_modal("tft", "info", "i", now=0)
    g.open_modal("tft", "info", None, now=0)
    assert s.queued() == 0 and closed == [("info", "closed")]
    g.open_modal("tft", "alarm", "b", now=0)
    assert g.modal_payload("tft") == "b" and s.queued() == 0


def test_modal_widgets_draw_and_page_returns():
    g, s, fb, _ = _setup()
    g.set_value("alarm_text", 9, now=0)
    g.open_modal("tft", "alarm", "x", now=0)
    g.step(now=0)
    assert fb.pixel(0, 8) == 9 and fb.pixel(0, 0) == 0  # page widgets aren't drawn under the modal
    g.navigate("tft", "back")
    g.step(now=200)
    assert fb.pixel(0, 0) == 1 and fb.pixel(0, 8) == 0


def test_a_failing_widget_is_crossed_out_and_reported_others_carry_on():
    g, s, fb, pushes = _setup()
    errors = []
    g.on_error = lambda who, e: errors.append((who, type(e).__name__))

    def broken(surface, rect, value, state):
        raise ZeroDivisionError("boom")

    g.widgets["temp"].draw = broken
    g.navigate("tft", "home")
    g.step(now=0)
    assert errors == [("temp", "ZeroDivisionError")]
    assert fb.pixel(0, 0) == 15 and fb.pixel(3, 3) == 15  # the cross, in the foreground colour
    assert len(pushes) == 1  # still pushed


def test_a_failing_panel_doesnt_stop_other_surfaces():
    g, s, fb, pushes = _setup()
    errors = []
    g.on_error = lambda who, e: errors.append(who)
    sent = []
    r = gui.RemoteSurface("phone", sent.append, {"p": {"parent": None, "widgets": [("hum", (0, 0, 1, 1))]}}, ["p"])
    g.add_surface(r)

    def dead(f):
        raise OSError("SPI")

    s.push = dead
    assert g.step(now=0) == 2
    assert errors == ["display tft"] and len(sent) == 1


def test_remote_view_sends_screens_and_changed_values():
    g = gui.GUI()
    g.widget("temp", _box(0), 1000)
    g.widget("hum", _box(0))
    sent = []
    pages = {"a": {"parent": None, "widgets": [("temp", (0, 0, 1, 1)), ("hum", (0, 0, 1, 1))]}, "b": {"parent": None, "widgets": []}}
    r = g.add_surface(gui.RemoteSurface("phone", sent.append, pages, ["a", "b"], {"alarm": {"widgets": []}}))
    g.step(now=0)
    assert sent[-1] == {"type": "screen", "display": "phone", "page": "a", "modal": None, "modalPayload": None,
                        "queued": 0, "values": {"temp": [None, "unknown"], "hum": [None, "unknown"]}}
    g.set_value("temp", 21.5, now=100)
    g.step(now=200)
    assert sent[-1] == {"type": "values", "display": "phone", "values": {"temp": [21.5, "known"]}}
    g.step(now=1100)
    assert sent[-1]["values"] == {"temp": [21.5, "stale"]}
    g.open_modal("phone", "alarm", "hot", now=1200)
    g.step(now=1300)
    assert sent[-1]["type"] == "screen" and sent[-1]["modal"] == "alarm" and sent[-1]["modalPayload"] == "hot"


def test_value_feed_sees_every_change_on_or_off_screen():
    g, s, _, _ = _setup(stale_after_ms=100)
    feed = []
    g.on_value = lambda wid, v, st: feed.append((wid, v, st))
    g.set_value("hum", 4, now=0)  # off screen
    g.set_value("temp", 1, now=0)
    g.step(now=100)
    assert feed == [("hum", 4, "known"), ("temp", 1, "known"), ("temp", 1, "stale")]


def test_tables_are_checked_when_a_surface_is_added():
    g = gui.GUI()
    _, fb = _fb()
    try:
        g.add_surface(gui.FrameSurface("tft", fb, None, {"p": {"parent": None, "widgets": [("ghost", (0, 0, 1, 1))]}}, ["p"]))
    except ValueError as e:
        assert "ghost" in str(e) and "tft" in str(e), str(e)
    else:
        raise AssertionError("unknown widget accepted")
    for pages, carousel in (({}, []), ({"p": {"parent": None, "widgets": []}}, ["q"]), ({"p": {"parent": "x", "widgets": []}}, ["p"])):
        try:
            gui.FrameSurface("tft", fb, None, pages, carousel)
        except ValueError:
            pass
        else:
            raise AssertionError("bad tables accepted: %r %r" % (pages, carousel))


def test_run_loop_steps_until_cancelled():
    try:
        import asyncio
    except ImportError:
        import uasyncio as asyncio
    g, s, fb, pushes = _setup()

    async def main():
        t = asyncio.create_task(g.run(tick_ms=10))
        await asyncio.sleep_ms(35)
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass

    asyncio.run(main())
    assert len(pushes) == 1  # the first frame; nothing changed after it


def test_one_widget_can_be_shown_on_several_displays():
    # A widget's value is kept once, by id; where it appears is a list of placements, one per display page.
    # So a readout shown on two panels (different sizes, one off the visible page) needs nothing from the widget.
    g = gui.GUI()
    g.widget("temp", _box(0))
    buf1, fb1 = _fb()
    buf2, fb2 = _fb()
    one = gui.FrameSurface("tft", fb1, lambda f: None, {"home": {"parent": None, "widgets": [("temp", (0, 0, 8, 8))]}}, ["home"], fmt=framebuf.GS4_HMSB)
    two = gui.FrameSurface("oled", fb2, lambda f: None, {
        "other": {"parent": None, "widgets": []},
        "home": {"parent": None, "widgets": [("temp", (16, 8, 4, 4))]},
    }, ["other", "home"], fmt=framebuf.GS4_HMSB)
    g.add_surface(one)
    g.add_surface(two)
    g.set_value("temp", 9, now=0)
    g.step(now=0)
    assert fb1.pixel(0, 0) == 9  # drawn on the first display
    assert fb2.pixel(16, 8) == 0  # second display shows another page: nothing yet
    g.navigate("oled", "next")
    g.step(now=200)
    assert fb2.pixel(16, 8) == 9  # and when its page comes up, the same value is there
    g.set_value("temp", 5, now=300)
    g.step(now=500)
    assert fb1.pixel(0, 0) == 5 and fb2.pixel(16, 8) == 5  # one set_value reaches both


def test_touch_presses_the_button_under_the_finger_and_releases_it():
    g = gui.GUI()
    seen = []

    def button(surface, rect, value, state):
        seen.append(state)
        surface.fb.fill_rect(rect[0], rect[1], rect[2], rect[3], 9 if state == gui.PRESSED else 4)

    g.widget("temp", _box(0))  # not touchable
    g.widget("btn", button, 0, True)
    g.widget("btn2", button, 0, True)
    buf, fb = _fb()
    pages = {
        "home": {"parent": None, "widgets": [("temp", (0, 0, 8, 8)), ("btn", (8, 0, 8, 8)), ("btn2", (12, 0, 8, 8))]},
        "other": {"parent": None, "widgets": []},
    }
    s = g.add_surface(gui.FrameSurface("tft", fb, lambda f: None, pages, ["home", "other"], fmt=framebuf.GS4_HMSB))
    g.step(now=0)
    assert g.touch("tft", "down", 2, 2) is None  # a value widget isn't a button
    assert g.touch("tft", "down", 30, 12) is None  # empty space
    assert g.touch("tft", "up", 30, 12) is None  # nothing held
    assert g.touch("tft", "down", 9, 3, now=1000) == ("btn", "down")
    g.step(now=1010)
    assert fb.pixel(9, 3) == 9  # redrawn pressed
    assert g.touch("tft", "down", 14, 3, now=1500) == ("btn2", "down")  # overlap at x=12..15: the later one wins; btn is let go
    assert not g.widgets["btn"].pressed
    assert g.touch("tft", "up", 100, 100, now=2000) == ("btn2", "up")  # released wherever the finger lifts
    g.step(now=2001)
    assert fb.pixel(14, 3) == 4 and fb.pixel(9, 3) == 4
    assert s.held is None
    # a button on a page that isn't showing can't be pressed
    g.navigate("tft", "next")
    assert g.touch("tft", "down", 9, 3) is None
    try:
        g.touch("tft", "move", 1, 1)
        assert False, "move is not an event"
    except ValueError:
        pass
    try:
        g.touch("nope", "down", 1, 1)
        assert False, "unknown display"
    except ValueError:
        pass


def test_a_quick_tap_is_still_drawn_pressed_for_a_moment():
    # A tap shorter than the redraw rate used to flash by unseen: down and up both landed before the next draw.
    g = gui.GUI()
    g.widget("btn", lambda surface, rect, value, state: surface.fb.fill_rect(rect[0], rect[1], rect[2], rect[3], 9 if state == gui.PRESSED else 4), 0, True)
    buf, fb = _fb()
    g.add_surface(gui.FrameSurface("tft", fb, lambda f: None, {"home": {"parent": None, "widgets": [("btn", (0, 0, 8, 8))]}}, ["home"], min_interval_ms=200, fmt=framebuf.GS4_HMSB))
    g.step(now=0)
    assert g.touch("tft", "down", 1, 1, now=1000) == ("btn", "down")
    assert g.touch("tft", "up", 1, 1, now=1020) == ("btn", "up")  # the event is not delayed...
    g.step(now=1030)  # ...and the press is drawn at once, inside the 200 ms redraw limit
    assert fb.pixel(1, 1) == 9
    g.step(now=1100)  # still held on screen (50..150 ms)
    assert g.widgets["btn"].pressed
    g.step(now=1160)  # past the minimum: let go and redrawn
    assert not g.widgets["btn"].pressed
    assert fb.pixel(1, 1) == 4
    # a long press is released the moment the finger lifts
    g.touch("tft", "down", 1, 1, now=2000)
    g.touch("tft", "up", 1, 1, now=3000)
    assert not g.widgets["btn"].pressed


def test_a_modal_takes_the_touch():
    g = gui.GUI()
    g.widget("under", _box(0), 0, True)
    g.widget("ok", _box(0), 0, True)
    buf, fb = _fb()
    s = g.add_surface(gui.FrameSurface(
        "tft", fb, lambda f: None, {"home": {"parent": None, "widgets": [("under", (0, 0, 16, 16))]}}, ["home"],
        {"alert": {"widgets": [("ok", (4, 4, 8, 8))], "priority": 1, "timeout_ms": 0}}, fmt=framebuf.GS4_HMSB))
    g.open_modal("tft", "alert", "hi", now=0)
    assert g.touch("tft", "down", 1, 1) is None  # the page behind is out of reach
    assert g.touch("tft", "down", 5, 5) == ("ok", "down")


minitest.run(
    [
        test_run_loop_steps_until_cancelled,
        test_touch_presses_the_button_under_the_finger_and_releases_it,
        test_a_modal_takes_the_touch,
        test_a_quick_tap_is_still_drawn_pressed_for_a_moment,
        test_one_widget_can_be_shown_on_several_displays,
        test_values_start_unknown_and_draw_as_unknown,
        test_stale_after_quiet_period,
        test_message_rate_is_not_frame_rate,
        test_only_dirty_widgets_redraw_and_off_page_values_wait,
        test_navigation_carousel_tree_and_wrap,
        test_no_wrap_stops_at_the_ends,
        test_bad_names_raise_naming_them,
        test_modal_queue_priority_and_close_reasons,
        test_closing_a_queued_modal_and_updating_content,
        test_modal_widgets_draw_and_page_returns,
        test_a_failing_widget_is_crossed_out_and_reported_others_carry_on,
        test_a_failing_panel_doesnt_stop_other_surfaces,
        test_remote_view_sends_screens_and_changed_values,
        test_value_feed_sees_every_change_on_or_off_screen,
        test_tables_are_checked_when_a_surface_is_added,
    ]
)
