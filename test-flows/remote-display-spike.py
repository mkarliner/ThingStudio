# SPDX-License-Identifier: Apache-2.0
# test-flows/remote-display-spike.py
#
# The remote display spike's hand-written flow (2026-11-06, remote-display-spike-briefing.md). Codegen and the
# editor config node are out of the spike's scope, so this is the compiled-flow shape by hand: the file goes to
# the board as _flow through test-flows/deploy_flow.py -- NOT through the browser (there is no palette entry
# yet). It wires the board's own web server (ts_http_server, a general facility) plus the remote display under
# /ts/remote/, and exercises every spike checkpoint the flow side can carry:
#
#   live values        temp/hum readouts + a bar, fed by a 2 s timer
#   buttons            momentary "BOOP", a CONTROLLED toggle "PUMP" (unknown -> pending -> confirmed),
#                      navigate buttons
#   fields + settings  number and text fields written through runtime.settings by a form submit; a threshold
#                      set on the phone survives a reboot (checkpoint 4's pass condition)
#   continuous input   a ctl slider drives the LED's PWM; the link policy is "safe" with a deadman, so no
#                      fresh input (or a lost link) fires REMOTE_LINK down and the flow puts the LED
#                      safe itself (checkpoint 5)
#   a modal            a timed "Alarm" modal with its close reason printed
#   one more route     GET /ts/spike-info served beside the display: the server is a general facility
#
# Deploy (from the repo root, with the board's serial port; --mpy-cross is a native build, see
# device-runtime/test/README.md):
#   python3 test-flows/deploy_flow.py --dut-port /dev/ttyUSB0 --mpy-cross /path/to/mpy-cross \
#     --flow-name remote-spike test-flows/remote-display-spike.py
# The libraries the imports need (ts_wifi, ts_http_server, thingstudio_gui, remote_display) are installed
# by the same command (when it is not handed an inventory it asks the board). The board password must be
# set first (the editor's board settings action, over USB): without it the remote display's login answers
# 503 and the page says so -- fail closed.
#
# Console: boot lines named above; `REMOTE_DISPLAY http://<ip>/ts/remote/` once the server is up. Open that on
# the phone, log in with the board password; the spike's latency prints are on the page's console ([rd]).

import time
import machine
import runtime
import ts_wifi
import ts_http_server
import thingstudio_gui
import ts_remote

# ---- edit these two lines for your network -----------------------------------------------------
SSID = "YOUR_WIFI_SSID"
PASSWORD = "YOUR_WIFI_PASSWORD"
LED_PIN = 2        # the onboard LED on the classic ESP32 dev boards; change for yours

# "password" (or "open") is what makes ts_wifi call .connect(); "unmanaged" only activates the radio and
# is the flow author's opt-out for a link something else owns, which would leave this flow with no IP.
ts_wifi.ensure_station(SSID, PASSWORD, "password", False)

# ---- screens: the phone's page tree (SPEC form; see interfaces/remote-display/SPEC.md) ----------------
DEF = {
    "v": 1,
    "display": "phone",
    "carousel": ["home", "settings"],
    "minIntervalMs": 100,
    "pages": [
        {"name": "home", "tree": {
            "kind": "column", "gap": 8, "padding": 8, "children": [
                {"kind": "row", "gap": 12, "card": True, "padding": 10, "children": [
                    {"wid": "temp", "kind": "readout", "config": {"caption": "Temperature", "units": "C", "decimals": 1}},
                    {"wid": "hum", "kind": "readout", "config": {"caption": "Humidity", "units": "%", "decimals": 0,
                                                                 "grow": 1}},
                ]},
                {"wid": "level", "kind": "bar", "config": {"lo": 0, "hi": 100},
                 "grow": 1, "alignSelf": "stretch"},
                {"kind": "row", "gap": 8, "children": [
                    {"wid": "led", "kind": "led", "config": {}},
                    {"wid": "pump", "kind": "button",
                     "config": {"mode": "toggle", "controlled": True, "onText": "PUMP ON", "offText": "PUMP OFF"}},
                    {"wid": "boop", "kind": "button", "config": {"mode": "momentary", "text": "BOOP"}},
                ]},
                {"kind": "row", "gap": 8, "justify": "space-between", "children": [
                    {"wid": "to_set", "kind": "button", "config": {"mode": "navigate", "target": "settings",
                                                                  "text": "Settings"}},
                    {"wid": "next", "kind": "button", "config": {"mode": "navigate", "target": "next", "text": "Next"}},
                ]},
                {"wid": "pos", "kind": "ctl", "config": {"lo": 0, "hi": 100, "label": "LED level"}},
            ],
        }},
        {"name": "settings", "parent": "home", "tree": {
            "kind": "column", "gap": 8, "padding": 8, "children": [
                {"wid": "th", "kind": "number", "config": {"label": "Threshold", "key": "threshold", "default": 22, "form": "cfg"}},
                {"wid": "name", "kind": "text", "config": {"label": "Board name", "key": "name", "default": "", "form": "cfg"}},
                {"wid": "save", "kind": "submit", "config": {"form": "cfg", "label": "Save"}},
                {"wid": "back", "kind": "button", "config": {"mode": "navigate", "target": "home", "text": "Done"}},
            ],
        }},
    ],
    "modals": [
        {"name": "alarm", "priority": 1, "tree": {
            "kind": "column", "gap": 8, "padding": 12, "children": [
                {"wid": "alarm_text", "kind": "label", "config": {"text": "Timer fired"}},
                {"wid": "alarm_ack", "kind": "button", "config": {"mode": "navigate", "target": "back", "text": "Ack"}},
            ],
        }},
    ],
}

# ---- the model: one GUI, one remote surface ------------------------------------------------------------
_gui = thingstudio_gui.GUI(on_error=lambda wid, exc: print("GUI_ERROR %s %r" % (wid, exc)))
_server = runtime.shared('http_server', 80, 'v1', lambda: ts_http_server.Server(80, [], {}))
_remote = ts_remote.Remote(_gui, _server, DEF)
_remote.stage()
_remote.set_link_policy("safe", 400)

# The other route on the same server the spike brief asks for: mount() with a static body, the
# server as a general facility and the display as one mount among several.
_server.mount({"id": "spike_info", "method": "GET", "path": "/ts/spike-info"},
              static=(200, "text/plain",
                      b"remote display spike is running; the display lives at /ts/remote/", []))

# A board actuator, touched the keyed-singleton way even here: the LED, later the PWM on the same pin.
# (The editor-side claimResource() pass cannot run for a hand-written flow -- noted in the spike results.)
_pin = runtime.shared('pin', 'led:%d' % LED_PIN, 'v1', lambda: machine.Pin(LED_PIN, machine.Pin.OUT))
_pwm = runtime.shared('pwm', 'led:%d' % LED_PIN, 'v1', lambda: machine.PWM(_pin))

_pin.value(0)


async def _setup():
    """Everything the flow runs: start the server, then the model and its sinks, for the life of the flow."""
    await _remote.start()
    runtime.spawn(_gui.run(), "remote_display")
    runtime.spawn(_values(), "remote_display")
    runtime.spawn(_pump(), "remote_display")
    runtime.spawn(_boop(), "remote_display")
    runtime.spawn(_level(), "remote_display")
    runtime.spawn(_failsafe(), "remote_display")
    runtime.spawn(_modal(), "remote_display")


async def _values():
    """The live clock: whatever the flow computes, on a timer. Both readouts and the bar."""
    i = 0
    while True:
        i += 1
        _gui.set_value("temp", 21.0 + (i % 5) * 0.1)
        _gui.set_value("hum", 40 + (i % 17) * 3)
        _gui.set_value("level", (i * 7) % 100)
        await runtime.asyncio.sleep_ms(2000)


async def _pump():
    """The controlled toggle: its event drives the real output, then the flow confirms the state."""
    while True:
        on = await _gui.event("pump")
        _pin.value(1 if on is True else 0)
        _gui.set_value("pump", on)
        print("PUMP %r" % (on,))


async def _boop():
    while True:
        go = await _gui.event("boop")
        print("BOOP", go)


async def _level():
    """Continuous input -> the PWM duty; the LED's brightness follows the slider, latest value wins."""
    while True:
        msg = await _remote.control()
        pos = msg['payload']
        if isinstance(pos, (int, float)) and 0 <= pos <= 100:
            _pwm.duty_u16(int(pos * 65535 / 100))


async def _failsafe():
    """The safe outcome of a lost link or an out-of-input deadman: the actuator goes off, not stuck."""
    while True:
        state = await _remote.link_change()
        if state == "down":
            _pwm.duty_u16(0)
            _pin.value(0)
            _gui.set_value("pump", False)
            print("REMOTE_SAFE led off")


async def _modal():
    _gui.watch_modal("phone", "alarm")
    while True:
        await runtime.asyncio.sleep_ms(30000)
        _gui.open_modal("phone", "alarm", "the 30 s timer fired")
        why = await _gui.modal_closed("phone", "alarm")
        print("ALARM closed (%s)" % (why,))


runtime.spawn(_setup(), "remote_display")
