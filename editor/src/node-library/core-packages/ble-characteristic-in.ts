// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-characteristic-in.ts
//
// ble_characteristic_in (2026-11-03, BLE phase 2: docs/working-notes/ble-nodes-scoping.md). An event source: one
// message each time a connected phone writes the characteristic. The board's GATT server is ts_ble's; the hook builds
// the flow's whole service table (ble-shared.ts) so the first GATT node to start registers it once.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_CONFIG_FIELD, BLE_GATT_DERIVATION, ENCODING_OPTIONS, ENCODING_PORT_MAP } from "./ble-shared.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_characteristic_in",
  kind: "source",
  eventSource: true,
  paletteId: "ble_characteristic_in",
  label: "ble characteristic in",
  title: "ble char in",
  group: "network",
  priority: 62,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 116,
  description:
    "Sends a message each time a connected device (a phone, a computer, another board) writes this Bluetooth LE " +
    "characteristic. msg.payload is the value, " +
    "decoded by the encoding. The board accepts connections from anyone in range: no pairing.",
  requires: { capabilities: ["ble"] },
  ports: {
    outputs: [{ name: "msg", type: { property: "encoding", map: ENCODING_PORT_MAP, default: "bytes" } }],
  },
  properties: [
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 181a", help: "The service this characteristic belongs to. Use the same one on the nodes for its other characteristics." },
    { name: "charUuid", label: "characteristic UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 2a6e" },
    { name: "encoding", label: "encoding", kind: "select", default: "bytes", options: ENCODING_OPTIONS, retype: true, help: "How the bytes a connected device writes become msg.payload." },
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
        errors.append('ble_characteristic_in needs a service UUID: 16-bit (181a) or 128-bit, got "' + str(properties.get('serviceUuid') or '') + '"')
    if char is None:
        errors.append('ble_characteristic_in needs a characteristic UUID: 16-bit (2a6e) or 128-bit, got "' + str(properties.get('charUuid') or '') + '"')
    if properties.get('encoding', 'bytes') not in ENCODINGS:
        errors.append('ble_characteristic_in encoding must be one of ' + ', '.join(ENCODINGS))
    table, gatt_errors = _ble_gatt(ctx)
    errors.extend(gatt_errors)
    if errors:
        return {'errors': errors}
    return {'properties': {'bleName': name, 'serviceUuid': svc, 'charUuid': char, 'gattTable': table}}
`;

export const python = `import ts_ble
import ts_ble.server

_node_id = properties['nodeId']
_encoding = properties['encoding']
_gatt = ts_ble.server.gatt(ts_ble.radio(), properties['gattTable'], properties['bleName'])
_writes = _gatt.on_writes(_node_id, properties['serviceUuid'], properties['charUuid'])
_msg = None


async def wait(properties):
    nonlocal _msg
    while True:
        data, conn = await _writes.next()
        try:
            value = ts_ble.decode_value(_encoding, data)
        except ValueError as e:
            runtime._report_error(_node_id, ValueError('ble_characteristic_in: a connected device wrote %s' % e))
            continue
        _msg = {'payload': value, 'topic': '', 'conn': conn, 'uuid': properties['charUuid']}
        return


async def emit(properties):
    await asyncio.sleep_ms(0)
    return _msg
`;
