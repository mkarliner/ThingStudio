// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/http-in.ts
//
// The trigger half of the http_in/http_response pair (docs/working-notes/
// outstanding-items.md's "HTTP in / HTTP response nodes" P3 MVP item;
// Mike's own "node-red calls it http in" + a later Node-RED-docs steer on
// how the real node behaves). v1 scope, Mike's own explicit call this
// session ("we don't have to implement all of the node-red semantics"):
// EXACT (method, path) match only -- no `:name` path parameters, no
// `msg.req.params`, and no request-body parsing into `msg.payload` (v1's
// emitted msg always has `payload: None`). Both omissions are real,
// tracked P4 follow-ups (outstanding-items.md), not oversights -- see
// http-server-shared.ts's own header for the full architecture this node
// and http-response.ts share.
//
// An event-source node (node-definition.ts's codegenEventSource, same
// pattern interrupt.ts pioneered): each instance gets its own dedicated
// coroutine (compile.ts) that waits on its own private request queue
// (http-server-shared.ts's `_HttpInQueue`), fed by the shared per-port TCP
// handler whenever a real inbound request matches this node's own
// (method, path). "Event" here is a real inbound HTTP request, not a
// timer/poll -- same "genuinely blocks until something external happens"
// shape as interrupt.ts's IRQ wait, just fed by a TCP handler task
// instead of a hard-IRQ handler.
//
// Shares the flow's "wifi-sta" setup statement (wifi-status.ts), same as
// http-request.ts -- an HTTP server needs the station interface up to
// have anything to listen on, so this node requires exactly one
// wifi_status node in the flow, same as every other network node type
// here.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";
import { flowHasMqttNodes, resolveFlowWifiCredentials, wifiSetupStatement } from "./wifi-status.js";
import { HTTP_IN_TYPE, httpInQueueVar, httpServerSetupStatement, queueClassSetupStatement, resolveHttpInProperties } from "./http-server-shared.js";

export const httpInNode: NodeDefinition = {
  type: HTTP_IN_TYPE,
  kind: "source",
  // payload is always None in v1 (no body parsing, see this file's
  // header) -- "any" here, same convention every other "the payload
  // could genuinely be anything, or in this case nothing" port already
  // uses (function-node.ts, http-request.ts).
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const props = resolveHttpInProperties(node);
    const queueVar = httpInQueueVar(node.id);
    const { ssid, password, security } = resolveFlowWifiCredentials(ctx, "http_in");

    return {
      imports: ["import network"],
      statements: [
        // deferToMqtt (2026-09-11, decisions/redeploy-network.md): keeps this in sync
        // with wifi-status.ts's OWN wifiSetupStatement() call for the same reason --
        // compile.ts's mergeSetup dedups the shared "wifi-sta" key by first-writer-wins,
        // so whichever node happens to compile first must make the SAME defer-to-mqtt
        // decision, or an ordering accident could silently undo wifi_status's own deferral.
        wifiSetupStatement(ssid, password, security, flowHasMqttNodes(ctx)),
        queueClassSetupStatement,
        { key: `http-in-queue-${node.id}`, code: `${queueVar} = _HttpInQueue()` },
        httpServerSetupStatement(props.port, ctx),
      ],
      // Idempotent every iteration (a global bool flag inside
      // `_http_ensure_<port>`, http-server-shared.ts) -- cheap enough to
      // call on every wake, not just the first, so there's no separate
      // "run once before the loop" hook needed on top of
      // EventSourceCodegenResult's existing per-iteration waitStatement
      // contract.
      waitStatement: `await _http_ensure_${props.port}()\n_ts_req = await ${queueVar}.get()`,
      buildMsg: "msg = _ts_req",
    };
  },
};
