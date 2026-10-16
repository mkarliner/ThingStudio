// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/http-response.ts
//
// The reply half of the http_in/http_response pair -- a core package (node-format-parity phase 4, option A). Same
// descriptor the TypeScript http-response.ts carried, plus a `.node.py` ported from its codegen. Pure software,
// no shared-resource facility needed.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/http_response",
  kind: "sink",
  paletteId: "http_response",
  label: "http response",
  group: "network",
  priority: 42,
  color: "#6e5216",
  bgcolor: "#3a2c14",
  icon: "↗",
  width: 130,
  description:
    "No properties -- reads msg.statusCode (default 200) and msg.payload (the response body) at runtime, Node-RED's " +
    "own field names. Must fire on a msg that originally came from an http_in node.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
};

export const python = `async def run(msg, properties):
    _conn = msg.get('_http_conn')
    if _conn is None:
        raise RuntimeError("http_response: msg did not come from an http_in node (no request to respond to)")
    _payload = msg.get('payload')
    if isinstance(_payload, (bytes, bytearray)):
        _body = bytes(_payload)
    elif isinstance(_payload, str):
        _body = _payload.encode()
    elif _payload is None:
        _body = b''
    else:
        _body = str(_payload).encode()
    _conn['status'] = int(msg.get('statusCode', 200))
    _conn['body'] = _body
    _conn['done'].set()
`;
