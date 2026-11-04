// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-write.ts
//
// ble_write (2026-11-04, BLE phase 3: docs/working-notes/ble-nodes-scoping.md). A sink: writes msg.payload, encoded,
// to a characteristic of a BLE peer, with or without the peer's response. Not connected, a timeout or a value that
// doesn't fit is reported and the message dropped; nothing is queued for later.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_PEER_FIELD, ENCODING_OPTIONS } from "./ble-shared.js";
import { CENTRAL_HOOK } from "./ble-read.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_write",
  kind: "sink",
  paletteId: "ble_write",
  label: "ble write",
  group: "network",
  priority: 67,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 84,
  description:
    "Writes msg.payload to a characteristic of another Bluetooth LE device (a BLE peer). The board connects to the " +
    "peer itself; a message that arrives while it isn't connected is reported and dropped.",
  requires: { capabilities: ["ble"] },
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    BLE_PEER_FIELD,
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 181a" },
    { name: "charUuid", label: "characteristic UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 2a6e" },
    { name: "encoding", label: "encoding", kind: "select", default: "bytes", options: ENCODING_OPTIONS, help: "How msg.payload becomes the bytes written." },
    { name: "response", label: "wait for the peer's response", kind: "boolean", default: true, help: "Off: write without response, faster, and the peer must allow it." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = CENTRAL_HOOK("ble_write");

export const python = `import ts_ble
import ts_ble.central

_node_id = properties['nodeId']
_encoding = properties['encoding']
_svc = properties['serviceUuid']
_char = properties['charUuid']
_response = bool(properties['response'])
_peer = ts_ble.central.peer(ts_ble.radio(), properties['peerKey'], properties['peerAddr'], properties['peerName'], properties['peerTimeoutMs'])
_peer.need(_node_id, _svc, _char)


async def run(msg, properties):
    try:
        data = ts_ble.encode(_encoding, msg.get('payload'))
    except ValueError as e:
        runtime._report_error(_node_id, ValueError('ble_write: %s' % e))
        return
    try:
        await _peer.write(_svc, _char, data, _response)
    except ts_ble.central.PeerError as e:
        runtime._report_error(_node_id, e)
`;
