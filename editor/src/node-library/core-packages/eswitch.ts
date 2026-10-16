// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/eswitch.ts
//
// Debounced digital-input source as a core package (node-format-parity phase 4, option A). Same descriptor the
// TypeScript eswitch.ts carried, plus a `.node.py` ported from its codegen. Two hardware-resource choices:
//   - the pin is claimed as an input with its configurable pull (pullProperty), so the claim text and the
//     no-internal-pull warning follow the `pull` property;
//   - the ESwitch driver is a keyed singleton via runtime.shared('eswitch', pin, ...), so two eswitch nodes on one
//     pin with the same settings share one driver (the built-in got this from a fixed-name, mergeSetup-deduped
//     statement). The WaitAny wrapper is per instance (two coroutines sharing one WaitAny would race its internal
//     bookkeeping).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/eswitch",
  kind: "source",
  eventSource: true,
  paletteId: "eswitch",
  label: "eswitch",
  group: "hardware",
  priority: 11,
  color: "#a67c3f",
  bgcolor: "#4a3a1f",
  icon: "○",
  width: 104,
  description:
    "Sends a message each time the switch opens or closes. msg.payload is true when closed. Set pull to use the " +
    "pin's own pull resistor, or leave it at none if the switch has one.",
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  resources: [
    {
      kind: "pin",
      property: "pin",
      direction: "input",
      pullProperty: "pull",
      claim: { resource: "{pin} eswitch", use: "open level {lopen}, debounce {debounceMs} ms" },
    },
  ],
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 4 },
    {
      name: "pull",
      label: "pull",
      kind: "select",
      default: "none",
      options: [
        { value: "none", label: "none -- external pull or self-pulling switch (default)" },
        { value: "up", label: "up -- enable the pin's internal pull-up" },
        { value: "down", label: "down -- enable the pin's internal pull-down" },
      ],
    },
    {
      name: "lopen",
      label: "open level (lopen)",
      kind: "select",
      default: 1,
      options: [
        { value: 1, label: "1 -- switch to gnd, pulled up (default)" },
        { value: 0, label: "0 -- switch to 3V3, pulled down" },
      ],
    },
    { name: "debounceMs", label: "debounce (ms)", kind: "number", default: 50, min: 1 },
  ],
};

export const python = `import machine
from events import ESwitch, WaitAny

_pin_num = properties['pin']
_pull = str(properties['pull'])
_lopen = properties['lopen']
_debounce_ms = properties['debounceMs']

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
    # ESwitch.debounce_ms is a class attribute, read once in __init__ -- set it just before constructing this one
    # (eswitch.ts's header / the vendored README have the full trace).
    ESwitch.debounce_ms = _debounce_ms
    return ESwitch(_pin, lopen=_lopen)


_pin = runtime.shared('pin', _pin_num, ('in', _pull), _make_pin)
_es = runtime.shared('eswitch', _pin_num, (_debounce_ms, int(_lopen), _pull), _make_driver)
_wait = WaitAny([_es.close, _es.open])
_trig = None


async def wait(properties):
    nonlocal _trig
    _trig = await _wait.wait()


async def emit(properties):
    # Clear only the event that fired, not every event WaitAny watches (events.py's own WaitAny.clear() would).
    _is_close = _trig is _es.close
    _trig.clear()
    return {'payload': _is_close, 'topic': ''}
`;
