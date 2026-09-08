// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/http-response.ts
//
// The reply half of the http_in/http_response pair -- see http-in.ts's
// header and http-server-shared.ts's own header for the shared
// architecture. v1 scope, matching http-in.ts's own cuts: `msg.statusCode`
// (default 200, Node-RED's own field name) and `msg.payload` (the body)
// are read straight off the msg; there's no per-node Content-Type
// property in v1 -- always sent as plain bytes/text, no header set --
// deferred to a P4 follow-up (outstanding-items.md) alongside http-in's
// own scope cuts, Mike's own explicit call this session.
//
// A sink: no output port, terminal. Completes the `_http_conn` record
// http-server-shared.ts's TCP handler is blocked waiting on (its own
// `asyncio.Event`), which is what actually lets that handler write the
// real HTTP response back to the client and close the socket -- this
// node itself never touches the socket directly.
//
// Firing this node on a msg that never came from an http_in node (no
// `_http_conn` key present) is a real, attributable runtime error, not a
// silent no-op -- CLAUDE.md's fault-handling priority applied the same
// way http-request.ts/serial_relay.py wrap every other operation-specific
// failure with context instead of letting a bare/confusing exception
// surface.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

export const httpResponseNode: NodeDefinition = {
  type: "thingstudio/http_response",
  kind: "sink",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  codegenSink(_node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const functionBody = `
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
_conn['done'].set()`.trim();

    return {
      functionName: ctx.uniqueName("http_response"),
      functionBody,
    };
  },
};
