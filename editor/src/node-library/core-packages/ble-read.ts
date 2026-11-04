// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ble-read.ts
//
// ble_read (2026-11-04, BLE phase 3: docs/working-notes/ble-nodes-scoping.md). A transform: each message reads a
// characteristic of a BLE peer, and the decoded value goes out as msg.payload. The connection is ts_ble's _Peer,
// shared by every central node naming the same `ble peer` config. A read that can't happen (not connected, a
// timeout, an undecodable value) is reported and the message dropped, never raised.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { BLE_PEER_DERIVATION, BLE_PEER_FIELD, ENCODING_OPTIONS, ENCODING_PORT_MAP } from "./ble-shared.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ble_read",
  kind: "transform",
  paletteId: "ble_read",
  label: "ble read",
  group: "network",
  priority: 66,
  color: "#2f5fa8",
  bgcolor: "#1a3560",
  icon: "ᛒ",
  width: 84,
  description:
    "Reads a characteristic of another Bluetooth LE device (a BLE peer) for each message that arrives, and sends " +
    "the value on as msg.payload. The board connects to the peer itself and reconnects if the link drops.",
  requires: { capabilities: ["ble"] },
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: { property: "encoding", map: ENCODING_PORT_MAP, default: "bytes" } }],
  },
  properties: [
    BLE_PEER_FIELD,
    { name: "serviceUuid", label: "service UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 181a" },
    { name: "charUuid", label: "characteristic UUID", kind: "text", default: "", placeholder: "128-bit, or 16-bit like 2a6e" },
    { name: "encoding", label: "encoding", kind: "select", default: "bytes", options: ENCODING_OPTIONS, retype: true, help: "How the bytes read become msg.payload." },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

const CENTRAL_HOOK = (label: string) => `${BLE_PEER_DERIVATION}

ENCODINGS = ('bytes', 'text', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'float32')


def compile(ctx, properties):
    errors = []
    peer, err = _ble_peer(ctx, properties, '${label}')
    if err:
        errors.append(err)
    svc = _ble_uuid(properties.get('serviceUuid'))
    char = _ble_uuid(properties.get('charUuid'))
    if svc is None:
        errors.append('${label} needs a service UUID: 16-bit (181a) or 128-bit, got "' + str(properties.get('serviceUuid') or '') + '"')
    if char is None:
        errors.append('${label} needs a characteristic UUID: 16-bit (2a6e) or 128-bit, got "' + str(properties.get('charUuid') or '') + '"')
    if properties.get('encoding', 'bytes') not in ENCODINGS:
        errors.append('${label} encoding must be one of ' + ', '.join(ENCODINGS))
    if errors:
        return {'errors': errors}
    out = dict(peer)
    out['serviceUuid'] = svc
    out['charUuid'] = char
    return {'properties': out}
`;
export { CENTRAL_HOOK };

export const compileHook = CENTRAL_HOOK("ble_read");

export const python = `import ts_ble

_node_id = properties['nodeId']
_encoding = properties['encoding']
_svc = properties['serviceUuid']
_char = properties['charUuid']
_peer = ts_ble.radio().peer(properties['peerKey'], properties['peerAddr'], properties['peerName'], properties['peerTimeoutMs'])
_peer.need(_node_id, _svc, _char)


async def run(msg, properties):
    try:
        data = await _peer.read(_svc, _char)
        msg['payload'] = ts_ble.decode_value(_encoding, data)
    except ts_ble.PeerError as e:
        runtime._report_error(_node_id, e)
        return None
    except ValueError as e:
        runtime._report_error(_node_id, ValueError('ble_read: %s read %s' % (_peer.label, e)))
        return None
    return msg
`;
