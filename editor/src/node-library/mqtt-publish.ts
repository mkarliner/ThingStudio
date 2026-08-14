// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/mqtt-publish.ts
//
// Tier 1 network batch (mvp-feature-priorities.md item 4). A sink: takes
// an inbound msg, publishes msg.payload to the configured topic via the
// vendored mqtt_as client (device-runtime/src/vendor/mqtt_as/). See
// mqtt-shared.ts's header for the broker-client-sharing design (dedup
// across mqtt_publish/mqtt_subscribe nodes pointed at the same broker)
// and why mqtt_as owns its own WiFi connection rather than sharing
// wifi-status.ts's setup statement.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";
import { CompileError } from "../compiler/errors.js";
import { mqttClientVar, mqttEnsureConnectedSnippet, mqttSetupStatement, parseMqttBrokerProps, payloadToBytesSnippet } from "./mqtt-shared.js";
import { pyStringLiteral } from "./py-literals.js";

export const mqttPublishNode: NodeDefinition = {
  type: "thingstudio/mqtt_publish",
  kind: "sink",
  codegenSink(node: GraphNode, _ctx: CodegenContext): SinkCodegenResult {
    const cfg = parseMqttBrokerProps(node.properties, "mqtt_publish");

    const topic = typeof node.properties.topic === "string" ? node.properties.topic.trim() : "";
    if (!topic) {
      throw new CompileError("mqtt_publish requires a non-empty \"topic\"");
    }

    const qos = Math.round(Number(node.properties.qos ?? 0));
    if (qos !== 0 && qos !== 1) {
      throw new CompileError(`mqtt_publish qos "${String(node.properties.qos)}" must be 0 or 1 -- qos 2 isn't supported (mqtt_as's own limitation, matches design doc §6's MQTT scope)`);
    }

    const retain = node.properties.retain === true || node.properties.retain === "true";
    const clientVar = mqttClientVar(cfg);

    const functionBody = [
      mqttEnsureConnectedSnippet(cfg),
      payloadToBytesSnippet("_mqtt_body"),
      `await ${clientVar}.publish(${pyStringLiteral(topic)}, _mqtt_body, retain=${retain ? "True" : "False"}, qos=${qos})`,
    ].join("\n");

    return {
      imports: ["import mqtt_as"],
      statements: [mqttSetupStatement(cfg)],
      functionName: _ctx.uniqueName("mqtt_publish"),
      functionBody,
    };
  },
};
