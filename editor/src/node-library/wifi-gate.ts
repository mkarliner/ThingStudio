// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/wifi-gate.ts
//
// The "pass-or-drop status gate" half of mvp-feature-priorities.md's 2026-08-14 "connection-state
// gate/router nodes" item (outstanding-items/connection-state-gate-router-nodes.md) -- built
// 2026-09-14, scoped to WiFi link state only, Mike's explicit call: the router half of that same
// item (route to one of two output wires by connection state) is deferred to POST-MVP, since a
// `function` node's own multiple outputs plus an in-code switch already cover that need; an
// MQTT-broker-specific gate (WiFi up but a specific broker unreachable) is a separate, still-open
// follow-up if finer granularity than link-level ever turns out to matter -- not built here.
//
// What this is: a transform, one msg in, the SAME msg back out unchanged if the WiFi station
// interface is currently connected, or nothing (None -- stops propagation, same mechanism a
// `function` node's own `return None` uses) if it isn't. The motivating case (mvp-feature-
// priorities.md): a GPIO/timer/sensor source fires on its own schedule with no awareness of
// whether WiFi happens to be up right now -- this node is the explicit, flow-author-placed point
// where "don't even try sending this while we're down" gets decided, upstream of whatever network
// node comes next. Distinct from the lazy-connect-and-lock handling already built into
// http_request/mqtt_publish/mqtt_subscribe (mqtt-shared.ts's mqttEnsureConnectedSnippet) -- that
// mechanism makes those nodes correct on their own with nothing extra wired; this is about explicit
// flow-author visibility/control on top of that, not a prerequisite for it.
//
// Checks live state at message-arrival-time (`_wifi_sta.isconnected()`), not a value derived from
// wifi_status's own emitted messages -- wifi_status only emits on a connection-identity CHANGE
// (wifi-status.ts's 2026-09-02 emit-on-change behavior), so a fast-firing sensor stream gated off
// wifi_status's own output wire could easily be checking stale state. A direct hardware read here
// is what actually answers "is the link up right now."
//
// No `wifiConfigId` property of its own, same as udp-send.ts/udp-receive.ts/mqtt-shared.ts since
// 2026-09-04 (wifi-status.ts's header): derives from the flow's own sole `wifi_status` node via
// resolveFlowWifiCredentials(), so this node can't disagree with what wifi_status itself is doing.
// Still calls wifiSetupStatement() itself, with the SAME deferToMqtt computation wifi_status/
// udp_send/etc. all make -- compile.ts's mergeSetup dedups the shared "wifi-sta" key by
// first-writer-wins, so whichever node happens to compile first must reach the identical decision,
// or a graph-ordering accident could silently undo wifi_status's own mqtt-deferral (same reasoning
// udp-send.ts's own call site comments).

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { flowHasMqttNodes, resolveFlowWifiCredentials, wifiSetupStatement } from "./wifi-status.js";

export const wifiGateNode: NodeDefinition = {
  type: "thingstudio/wifi_gate",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenTransform(_node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const { ssid, password, security } = resolveFlowWifiCredentials(ctx, "wifi_gate");

    return {
      imports: ["import network"],
      statements: [wifiSetupStatement(ssid, password, security, flowHasMqttNodes(ctx))],
      functionName: ctx.uniqueName("wifi_gate"),
      functionBody: "return msg if _wifi_sta.isconnected() else None",
    };
  },
};
