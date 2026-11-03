// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-characteristic-out.ts
//
// ble_characteristic_out (2026-11-03, BLE phase 2: docs/working-notes/ble-nodes-scoping.md). A sink: each message
// sets the characteristic's value, which a phone can read, and notifies every connected phone. The input is `any`
// (an input socket is typed once, when the node is built), so the encoding is checked on the board: a value that
// doesn't fit is reported and dropped, never raised (a raising sink would end its source's loop).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_CONFIG_FIELD, BLE_GATT_DERIVATION, ENCODING_OPTIONS } from "./ble-shared.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_characteristic_out",
  kind: "sink",
  paletteId: "ble_characteristic_out",
  label: "ble characteristic out",
  title: "ble char out",
  group: "network",
  priority: 63,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 116,
  description:
    "Sets a Bluetooth LE characteristic to msg.payload, which a connected phone can read, and notifies the phones " +
    "subscribed to it. The board accepts connections from anyone in range: no pairing.",
  requires: { capabilities: ["ble"] },
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 181a", help: "The service this characteristic belongs to. Use the same one on the nodes for its other characteristics." },
    { name: "charUuid", label: "characteristic UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 2a6e" },
    { name: "encoding", label: "encoding", kind: "select", default: "bytes", options: ENCODING_OPTIONS, help: "How msg.payload becomes the bytes a phone reads." },
    { name: "notify", label: "notify", kind: "boolean", default: true, help: "Also push each new value to the phones subscribed to it." },
    BLE_CONFIG_FIELD,
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${BLE_GATT_DERIVATION}

def compile(ctx, properties):
    errors = []
    name, err = _ble_name(ctx)
    if err:
        errors.append(err)
    svc = _ble_uuid(properties.get('serviceUuid'))
    char = _ble_uuid(properties.get('charUuid'))
    if svc is None:
        errors.append('ble_characteristic_out needs a service UUID: 16-bit (181a) or 128-bit, got "' + str(properties.get('serviceUuid') or '') + '"')
    if char is None:
        errors.append('ble_characteristic_out needs a characteristic UUID: 16-bit (2a6e) or 128-bit, got "' + str(properties.get('charUuid') or '') + '"')
    if properties.get('encoding', 'bytes') not in ENCODINGS:
        errors.append('ble_characteristic_out encoding must be one of ' + ', '.join(ENCODINGS))
    table, gatt_errors = _ble_gatt(ctx)
    errors.extend(gatt_errors)
    if errors:
        return {'errors': errors}
    return {'properties': {'bleName': name, 'serviceUuid': svc, 'charUuid': char, 'gattTable': table}}
`;

export const python = `import ts_ble

_node_id = properties['nodeId']
_encoding = properties['encoding']
_notify = bool(properties['notify'])
_svc = properties['serviceUuid']
_char = properties['charUuid']
_gatt = ts_ble.radio().gatt(properties['gattTable'], properties['bleName'])
_gatt.attach(_node_id)


async def run(msg, properties):
    try:
        data = ts_ble.encode(_encoding, msg.get('payload'))
    except ValueError as e:
        runtime._report_error(_node_id, ValueError('ble_characteristic_out: %s' % e))
        return
    _gatt.write(_node_id, _svc, _char, data, _notify)
`;
