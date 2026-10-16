// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ebutton.ts
//
// Button source as a core package (node-format-parity phase 4, option A). Same descriptor the TypeScript
// ebutton.ts carried, plus a `.node.py` ported from its codegen. Same two hardware-resource choices as eswitch:
// the pin is claimed as an input with its configurable pull (pullProperty); the EButton driver is a keyed
// singleton via runtime.shared('ebutton', pin, ...), so two ebutton nodes on one pin with the same settings share
// one driver. EButton.debounce_ms/long_press_ms/double_click_ms are class attributes read once in __init__ -- set
// inside the factory, just before constructing the one instance (ebutton.ts's header / the vendored README).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ebutton",
  kind: "source",
  eventSource: true,
  paletteId: "ebutton",
  label: "ebutton",
  group: "hardware",
  priority: 12,
  color: "#a6633f",
  bgcolor: "#4a2e1f",
  icon: "⏺",
  width: 104,
  description:
    "Sends a message on each press, release, long press and double click. msg.payload is \"press\", \"release\", " +
    "\"long\" or \"double\". Set pull to use the pin's own pull resistor, or leave it at none if the button has " +
    "one. Double click must be shorter than long press.",
  ports: {
    outputs: [{ name: "msg", type: "string" }],
  },
  resources: [
    {
      kind: "pin",
      property: "pin",
      direction: "input",
      pullProperty: "pull",
      claim: {
        resource: "{pin} ebutton",
        use: "sense {senseMode}, suppress {suppress}, debounce {debounceMs} ms, long press {longPressMs} ms, double click {doubleClickMs} ms",
      },
    },
  ],
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 5 },
    {
      name: "pull",
      label: "pull",
      kind: "select",
      default: "none",
      options: [
        { value: "none", label: "none -- external pull or self-pulling button (default)" },
        { value: "up", label: "up -- enable the pin's internal pull-up" },
        { value: "down", label: "down -- enable the pin's internal pull-down" },
      ],
    },
    {
      name: "senseMode",
      label: "sense",
      kind: "select",
      default: "auto",
      options: [
        { value: "auto", label: "auto -- assume not pressed at boot (default)" },
        { value: "0", label: "0 -- unpressed reads as gnd" },
        { value: "1", label: "1 -- unpressed reads as 3V3" },
      ],
    },
    { name: "suppress", label: "suppress (delay/suppress release in favor of double/long)", kind: "boolean", default: false },
    { name: "debounceMs", label: "debounce (ms)", kind: "number", default: 50, min: 1 },
    { name: "longPressMs", label: "long press (ms)", kind: "number", default: 1000, min: 1 },
    { name: "doubleClickMs", label: "double click (ms)", kind: "number", default: 400, min: 1, lessThan: "longPressMs" },
  ],
};

export const python = `import machine
from events import EButton, WaitAny

_pin_num = properties['pin']
_pull = str(properties['pull'])
_sense = str(properties['senseMode'])
_suppress = properties['suppress']
_debounce_ms = properties['debounceMs']
_long_press_ms = properties['longPressMs']
_double_click_ms = properties['doubleClickMs']

if _pull == 'up':
    _pull_mode = machine.Pin.PULL_UP
elif _pull == 'down':
    _pull_mode = machine.Pin.PULL_DOWN
else:
    _pull_mode = None


def _make_pin():
    if _pull_mode is None:
        return machine.Pin(_pin_num, machine.Pin.IN)
    return machine.Pin(_pin_num, machine.Pin.IN, _pull_mode)


def _make_driver():
    # EButton.debounce_ms/long_press_ms/double_click_ms are class attributes, read once in __init__ -- set them
    # just before constructing this one (ebutton.ts's header / the vendored README have the full trace).
    EButton.debounce_ms = _debounce_ms
    EButton.long_press_ms = _long_press_ms
    EButton.double_click_ms = _double_click_ms
    if _sense == 'auto':
        return EButton(_pin, suppress=_suppress)
    return EButton(_pin, suppress=_suppress, sense=int(_sense))


_pin = runtime.shared('pin', _pin_num, ('in', _pull), _make_pin)
_btn = runtime.shared('ebutton', _pin_num, (_debounce_ms, _long_press_ms, _double_click_ms, _suppress, _sense, _pull), _make_driver)
_wait = WaitAny([_btn.press, _btn.release, _btn.long, _btn.double])
_trig = None


async def wait(properties):
    nonlocal _trig
    _trig = await _wait.wait()


async def emit(properties):
    if _trig is _btn.press:
        _event = 'press'
    elif _trig is _btn.release:
        _event = 'release'
    elif _trig is _btn.long:
        _event = 'long'
    else:
        _event = 'double'
    # Clear ONLY the event that fired -- a rapid second click can set both press and double; clearing every event
    # would silently drop the loser (ebutton.ts's header has the full trace).
    _trig.clear()
    return {'payload': _event, 'topic': ''}
`;
