// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/encoder.ts
//
// Quadrature encoder source as a core package (node-format-parity phase 4, option A). Same descriptor the
// TypeScript encoder.ts carried, plus a `.node.py` ported from its codegen. Two deliberate deviations, agreed
// with Mike (2026-10-16):
//   - `vmin`/`vmax`/`mod` are `text` fields with `integer` + `optional` (blank -> None) instead of number fields
//     with a blank default: the generic number field inlines blank as 0, and the format has no optional-number
//     field. Blank still means "none"; the panel shows a text box rather than a number spinner.
//   - the "start value outside vmin/vmax" compile check is dropped: the vendored Encoder clamps the start value
//     itself, so on-device behaviour is unchanged.
// The two pins are claimed with distinct use texts ("encoder x"/"encoder y"), so `pinX == pinY` is a claim
// conflict; the Encoder driver is a keyed singleton via runtime.shared('encoder', (x, y), ...).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/encoder",
  kind: "source",
  eventSource: true,
  paletteId: "encoder",
  label: "encoder",
  group: "hardware",
  priority: 14,
  color: "#8a3f7a",
  bgcolor: "#4a1f42",
  icon: "⟳",
  width: 110,
  description:
    "Reads a rotary encoder and sends its value each time it turns. msg.delta is the change since the last " +
    "message.",
  ports: {
    outputs: [{ name: "msg", type: "number" }],
  },
  resources: [
    { kind: "pin", property: "pinX", direction: "input", pull: "up", use: "encoder x input, pull-up" },
    {
      kind: "pin",
      property: "pinY",
      direction: "input",
      pull: "up",
      use: "encoder y input, pull-up",
      claim: {
        resource: "{pinX},{pinY} encoder",
        use: "v {value}, div {div}, vmin {vmin}, vmax {vmax}, mod {mod}, delay {delay}",
      },
    },
  ],
  properties: [
    { name: "pinX", label: "pin x", kind: "pin", default: 10 },
    { name: "pinY", label: "pin y", kind: "pin", default: 11 },
    { name: "div", label: "divide by (div)", kind: "number", default: 1, min: 1, help: "Pulses per detent: 4 or 2 for a knob that clicks." },
    { name: "value", label: "start value", kind: "number", default: 0 },
    { name: "vmin", label: "lowest (blank for none)", kind: "text", default: "", integer: true, optional: true },
    { name: "vmax", label: "highest (blank for none)", kind: "text", default: "", integer: true, optional: true },
    { name: "mod", label: "wrap at (blank for none)", kind: "text", default: "", integer: true, optional: true },
    { name: "delay", label: "settle (ms)", kind: "number", default: 100, min: 0 },
  ],
};

export const python = `import machine
from encoder import Encoder

_pin_x = properties['pinX']
_pin_y = properties['pinY']
_div = properties['div']
_value = properties['value']
_vmin = properties['vmin']
_vmax = properties['vmax']
_mod = properties['mod']
_delay = properties['delay']

_px = runtime.shared('pin', _pin_x, ('in', 'up'), lambda: machine.Pin(_pin_x, machine.Pin.IN, machine.Pin.PULL_UP))
_py = runtime.shared('pin', _pin_y, ('in', 'up'), lambda: machine.Pin(_pin_y, machine.Pin.IN, machine.Pin.PULL_UP))


def _make_encoder():
    _kw = {'v': _value, 'div': _div}
    if _vmin is not None:
        _kw['vmin'] = _vmin
    if _vmax is not None:
        _kw['vmax'] = _vmax
    if _mod is not None:
        _kw['mod'] = _mod
    _kw['delay'] = _delay
    return Encoder(_px, _py, **_kw)


_enc = runtime.shared('encoder', (_pin_x, _pin_y), (_value, _div, _vmin, _vmax, _mod, _delay), _make_encoder)
_prev = _value
_enc_val = None


async def wait(properties):
    nonlocal _enc_val
    _enc_val = await _enc.__anext__()


async def emit(properties):
    nonlocal _prev
    _enc_delta = _enc_val - _prev
    _prev = _enc_val
    return {'payload': _enc_val, 'topic': '', 'delta': _enc_delta}
`;
