# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_gui_buttons.py
#
# Button behaviour in the GUI subsystem (vendor/thingstudio_gui/gui.py): momentary, toggle and navigate modes, firing
# on release inside (or on press), the event queue, a flow-controlled toggle's unknown / pending / confirmed / timeout
# cycle, and touch-panel polling. Time is passed in explicitly, so nothing sleeps except the asyncio tests.

import framebuf

import minitest

minitest.add_src_to_path()
import sys  # noqa: E402

sys.path.insert(0, sys.path[0] + "/vendor/thingstudio_gui")
import gui  # noqa: E402

try:
    import asyncio
except ImportError:
    import uasyncio as asyncio

W, H = 32, 16


def _draw(surface, rect, value, state):
    pass


def _setup(**btn):
    """One surface, page "home" with a button 'b' at (0,0,8,8), page "two" empty. Returns (gui, errors)."""
    errors = []
    g = gui.GUI(on_error=lambda who, e: errors.append((who, e)))
    g.widget("b", _draw, 0, True)
    g.widget("lbl", _draw)
    fb = framebuf.FrameBuffer(bytearray(W * H // 2), W, H, framebuf.GS4_HMSB)
    pages = {
        "home": {"parent": None, "widgets": [("b", (0, 0, 8, 8)), ("lbl", (16, 0, 8, 8))]},
        "two": {"parent": None, "widgets": []},
    }
    g.add_surface(gui.FrameSurface("tft", fb, lambda f: None, pages, ["home", "two"], fmt=framebuf.GS4_HMSB))
    if btn:
        g.button("b", **btn)
    return g, errors


def _tap(g, x=2, y=2, up_x=None, up_y=None, now=1000):
    g.tap("tft", "down", x, y, now=now)
    g.tap("tft", "up", x if up_x is None else up_x, y if up_y is None else up_y, now=now + 300)


def test_a_momentary_button_sends_its_value_on_release_inside():
    g, errors = _setup(mode="momentary", send="go")
    g.tap("tft", "down", 2, 2, now=1000)
    assert g.widgets["b"].events == []  # nothing yet: fires on release
    g.tap("tft", "up", 3, 3, now=1300)
    assert g.widgets["b"].events == ["go"]
    assert errors == []


def test_a_release_outside_the_button_sends_nothing_and_still_lets_go():
    g, errors = _setup(mode="momentary", send="go")
    _tap(g, up_x=20, up_y=10)
    assert g.widgets["b"].events == []
    assert not g.widgets["b"].pressed and g.surfaces["tft"].held is None


def test_on_press_fires_on_the_press_and_not_again_on_release():
    g, errors = _setup(mode="momentary", send=1, on_press=True)
    g.tap("tft", "down", 2, 2, now=1000)
    assert g.widgets["b"].events == [1]
    g.tap("tft", "up", 2, 2, now=1300)
    assert g.widgets["b"].events == [1]


def test_an_unwired_toggle_keeps_its_own_state_and_sends_the_opposite():
    g, errors = _setup(mode="toggle", initial=False)
    assert g.value("b") is False and g.state("b") == gui.KNOWN
    _tap(g, now=1000)
    assert g.value("b") is True and g.widgets["b"].events == [True]
    _tap(g, now=2000)
    assert g.value("b") is False and g.widgets["b"].events == [True, False]
    g2, _ = _setup(mode="toggle", initial=True, on_val="ON", off_val="OFF")
    assert g2.value("b") is True
    _tap(g2)
    assert g2.widgets["b"].events == ["OFF"]


def test_a_controlled_toggle_starts_unknown_and_a_tap_goes_pending_until_confirmed():
    g, errors = _setup(mode="toggle", controlled=True)
    assert g.state("b") == gui.UNKNOWN and g.value("b") is None
    _tap(g, now=1000)
    assert g.state("b") == gui.PENDING and g.value("b") is True  # drawn at the requested state
    assert g.widgets["b"].events == [True]  # an unknown toggle asks for on
    _tap(g, now=2000)  # taps while pending are ignored
    assert g.widgets["b"].events == [True]
    g.set_value("b", True, now=2100)  # the flow confirms
    assert g.state("b") == gui.KNOWN and g.value("b") is True and g.widgets["b"].pending_at is None
    _tap(g, now=3000)  # now it asks for off
    assert g.widgets["b"].events == [True, False] and g.state("b") == gui.PENDING and g.value("b") is False
    g.set_value("b", True, now=3100)  # the flow disagrees: its value wins
    assert g.state("b") == gui.KNOWN and g.value("b") is True


def test_the_flows_payloads_map_through_the_on_off_values_and_anything_else_is_unknown():
    g, errors = _setup(mode="toggle", controlled=True, on_val="ON", off_val="OFF")
    g.set_value("b", "ON")
    assert g.value("b") is True
    g.set_value("b", "OFF")
    assert g.value("b") is False
    g.set_value("b", "maybe")
    assert g.value("b") is None and g.state("b") == gui.UNKNOWN
    g.set_value("b", "ON")
    g.set_value("b", None)
    assert g.state("b") == gui.UNKNOWN
    _tap(g, now=5000)
    assert g.widgets["b"].events == ["ON"]  # unknown again: asks for on


def test_no_confirmation_reverts_shows_failed_for_a_moment_and_reports():
    g, errors = _setup(mode="toggle", controlled=True, pending_ms=5000)
    g.set_value("b", False, now=0)
    _tap(g, now=1000)  # asks for on
    assert g.state("b") == gui.PENDING
    # (the tap fired on release, at 1300)
    g.step(now=6200)  # 4.9 s in: still waiting
    assert g.state("b") == gui.PENDING and errors == []
    g.step(now=6400)  # 5.1 s
    assert g.state("b") == gui.KNOWN and g.value("b") is False  # back to the last confirmed value
    assert g.widgets["b"].fail_until is not None
    assert len(errors) == 1 and errors[0][0] == "b" and isinstance(errors[0][1], gui.NoConfirmation)
    g.step(now=6400 + gui.FAIL_SHOW_MS + 10)
    assert g.widgets["b"].fail_until is None
    # unknown stays unknown after a timeout
    g2, errors2 = _setup(mode="toggle", controlled=True, pending_ms=1000)
    _tap(g2, now=0)
    g2.step(now=1400)
    assert g2.state("b") == gui.UNKNOWN and g2.value("b") is None and len(errors2) == 1


def test_a_failed_button_is_drawn_with_the_failed_state_then_normally():
    g, errors = _setup(mode="toggle", controlled=True, pending_ms=1000)
    seen = []
    g.widgets["b"].draw = lambda surface, rect, value, state: seen.append(state)
    g.set_value("b", False, now=0)
    _tap(g, now=0)
    g.step(now=1500)
    g.step(now=1600)
    assert seen[-1] == gui.FAILED
    g.step(now=1500 + gui.FAIL_SHOW_MS + 200)
    g.step(now=1500 + gui.FAIL_SHOW_MS + 400)
    assert seen[-1] == gui.KNOWN


def test_a_navigate_button_acts_on_its_own_screen():
    g, errors = _setup(mode="navigate", target="next")
    _tap(g)
    assert g.surfaces["tft"].page == "two"
    assert g.widgets["b"].events == []  # no output


def test_a_bad_navigate_target_is_reported_not_raised():
    g, errors = _setup(mode="navigate", target="nowhere")
    _tap(g)
    assert len(errors) == 1 and errors[0][0] == "b" and "nowhere" in str(errors[0][1])


def test_button_setup_is_checked():
    g, _ = _setup()
    for bad in (lambda: g.button("b", "wobble"), lambda: g.button("lbl", "momentary"), lambda: g.button("nope", "momentary")):
        try:
            bad()
            assert False, "accepted a bad button"
        except ValueError:
            pass


def test_event_waits_for_a_tap_and_returns_events_in_order():
    g, errors = _setup(mode="momentary", send="x")
    got = []

    async def consumer():
        for _ in range(3):
            got.append(await g.event("b"))

    async def main():
        t = asyncio.create_task(consumer())
        await asyncio.sleep_ms(10)
        assert got == []  # blocked
        _tap(g, now=1000)
        _tap(g, now=3000)  # two taps before the consumer runs again
        await asyncio.sleep_ms(10)
        assert got == ["x", "x"]
        _tap(g, now=5000)
        await asyncio.sleep_ms(10)
        await t

    asyncio.run(main())
    assert got == ["x", "x", "x"]


def test_unconsumed_events_are_capped_and_reported():
    g, errors = _setup(mode="momentary", send=1)
    for i in range(gui.EVENT_QUEUE_MAX + 2):
        _tap(g, now=1000 * (i + 1))
    assert len(g.widgets["b"].events) == gui.EVENT_QUEUE_MAX
    assert len(errors) == 2


def test_a_watched_modal_reports_how_it_closed():
    g = gui.GUI()
    fb = framebuf.FrameBuffer(bytearray(W * H // 2), W, H, framebuf.GS4_HMSB)
    g.watch_modal("tft", "alarm")  # before the surface exists, like generated code at import
    g.widget("txt", _draw)
    modals = {"alarm": {"widgets": [("txt", (0, 0, 8, 8))], "priority": 1, "timeout_ms": 1000}}
    g.add_surface(gui.FrameSurface("tft", fb, lambda f: None, {"home": {"parent": None, "widgets": []}}, ["home"], modals, fmt=framebuf.GS4_HMSB))
    got = []

    async def consumer():
        for _ in range(3):
            got.append(await g.modal_closed("tft", "alarm"))

    async def main():
        t = asyncio.create_task(consumer())
        await asyncio.sleep_ms(5)
        g.open_modal("tft", "alarm", "fire", now=0)
        g.navigate("tft", "back")  # acknowledged
        g.open_modal("tft", "alarm", "fire", now=100)
        g.open_modal("tft", "alarm", None, now=200)  # the condition cleared
        g.open_modal("tft", "alarm", "fire", now=300)
        g.step(now=1500)  # nobody answered
        await asyncio.sleep_ms(10)
        await t

    asyncio.run(main())
    assert got == ["ack", "closed", "timeout"]


class _Panel:
    """A fake touch driver: read() returns the next scripted reading (None, (x, y), or an exception to raise)."""

    def __init__(self, script):
        self.script = list(script)

    def read(self):
        if not self.script:
            return None
        r = self.script.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def _poll(g, script, status, polls=None):
    panel = _Panel(script)
    made = []

    def make():
        made.append(1)
        return panel

    async def main():
        t = asyncio.create_task(g.poll_touch("tft", make, 5, lambda st, text: status.append((st, text)), "FT6336U at 0x38"))
        await asyncio.sleep_ms(5 * (len(script) + 3))
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass

    asyncio.run(main())
    return made


def test_poll_touch_turns_panel_readings_into_a_tap():
    g, errors = _setup(mode="momentary", send="go")
    status = []
    _poll(g, [None, (2, 2), (3, 3), None, None], status)
    assert g.widgets["b"].events == ["go"]  # released where it was last seen: inside
    assert status == [("connected", "FT6336U at 0x38")]
    assert errors == []


def test_a_panel_lost_mid_press_lets_go_without_firing_and_recovers():
    g, errors = _setup(mode="momentary", send="go")
    status = []
    _poll(g, [(2, 2), OSError(5), OSError(5), None, (2, 2), None], status)
    states = [s for s, _t in status]
    assert states == ["connected", "disconnected", "connected"]
    assert g.widgets["b"].events == ["go"]  # only the second, complete tap
    assert g.surfaces["tft"].held is None
    g.step(now=gui._ticks_ms() + 1000)  # a quick press stays drawn for PRESS_MIN_MS; then it is let go
    assert not g.widgets["b"].pressed


def test_a_driver_error_is_reported_as_status_and_retried():
    g, errors = _setup(mode="momentary", send="go")
    status = []
    made = _poll(g, [ValueError("bad chip id"), None], status)
    assert status[0] == ("error", "bad chip id")
    assert status[-1][0] == "connected" and len(made) == 2


def test_text_from_mqtt_confirms_a_true_false_or_number_toggle():
    g, errors = _setup(mode="toggle", controlled=True)  # on_val True, off_val False
    g.set_value("b", "true")
    assert g.value("b") is True
    g.set_value("b", "False")
    assert g.value("b") is False
    g.set_value("b", "ON")
    assert g.value("b") is None
    g2, _ = _setup(mode="toggle", controlled=True, on_val=1, off_val=0)
    g2.set_value("b", "1")
    assert g2.value("b") is True
    g2.set_value("b", b"0")
    assert g2.value("b") is False


minitest.run(
    [
        test_a_momentary_button_sends_its_value_on_release_inside,
        test_a_release_outside_the_button_sends_nothing_and_still_lets_go,
        test_on_press_fires_on_the_press_and_not_again_on_release,
        test_an_unwired_toggle_keeps_its_own_state_and_sends_the_opposite,
        test_text_from_mqtt_confirms_a_true_false_or_number_toggle,
        test_a_controlled_toggle_starts_unknown_and_a_tap_goes_pending_until_confirmed,
        test_the_flows_payloads_map_through_the_on_off_values_and_anything_else_is_unknown,
        test_no_confirmation_reverts_shows_failed_for_a_moment_and_reports,
        test_a_failed_button_is_drawn_with_the_failed_state_then_normally,
        test_a_navigate_button_acts_on_its_own_screen,
        test_a_bad_navigate_target_is_reported_not_raised,
        test_button_setup_is_checked,
        test_event_waits_for_a_tap_and_returns_events_in_order,
        test_unconsumed_events_are_capped_and_reported,
        test_a_watched_modal_reports_how_it_closed,
        test_poll_touch_turns_panel_readings_into_a_tap,
        test_a_panel_lost_mid_press_lets_go_without_firing_and_recovers,
        test_a_driver_error_is_reported_as_status_and_retried,
    ]
)
