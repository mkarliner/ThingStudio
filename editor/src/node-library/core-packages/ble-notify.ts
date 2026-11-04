// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-notify.ts
//
// ble_notify (2026-11-04, BLE phase 3: docs/working-notes/ble-nodes-scoping.md). An event source: subscribes to a
// characteristic of a BLE peer (notify, or indicate when that's all it offers) and sends one message per value. The
// subscription is redone on each reconnect, by ts_ble's _Peer.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_PEER_FIELD, ENCODING_OPTIONS, ENCODING_PORT_MAP } from "./ble-shared.js";
import { CENTRAL_HOOK } from "./ble-read.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_notify",
  kind: "source",
  eventSource: true,
  paletteId: "ble_notify",
  label: "ble notify",
  group: "network",
  priority: 68,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 92,
  description:
    "Subscribes to a characteristic of another Bluetooth LE device (a BLE peer) and sends a message each time it " +
    "notifies a new value. The board connects to the peer itself and subscribes again after a reconnect.",
  requires: { capabilities: ["ble"] },
  ports: {
    outputs: [{ name: "msg", type: { property: "encoding", map: ENCODING_PORT_MAP, default: "bytes" } }],
  },
  properties: [
    BLE_PEER_FIELD,
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 181a" },
    { name: "charUuid", label: "characteristic UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 2a6e" },
    { name: "encoding", label: "encoding", kind: "select", default: "bytes", options: ENCODING_OPTIONS, retype: true, help: "How each notified value becomes msg.payload." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = CENTRAL_HOOK("ble_notify");

export const python = `import ts_ble
import ts_ble.central

_node_id = properties['nodeId']
_encoding = properties['encoding']
_peer = ts_ble.central.peer(ts_ble.radio(), properties['peerKey'], properties['peerAddr'], properties['peerName'], properties['peerTimeoutMs'])
_values = _peer.notifications(_node_id, properties['serviceUuid'], properties['charUuid'])
_msg = None


async def wait(properties):
    nonlocal _msg
    _peer.start()
    while True:
        data, _conn = await _values.next()
        try:
            value = ts_ble.decode_value(_encoding, data)
        except ValueError as e:
            runtime._report_error(_node_id, ValueError('ble_notify: %s sent %s' % (_peer.label, e)))
            continue
        _msg = {'payload': value, 'topic': '', 'peer': _peer.label, 'uuid': properties['charUuid']}
        return


async def emit(properties):
    await asyncio.sleep_ms(0)
    return _msg
`;
