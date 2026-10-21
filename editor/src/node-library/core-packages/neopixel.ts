// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/neopixel.ts
//
// WS2812 / NeoPixel strip sink as a core package (node-format-parity phase 4, option A). Same descriptor the
// TypeScript neopixel.ts carried, plus a `.node.py` ported from its codegen. `resources` claims the data pin as
// an output and adds the derived "GPIO p neopixel" claim (count/order), so two strips with different settings on
// one pin still conflict (resource-check.ts); the Python fetches the shared Pin through runtime.shared('pin', ...).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/neopixel",
  kind: "sink",
  paletteId: "neopixel",
  label: "neopixel",
  group: "hardware",
  priority: 42,
  color: "#8a2e5a",
  bgcolor: "#4a1f30",
  icon: "✦",
  width: 110,
  description:
    "Drives a WS2812 / NeoPixel strip. Payload is a colour 0xRRGGBB for the whole strip, a list of colours for " +
    "one per pixel, or {index, colour} for one pixel. RGBW strips take 0xWWRRGGBB.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  resources: [
    {
      kind: "pin",
      property: "pin",
      direction: "output",
      use: "output",
      claim: { resource: "{pin} neopixel", use: "count {count}, order {order}" },
    },
  ],
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 13 },
    { name: "count", label: "count", kind: "number", default: 8, min: 1 },
    {
      name: "order",
      label: "order",
      kind: "select",
      default: "GRB",
      options: [
        { value: "GRB", label: "GRB -- most WS2812 strips (default)" },
        { value: "RGB", label: "RGB" },
        { value: "RGBW", label: "RGBW -- with a white channel" },
        { value: "GRBW", label: "GRBW -- with a white channel" },
      ],
    },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `import machine
import neopixel

_pin = properties['pin']
_count = properties['count']
_order = str(properties['order'])
_node_id = properties['nodeId']
_bpp = 4 if _order.endswith('W') else 3

_gpio = runtime.shared('pin', _pin, ('out', 'none'), lambda: machine.Pin(_pin, machine.Pin.OUT))
_neo = neopixel.NeoPixel(_gpio, _count, bpp=_bpp)


def _colour(_c):
    _r = (_c >> 16) & 0xff
    _g = (_c >> 8) & 0xff
    _b = _c & 0xff
    _w = (_c >> 24) & 0xff
    if _order == 'RGB':
        return (_r, _g, _b)
    if _order == 'GRB':
        return (_g, _r, _b)
    if _order == 'RGBW':
        return (_r, _g, _b, _w)
    return (_g, _r, _b, _w)


async def run(msg, properties):
    try:
        _p = msg.get('payload')
        if isinstance(_p, dict):
            _neo[int(_p.get('index', 0))] = _colour(int(_p.get('colour', _p.get('color', 0))))
        elif isinstance(_p, (list, tuple)):
            for _i in range(min(len(_p), _count)):
                _neo[_i] = _colour(int(_p[_i]))
        else:
            _col = _colour(int(_p))
            for _i in range(_count):
                _neo[_i] = _col
        _neo.write()
    except Exception as _e:
        runtime.report_status(_node_id, 'error', str(_e))
`;
