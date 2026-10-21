// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/touch-i2c.ts
//
// Raw touch input as a core package (2026-10-21): polls an FT6336U from a touch-panel config and emits
// {x, y} down/up messages. The panel config names its I2C bus config; the descriptor's i2c resource follows that
// nested reference (`nestedField`) so the generic codegen still does the board checks and claims the bus. The
// optional reset pin is claimed by the hook and shared through runtime.shared('pin'), like the built-in did.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/touch_i2c",
  kind: "source",
  paletteId: "touch_i2c",
  label: "touch",
  group: "hardware",
  priority: 16,
  color: "#8a2e6e",
  bgcolor: "#4a1f3a",
  icon: "☞",
  width: 100,
  description:
    "Raw touch from the flow's touch panel config (FT6336U): {x, y} with topic 'down' when a finger lands and 'up' " +
    "when it lifts. One panel feeds one touch node or one gui screen, not both.",
  resources: [{ kind: "i2c", config: "touchPanelConfigId", nestedField: "i2cConfigId" }],
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "touchPanelConfigId", label: "Touch panel", kind: "configRef", configType: "thingstudio/config/touch-panel", default: "" },
    // Hidden: the poll interval comes from the panel config; the hook maps it here for the package source loop.
    { name: "intervalMs", label: "interval", kind: "number", default: 20, hidden: true },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `def _whole(props, name, dflt, low, what):
    raw = props.get(name)
    if raw is None or raw == '':
        raw = dflt
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None, 'touch panel %s "%s" must be a whole number, %d or more' % (what, raw, low)
    if value < low:
        return None, 'touch panel %s "%s" must be a whole number, %d or more' % (what, raw, low)
    return value, None

def compile(ctx, properties):
    panel_id = str(properties.get('touchPanelConfigId') or '')
    if not panel_id:
        return {'errors': ['%s has no touch panel. Pick one, or add one with +.' % ctx['node']['type']]}
    panel = (ctx.get('referencedConfigs') or {}).get(panel_id)
    if panel is None:
        return {'errors': ['could not resolve the touch panel config -- reopen the flow in the editor']}
    me = ctx['node']['id']
    for other in ctx['flow']['nodes']:
        if other['id'] == me:
            continue
        if other['type'] not in ('thingstudio/gui_screen', 'thingstudio/touch_i2c'):
            continue
        props = other.get('properties') or {}
        if str(props.get('touchPanelConfigId') or '') == panel_id:
            return {'errors': ['node %s and node %s both use the same touch panel. A panel feeds one gui screen or one touch node, not both.' % (me, other['id'])]}

    controller = str(panel.get('controller') or 'ft6336u')
    if controller != 'ft6336u':
        return {'errors': ['touch panel controller "%s" is not supported yet (FT6336U only)' % controller]}
    bus_id = str(panel.get('i2cConfigId') or '')
    if not bus_id:
        return {'errors': ['the touch panel has no I2C bus. Pick one, or add one with +.']}
    bus = None
    for config in ctx['flow']['configs']:
        if config['id'] == bus_id:
            bus = config.get('properties') or {}
            break
    if bus is None:
        return {'errors': ['could not resolve the touch panel I2C bus -- reopen the flow in the editor']}

    raw_address = panel.get('address', '0x38')
    try:
        address = raw_address if isinstance(raw_address, int) else int(str(raw_address), 0)
    except (TypeError, ValueError):
        return {'errors': ['touch panel address "%s" must be 0x08 to 0x77' % raw_address]}
    if address < 0x08 or address > 0x77:
        return {'errors': ['touch panel address "%s" must be 0x08 to 0x77' % raw_address]}
    poll, err = _whole(panel, 'pollMs', 20, 5, 'poll interval')
    if err:
        return {'errors': [err]}
    width, err = _whole(panel, 'width', 320, 1, 'width')
    if err:
        return {'errors': [err]}
    height, err = _whole(panel, 'height', 480, 1, 'height')
    if err:
        return {'errors': [err]}
    rst_raw = panel.get('rstPin')
    rst = -1
    if rst_raw is not None and rst_raw != '':
        try:
            rst = int(rst_raw)
        except (TypeError, ValueError):
            return {'errors': ['touch panel reset pin "%s" must be a pin number' % rst_raw]}

    claims = []
    if rst >= 0:
        claims.append({'resource': 'GPIO %d' % rst, 'use': 'output'})
    return {'properties': {
        'bus': bus.get('bus', 0), 'scl': bus.get('scl'), 'sda': bus.get('sda'),
        'freq': bus.get('freq', 400000), 'address': address, 'rstPin': rst,
        'width': width, 'height': height,
        'swapXY': panel.get('swapXY') is True, 'flipX': panel.get('flipX') is True,
        'flipY': panel.get('flipY') is True, 'pollMs': poll, 'intervalMs': poll,
        'where': 'FT6336U at 0x%x on I2C bus %s' % (address, bus.get('bus', 0)),
    }, 'claims': claims}
`;

export const python = `import machine
import ft6336u
import runtime

_bus = runtime.shared(
    'i2c', properties['bus'], (properties['scl'], properties['sda'], properties['freq']),
    lambda: machine.I2C(properties['bus'], scl=machine.Pin(properties['scl']),
                        sda=machine.Pin(properties['sda']), freq=properties['freq']))
_rst = None
if properties['rstPin'] >= 0:
    _rst = runtime.shared('pin', properties['rstPin'], ('out', 'none'),
                          lambda: machine.Pin(properties['rstPin'], machine.Pin.OUT))
_dev = None
_last = None
_state = None
_where = properties['where']
_node_id = properties['nodeId']


def _report(state, text):
    nonlocal _state
    if _state != (state, text):
        _state = (state, text)
        runtime.report_status(_node_id, state, text)


async def emit(properties):
    nonlocal _dev, _last
    try:
        if _dev is None:
            _dev = ft6336u.FT6336U(_bus, properties['address'], _rst, properties['width'],
                                   properties['height'], properties['swapXY'], properties['flipX'],
                                   properties['flipY'])
        _pt = _dev.read()
    except OSError:
        _dev = None
        _report('disconnected', 'no reply from ' + _where)
        return None
    except Exception as _e:
        _dev = None
        _report('error', str(_e))
        return None
    _report('connected', 'FT6336U')
    if _pt is not None:
        if _last is None:
            _last = _pt
            return {'payload': {'x': _pt[0], 'y': _pt[1]}, 'topic': 'down'}
        _last = _pt
        return None
    if _last is not None:
        _msg = {'payload': {'x': _last[0], 'y': _last[1]}, 'topic': 'up'}
        _last = None
        return _msg
    return None
`;
