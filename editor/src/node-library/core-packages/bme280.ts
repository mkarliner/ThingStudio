// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/bme280.ts
//
// BME280 / BMP280 environment sensor as a core package (node-format-parity phase 4, option A). Same descriptor
// the TypeScript bme280.ts carried, plus a `.node.py` ported from its codegen. The one new piece of descriptor
// data is `resources`: an I2C bus, so the generic package codegen restores the compile-time checks bme280.ts got
// from resolveI2cBus (bus/pins validated, both pins claimed, two in-use configs on one bus refused) --
// resource-check.ts. The shared bus object itself is fetched in Python through runtime.shared('i2c', ...), the
// on-device keyed singleton (i2c-shared.ts).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/bme280",
  kind: "source",
  paletteId: "bme280",
  label: "bme280",
  group: "hardware",
  priority: 15,
  color: "#8a4a2e",
  bgcolor: "#4a2a1f",
  icon: "°",
  width: 110,
  description:
    "Sends {temperature °C, humidity %, pressure hPa} in msg.payload. A BMP280 works too; its humidity is null. " +
    "The status dot shows whether the sensor is answering.",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  resources: [{ kind: "i2c", config: "i2cConfigId" }],
  properties: [
    { name: "i2cConfigId", label: "I2C bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "" },
    {
      name: "address",
      label: "address",
      kind: "select",
      default: 0x76,
      options: [
        { value: 0x76, label: "0x76 (SDO to GND, most boards)" },
        { value: 0x77, label: "0x77 (SDO to VCC)" },
      ],
    },
    { name: "intervalMs", label: "interval (ms)", kind: "number", default: 5000, min: 100 },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `import machine
import bme280_float

_bus = properties['i2cConfigId']
_address = properties['address']
_node_id = properties['nodeId']
_dev = None
_state = None

if _bus is None:
    raise ValueError('bme280: pick an I2C bus in the node properties')

_bus_num = int(_bus['bus'])
if _bus.get('scl') is None or _bus.get('sda') is None:
    raise ValueError('bme280: set the SCL and SDA pins on the I2C bus config')

# The same shared bus object every I2C node uses, keyed by bus id (i2c-shared.ts / runtime.shared).
_i2c = runtime.shared('i2c', _bus_num, (_bus['scl'], _bus['sda'], _bus['freq']),
                      lambda: machine.I2C(_bus_num, scl=machine.Pin(_bus['scl']),
                                          sda=machine.Pin(_bus['sda']), freq=_bus['freq']))


def _status(state, text):
    nonlocal _state
    if _state != (state, text):
        _state = (state, text)
        runtime.report_status(_node_id, state, text)


async def emit(properties):
    nonlocal _dev
    try:
        if _dev is None:
            _dev = bme280_float.BME280(i2c=_i2c, address=_address)
        _t, _p, _h = await _dev.read_async()
    except OSError:
        _dev = None
        _status('disconnected', 'no reply at 0x%02x on I2C bus %d' % (_address, _bus_num))
        return None
    except Exception as _e:
        _dev = None
        _status('error', str(_e))
        return None
    else:
        _status('connected', 'BME280' if _dev.has_humidity else 'BMP280')
        return {'payload': {'temperature': round(_t, 2),
                            'humidity': None if _h is None else round(_h, 2),
                            'pressure': round(_p / 100, 2)},
                'topic': ''}
`;
