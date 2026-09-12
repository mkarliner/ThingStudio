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
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// **behavior change, 2026-08-21** -- credentials came from a referenced
// `thingstudio/config/wifi` config node via `node.properties.wifiConfigId`,
// resolved inside parseMqttBrokerProps (mqtt-shared.ts) via
// wifi-status.ts's `resolveWifiCredentials()` -- not raw `ssid`/`password`
// properties on this node directly. See mqtt-shared.ts's own header for
// why "unmanaged" security is rejected here even though wifi_status/
// udp_send/udp_receive accept it.
//
// **Superseded, 2026-09-04**: this node no longer has a `wifiConfigId`
// property at all -- parseMqttBrokerProps now derives WiFi credentials
// from the flow's own `wifi_status` node instead (wifi-status.ts's
// `resolveFlowWifiCredentials()`, mqtt-shared.ts's own updated header).
// Fixes a real bug: this node's own, independently-selectable
// `wifiConfigId` used to let it silently disagree with wifi_status about
// which WiFi config was actually active for the flow's one physical
// radio. `brokerConfigId` below is unaffected -- the broker config was
// never part of the bug. Same day,
// on Mike's own follow-up request: `broker`/`port` also moved out of this
// node's own properties into a second referenced config,
// `thingstudio/config/mqtt-broker`, via `node.properties.brokerConfigId`
// -- see mqtt-shared.ts's header for the broker-config design and why it's
// a second, independent config reference rather than folded into the WiFi
// config.
//
// Also given real canvas presence in this change (`ports` below) --
// previously registry-only, per outstanding-items.md's "Network / config
// nodes" section.
//
// 2026-08-21: also emits the WiFi-reconnect race fix (mqtt-shared.ts's
// mqttEnsureConnectedSnippet()) -- see that file's header for the full
// story, including the 2026-09-04 fix to how/when it actually runs.
//
// Loud network errors added, 2026-09-05 (mqtt-shared.ts's own header;
// redeploy-cleanup-and-network-fault-detection-briefing.md's Problem 2a):
// an OSError from `.publish()` itself (broker connection dropped
// mid-publish, say) is now re-raised with this node's own broker
// host:port folded into the message, same as the connect-retry loop's
// own final raise (mqtt-shared.ts).

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";
import { CompileError } from "../compiler/errors.js";
import { mqttClientVar, mqttEnsureConnectedSnippet, mqttNodeStatusSetupStatement, mqttSetupStatement, parseMqttBrokerProps, payloadToBytesSnippet } from "./mqtt-shared.js";
import { pyStringLiteral } from "./py-literals.js";

export const mqttPublishNode: NodeDefinition = {
  type: "thingstudio/mqtt_publish",
  kind: "sink",
  // input `msg` type `any` -- payloadToBytesSnippet handles bytes/str/other
  // uniformly (same reasoning udp_send's own `any` input gets,
  // wire-type-system-scoping.md).
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const cfg = parseMqttBrokerProps(node.properties, ctx, "mqtt_publish");

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
      mqttEnsureConnectedSnippet(cfg, node.id),
      payloadToBytesSnippet("_mqtt_body"),
      "try:",
      `    await ${clientVar}.publish(${pyStringLiteral(topic)}, _mqtt_body, retain=${retain ? "True" : "False"}, qos=${qos})`,
      "except OSError as _e:",
      `    raise OSError("mqtt publish to %s:%s failed: %r" % (${pyStringLiteral(cfg.broker)}, ${cfg.port}, _e))`,
    ].join("\n");

    return {
      // network/sys: the WiFi-reconnect race fix inlined into
      // mqttEnsureConnectedSnippet() (mqtt-shared.ts) needs both -- no
      // longer a separate module-scope statement, so no `time` import
      // (it used blocking time.sleep_ms() when it was module-scope code
      // with no event loop yet; inlined into a coroutine now, it uses
      // asyncio.sleep_ms() instead, see that file's header).
      imports: ["import mqtt_as", "import network", "import sys"],
      statements: [mqttSetupStatement(cfg), mqttNodeStatusSetupStatement(node.id)],
      functionName: ctx.uniqueName("mqtt_publish"),
      functionBody,
    };
  },
};
