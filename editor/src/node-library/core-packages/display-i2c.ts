// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/display-i2c.ts
//
// I2C mono/OLED display sink as a core package (node-format-parity phase 4, option A). Same descriptor the
// TypeScript display-i2c.ts carried, plus a `.node.py` ported from its codegen. `resources` declares the I2C bus
// with a legacy `fallback`: a flow saved before the shared bus config (2026-09-26) carries i2cBus/scl/sda/freq on
// the node itself, still compiled from those. Those four are declared as `hidden` properties so the package's
// Python can read them without showing them in the property panel. The bus object is fetched with
// runtime.shared('i2c', ...), shared with every other I2C node on the bus.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/display_i2c",
  kind: "sink",
  paletteId: "display_i2c",
  label: "display i2c",
  group: "hardware",
  priority: 41,
  color: "#3f2e8a",
  bgcolor: "#1f144a",
  icon: "▦",
  width: 128,
  presetType: "display_i2c",
  description:
    "Shows a frame on an I2C mono OLED. msg.payload is a MONO_VLSB framebuffer of width × height/8 bytes, built " +
    "upstream.",
  ports: {
    inputs: [{ name: "frame", type: "bytes" }],
  },
  resources: [
    { kind: "i2c", config: "i2cConfigId", fallback: { bus: "i2cBus", scl: "scl", sda: "sda", freq: "freq" } },
  ],
  properties: [
    {
      name: "controller",
      label: "controller",
      kind: "select",
      default: "ssd1306",
      options: [{ value: "ssd1306", label: "SSD1306" }],
    },
    { name: "i2cConfigId", label: "I2C bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "" },
    { name: "addr", label: "address", kind: "number", default: 0x3c, min: 0, max: 127 },
    { name: "width", label: "width (px)", kind: "number", default: 128, min: 1 },
    { name: "height", label: "height (px, multiple of 8)", kind: "number", default: 64, min: 8, step: 8 },
    // Legacy pre-config bus pins: read by the package's Python (and claimed via the resource fallback), hidden
    // from the panel.
    { name: "i2cBus", label: "i2c bus", kind: "number", default: 0, hidden: true },
    { name: "scl", label: "scl pin", kind: "pin", default: "", optional: true, hidden: true },
    { name: "sda", label: "sda pin", kind: "pin", default: "", optional: true, hidden: true },
    { name: "freq", label: "frequency (Hz)", kind: "number", default: 400000, hidden: true },
  ],
};

export const python = `import machine
from ssd1306 import SSD1306_I2C

_bus = properties['i2cConfigId']
_legacy_bus = properties['i2cBus']
_legacy_scl = properties['scl']
_legacy_sda = properties['sda']
_legacy_freq = properties['freq']
_addr = properties['addr']
_width = properties['width']
_height = properties['height']

if _bus is not None:
    _bus_num = int(_bus['bus'])
    _scl = _bus['scl']
    _sda = _bus['sda']
    _freq = _bus['freq']
else:
    # Legacy: the pins live on the node itself (a flow saved before the shared bus config).
    _bus_num = 0 if _legacy_bus is None else int(_legacy_bus)
    _scl = _legacy_scl
    _sda = _legacy_sda
    _freq = 400000 if _legacy_freq is None else _legacy_freq

_i2c = runtime.shared('i2c', _bus_num, (_scl, _sda, _freq),
                      lambda: machine.I2C(_bus_num, scl=machine.Pin(_scl), sda=machine.Pin(_sda), freq=_freq))
_disp = SSD1306_I2C(_width, _height, _i2c, addr=_addr)
_expected = _width * (_height // 8)


async def run(msg, properties):
    _buf = msg.get('payload', b'')
    if len(_buf) != _expected:
        raise ValueError('display_i2c: expected %d bytes (%dx%d MONO_VLSB), got %d' % (_expected, _width, _height, len(_buf)))
    _disp.buffer[:] = _buf
    _disp.show()
`;
