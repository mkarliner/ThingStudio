// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-advertise.ts
//
// ble_advertise as a core package (2026-11-03, BLE phase 1: docs/working-notes/ble-nodes-scoping.md). A sink: the
// board advertises its name from flow start, and each message replaces the manufacturer or service data with
// msg.payload. The name is the flow's BLE config (phase 2; ble-shared.ts). The advertisement is connectable when the
// flow has GATT nodes (ts_ble's radio decides). The radio is ts_ble's.
//
// The hook checks what is known before deploy: one ble_advertise per flow (the radio sends one advertisement), and
// that the name and the field's header fit in 31 bytes. The payload's own size is only known at run time; an
// over-long one is reported naming both sizes and dropped, never raised (a raising sink would end its source's loop).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_CONFIG_FIELD, BLE_NAME_DERIVATION } from "./ble-shared.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_advertise",
  kind: "sink",
  paletteId: "ble_advertise",
  label: "ble advertise",
  group: "network",
  priority: 61,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 116,
  description:
    "Advertises over Bluetooth LE: the board's name from flow start, and msg.payload as manufacturer or service " +
    "data. Phones, computers and other boards (a ble scan node) see it without connecting. Name and payload share 31 bytes.",
  requires: { capabilities: ["ble"] },
  allowUnwired: true,
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    {
      name: "field",
      label: "payload goes in",
      kind: "select",
      default: "manufacturer",
      options: [
        { value: "manufacturer", label: "manufacturer data" },
        { value: "service", label: "service data" },
        { value: "none", label: "nothing (name only)" },
      ],
    },
    { name: "mfrId", label: "manufacturer id", kind: "text", default: "0xFFFF", help: "Hex with 0x, or decimal. 0xFFFF is reserved for testing; a product uses its maker's Bluetooth SIG id.", visibleWhen: { field: "field", equals: "manufacturer" } },
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "fcd2", help: "16-bit (fcd2 is BTHome) or 128-bit.", visibleWhen: { field: "field", equals: "service" } },
    { name: "advIntervalMs", label: "interval (ms)", kind: "number", default: 500, min: 20, max: 10240, help: "How often the advertisement is sent. Shorter is found faster and uses more power." },
    { ...BLE_CONFIG_FIELD, help: "The board's Bluetooth name, which other devices show when they find it. Every byte of it is a byte less for the payload. Without one, the board is called thingstudio." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${BLE_NAME_DERIVATION}
_LIMIT = 31


def compile(ctx, properties):
    errors = []
    others = [n['id'] for n in ctx['nodesOfType'] if n['id'] != ctx['node']['id']]
    if others:
        errors.append('only one ble_advertise per flow: the board sends one advertisement (also: ' + ', '.join(others) + ')')

    name, err = _ble_name(ctx)
    if err:
        return {'errors': [err]}
    field = properties.get('field', 'manufacturer')
    if field not in ('manufacturer', 'service', 'none'):
        errors.append('ble_advertise "payload goes in" must be manufacturer, service or none')
    out = {'bleName': name, 'field': field, 'mfrId': None, 'serviceUuid': None}

    header = 0
    if field == 'manufacturer':
        raw = str(properties.get('mfrId') or '').strip()
        try:
            v = int(raw, 16) if raw.lower().startswith('0x') else int(raw)
        except ValueError:
            v = -1
        if v < 0 or v > 0xFFFF:
            errors.append('ble_advertise manufacturer id "' + raw + '" must be 0-65535, or hex like 0xFFFF')
        out['mfrId'] = v
        header = 4
    elif field == 'service':
        raw = str(properties.get('serviceUuid') or '').strip()
        u = _ble_uuid(raw)
        if u is None:
            errors.append('ble_advertise service UUID "' + raw + '" must be 16-bit (fcd2) or 128-bit hex')
            return {'errors': errors}
        out['serviceUuid'] = u
        header = 2 + (2 if len(u) == 4 else 16)

    used = 3 + (2 + len(name.encode()) if name else 0) + header
    if used > _LIMIT:
        errors.append(
            'ble_advertise: the BLE name "' + name + '" leaves no room: ' + str(used) + ' of ' + str(_LIMIT) +
            ' bytes before any payload. Shorten the name in the BLE config')
    out['payloadRoom'] = _LIMIT - used

    try:
        interval = float(properties.get('advIntervalMs', 500))
    except (TypeError, ValueError):
        interval = -1
    if not (20 <= interval <= 10240):
        errors.append('ble_advertise interval must be 20-10240 ms (Bluetooth limits)')
    out['advIntervalMs'] = interval

    if errors:
        return {'errors': errors}
    return {'properties': out}
`;

export const python = `import ts_ble

_radio = ts_ble.radio()
_node_id = properties['nodeId']
_name = properties['bleName']
_field = properties['field']
_mfr_id = properties['mfrId']
_svc_uuid = properties['serviceUuid']
_interval = properties['advIntervalMs']


def _adv(payload):
    if _field == 'manufacturer':
        return ts_ble.build_adv(_name, mfr_id=_mfr_id, mfr=payload)
    if _field == 'service':
        return ts_ble.build_adv(_name, svc_uuid=_svc_uuid, svc=payload)
    return ts_ble.build_adv(_name)


_radio.advertise(_node_id, _interval, _adv(b''))
runtime.report_status(_node_id, 'connected', 'advertising, %d bytes free for the payload' % properties['payloadRoom'])


async def run(msg, properties):
    p = msg.get('payload')
    if isinstance(p, (bytes, bytearray)):
        data = bytes(p)
    elif isinstance(p, str):
        data = p.encode()
    else:
        runtime._report_error(_node_id, ValueError(
            'ble_advertise: payload is %s, not bytes or text; pack a number first (struct.pack in a function node)' % type(p).__name__))
        return
    try:
        adv = _adv(data)
    except ValueError as e:
        runtime._report_error(_node_id, ValueError('ble_advertise: %s' % e))
        return
    _radio.advertise(_node_id, _interval, adv)
`;
