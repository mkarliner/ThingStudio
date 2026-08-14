// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/mqtt-subscribe.ts
//
// Tier 1 network batch (mvp-feature-priorities.md item 4). A source: waits
// for incoming messages on the configured topic via the vendored mqtt_as
// client's callback-free Event/Queue interface (`config['queue_len'] > 0`,
// set unconditionally by mqtt-shared.ts's mqttSetupStatement) rather than
// the callback-based default -- `await client.queue.__anext__()` fits
// this project's source-node model directly (buildMsg runs inside an
// already-`async def` coroutine, so it can just await the next message),
// where the callback interface wouldn't (nothing in the current node
// model represents "push a msg into the flow whenever an external
// callback fires," only "poll on an interval" or "react to an inbound
// wire" -- see docs/working-notes/mvp-validation-plan.md's network-nodes
// entry for the fuller reasoning that led here).
//
// See mqtt-shared.ts's header for the broker-client-sharing design this
// depends on, and mqtt-publish.ts for the sink half.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { CompileError } from "../compiler/errors.js";
import { mqttClientVar, mqttEnsureConnectedSnippet, mqttSetupStatement, parseMqttBrokerProps } from "./mqtt-shared.js";
import { pyStringLiteral } from "./py-literals.js";

export const mqttSubscribeNode: NodeDefinition = {
  type: "thingstudio/mqtt_subscribe",
  kind: "source",
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const cfg = parseMqttBrokerProps(node.properties, "mqtt_subscribe");

    const topic = typeof node.properties.topic === "string" ? node.properties.topic.trim() : "";
    if (!topic) {
      throw new CompileError('mqtt_subscribe requires a non-empty "topic"');
    }

    const qos = Math.round(Number(node.properties.qos ?? 0));
    if (qos !== 0 && qos !== 1) {
      throw new CompileError(`mqtt_subscribe qos "${String(node.properties.qos)}" must be 0 or 1 -- qos 2 isn't supported (mqtt_as's own limitation)`);
    }

    const clientVar = mqttClientVar(cfg);
    // Per-INSTANCE, not per-broker -- two mqtt_subscribe nodes sharing one
    // client (same broker) can subscribe to two different topics, so each
    // needs its own "have I subscribed yet" flag. ctx.uniqueName's result
    // is already flow-wide-unique, so (matching timer.ts's precedent) it
    // doubles safely as the setup-statement dedup key too -- no cross-
    // instance sharing wanted here, unlike the broker client itself.
    const readyVar = ctx.uniqueName("mqtt_sub_ready");

    const buildMsg = [
      `global ${readyVar}`,
      mqttEnsureConnectedSnippet(cfg),
      `if not ${readyVar}:`,
      `    await ${clientVar}.subscribe(${pyStringLiteral(topic)}, ${qos})`,
      `    ${readyVar} = True`,
      `_mqtt_topic, _mqtt_payload, _mqtt_retained = await ${clientVar}.queue.__anext__()`,
      "msg = {",
      "    'payload': _mqtt_payload.decode() if isinstance(_mqtt_payload, (bytes, bytearray)) else _mqtt_payload,",
      "    'topic': _mqtt_topic.decode() if isinstance(_mqtt_topic, (bytes, bytearray)) else _mqtt_topic,",
      "    'retained': bool(_mqtt_retained),",
      "}",
    ].join("\n");

    return {
      imports: ["import mqtt_as"],
      statements: [mqttSetupStatement(cfg), { key: readyVar, code: `${readyVar} = False` }],
      buildMsg,
      // NOT a poll interval -- `queue.__anext__()` above already blocks
      // (via the vendored mqtt_as's own asyncio.Event) until a real
      // message arrives, so this isn't "check every N ms" the way
      // gpio_in's repeatMs is. It exists because MsgQueue.__anext__()
      // returns immediately, with no internal await, whenever the queue
      // is already non-empty (peterhinch/micropython-mqtt's MsgQueue) --
      // a burst of several queued messages could otherwise process back
      // to back with no yield at all, the exact non-yielding-event-loop
      // hazard class §5/POC-D's hardware bugs warn about. This is the
      // mandatory yield the source-loop wrapper (compile.ts) appends
      // after every iteration, kept as short as possible rather than a
      // real polling cadence.
      repeatMs: 10,
    };
  },
};
