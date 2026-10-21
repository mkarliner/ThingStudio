// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/adc.ts
//
// ADC as a core package (2026-10-21). Wraps Peter Hinch's AADC: waits on the configured bounds (or the poll
// interval), then emits {raw, volts, percent}. The descriptor's pin resource carries the classic-ESP32 ADC2 + WiFi
// refusal, checked by the generic resource codegen where the processor's adc2 pin set lives.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/adc",
  kind: "source",
  eventSource: true,
  paletteId: "adc",
  label: "adc",
  group: "hardware",
  priority: 13,
  color: "#6e8a2e",
  bgcolor: "#3a4a1f",
  icon: "∼",
  width: 110,
  description:
    "Reads an analog pin and sends {raw, volts, percent} when the reading crosses the bounds, and at each poll if " +
    "poll is set. raw runs from 0 to 65535.",
  resources: [{ kind: "pin", property: "pin", direction: "input", use: "ADC input", noAdc2WithWifi: true }],
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 34, help: "On ESP32, an ADC2 pin can't be used in a flow with WiFi: Deploy refuses it." },
    {
      name: "mode",
      label: "mode",
      kind: "select",
      default: "relative",
      options: [
        { value: "relative", label: "relative -- fire when it moves by delta from the last message" },
        { value: "absolute", label: "absolute -- fire outside lower..upper" },
      ],
    },
    { name: "delta", label: "delta (counts)", kind: "number", default: 2000, min: 1, visibleWhen: { field: "mode", equals: "relative" } },
    { name: "lower", label: "lower", kind: "number", default: 0, min: 0, max: 65535, visibleWhen: { field: "mode", equals: "absolute" } },
    { name: "upper", label: "upper", kind: "number", default: 50000, min: 0, max: 65535, visibleWhen: { field: "mode", equals: "absolute" } },
    {
      name: "sense",
      label: "sense",
      kind: "select",
      default: "outside",
      options: [
        { value: "outside", label: "outside -- fire when it leaves the bounds (default)" },
        { value: "inside", label: "inside -- fire when it returns to them" },
      ],
    },
    { name: "pollMs", label: "poll (ms)", kind: "number", default: 0, min: 0, help: "0 sends only when the reading crosses the bounds." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `def _adc_whole(properties, name, default):
    raw = properties.get(name)
    if raw is None:
        raw = default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None

def compile(ctx, properties):
    mode = str(properties.get('mode') or 'relative')
    if mode not in ('relative', 'absolute'):
        return {'errors': ['adc mode "%s" must be relative or absolute' % mode]}
    delta = _adc_whole(properties, 'delta', 2000)
    if delta is None or delta <= 0:
        return {'errors': ['adc delta "%s" must be more than 0' % properties.get('delta')]}
    lower = _adc_whole(properties, 'lower', 0)
    upper = _adc_whole(properties, 'upper', 50000)
    if lower is None or upper is None:
        return {'errors': ['adc lower and upper must be whole numbers']}
    if lower < 0 or upper > 65535:
        return {'errors': ['adc lower/upper must be within 0..65535']}
    if mode == 'absolute' and lower >= upper:
        return {'errors': ['adc lower (%d) must be less than upper (%d)' % (lower, upper)]}
    sense = str(properties.get('sense') or 'outside')
    if sense not in ('outside', 'inside'):
        return {'errors': ['adc sense "%s" must be outside or inside' % sense]}
    poll = _adc_whole(properties, 'pollMs', 0)
    if poll is None or poll < 0:
        return {'errors': ['adc pollMs "%s" must be 0 or more' % properties.get('pollMs')]}
    return {'properties': {'mode': mode, 'delta': delta, 'lower': lower, 'upper': upper,
                           'senseInside': sense == 'inside', 'pollMs': poll}}
`;

export const python = `import asyncio
import machine
import runtime
from aadc import AADC

_pin = properties['pin']
_adc = runtime.shared('adc', _pin, (), lambda: machine.ADC(machine.Pin(_pin)))
_aadc = AADC(_adc)
if properties['senseInside']:
    _aadc.sense(False)
_mode = properties['mode']
_delta = properties['delta']
_lower = properties['lower']
_upper = properties['upper']
_poll = properties['pollMs']
_node_id = properties['nodeId']
_last_error = [None]


async def _bounds():
    if _mode == 'absolute':
        await _aadc(_lower, _upper)
    else:
        await _aadc(_delta)


async def wait(properties):
    if _poll > 0:
        try:
            await asyncio.wait_for(_bounds(), _poll / 1000)
        except asyncio.TimeoutError:
            pass
    else:
        await _bounds()


async def emit(properties):
    try:
        _raw = _adc.read_u16()
    except Exception as _e:
        _message = str(_e)
        if _last_error[0] != _message:
            _last_error[0] = _message
            runtime.report_status(_node_id, 'error', _message)
        return None
    _last_error[0] = None
    try:
        _volts = _adc.read_uv() / 1000000
    except AttributeError:
        _volts = _raw * 3.3 / 65535
    return {'payload': {'raw': _raw, 'volts': round(_volts, 3), 'percent': round(_raw * 100 / 65535, 1)}, 'topic': ''}
`;
