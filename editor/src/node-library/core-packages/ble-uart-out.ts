// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-uart-out.ts
//
// ble_uart_out (2026-11-03, BLE phase 2: docs/working-notes/ble-nodes-scoping.md). The send side of the Nordic UART
// Service: msg.payload as text to every connected phone, in pieces that fit each connection's MTU.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_CONFIG_FIELD, BLE_GATT_DERIVATION } from "./ble-shared.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_uart_out",
  kind: "sink",
  paletteId: "ble_uart_out",
  label: "ble uart out",
  group: "network",
  priority: 65,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 96,
  description:
    "Sends msg.payload as text to the phones connected over Bluetooth LE, through the Nordic UART Service that " +
    "terminal apps use. The board accepts connections from anyone in range.",
  requires: { capabilities: ["ble"] },
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "newline", label: "end with a newline", kind: "boolean", default: true },
    BLE_CONFIG_FIELD,
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${BLE_GATT_DERIVATION}

def compile(ctx, properties):
    name, err = _ble_name(ctx)
    table, errors = _ble_gatt(ctx)
    if err:
        errors.insert(0, err)
    if errors:
        return {'errors': errors}
    return {'properties': {'bleName': name, 'gattTable': table}}
`;

export const python = `import ts_ble

_node_id = properties['nodeId']
_newline = bool(properties['newline'])
_gatt = ts_ble.radio().gatt(properties['gattTable'], properties['bleName'])
_gatt.attach(_node_id)


async def run(msg, properties):
    p = msg.get('payload')
    data = bytes(p) if isinstance(p, (bytes, bytearray)) else str(p).encode()
    if _newline:
        data += b'\\n'
    _gatt.send_chunks(_node_id, ts_ble.NUS_SERVICE, ts_ble.NUS_TX, data)
`;
