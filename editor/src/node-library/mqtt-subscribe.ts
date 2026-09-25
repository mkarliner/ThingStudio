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
// an OSError from the one-time `.subscribe()` call is now re-raised with
// this node's own broker host:port folded into the message, same as
// mqtt-publish.ts's `.publish()` call and the connect-retry loop's own
// final raise (mqtt-shared.ts). Deliberately NOT wrapped around
// `queue.__anext__()` below -- that's an in-memory queue read, not
// network I/O, and can't itself raise OSError.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { CompileError } from "../compiler/errors.js";
import { mqttClientVar, mqttEnsureConnectedSnippet, mqttNodeStatusSetupStatement, mqttSetupStatement, parseMqttBrokerProps } from "./mqtt-shared.js";
import { pyStringLiteral } from "./py-literals.js";
import { wifiSetupStatement } from "./wifi-status.js";

export const mqttSubscribeNode: NodeDefinition = {
  type: "thingstudio/mqtt_subscribe",
  kind: "source",
  // output `msg` type `any` -- buildMsg's payload field falls back to the
  // raw (possibly non-string) decoded value when the incoming bytes
  // aren't valid text (`isinstance(..., (bytes, bytearray))` check
  // above), so "string" would overclaim what's actually guaranteed here.
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const cfg = parseMqttBrokerProps(node.properties, ctx, "mqtt_subscribe");

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
      mqttEnsureConnectedSnippet(cfg, node.id),
      `if not ${readyVar}:`,
      "    try:",
      `        await ${clientVar}.subscribe(${pyStringLiteral(topic)}, ${qos})`,
      "    except OSError as _e:",
      `        raise OSError("mqtt subscribe to %s:%s failed: %r" % (${pyStringLiteral(cfg.broker)}, ${cfg.port}, _e))`,
      `    ${readyVar} = True`,
      `_mqtt_topic, _mqtt_payload, _mqtt_retained = await ${clientVar}.queue.__anext__()`,
      "msg = {",
      "    'payload': _mqtt_payload.decode() if isinstance(_mqtt_payload, (bytes, bytearray)) else _mqtt_payload,",
      "    'topic': _mqtt_topic.decode() if isinstance(_mqtt_topic, (bytes, bytearray)) else _mqtt_topic,",
      "    'retained': bool(_mqtt_retained),",
      "}",
    ].join("\n");

    return {
      // network/sys: the WiFi-reconnect race fix inlined into
      // mqttEnsureConnectedSnippet() (mqtt-shared.ts) needs both -- no
      // longer a separate module-scope statement, so no `time` import
      // (it used blocking time.sleep_ms() when it was module-scope code
      // with no event loop yet; inlined into a coroutine now, it uses
      // asyncio.sleep_ms() instead, see that file's header).
      imports: ["import mqtt_as", "import network", "import sys", "import time"],
      statements: [
        wifiSetupStatement(cfg.ssid, cfg.wifiPassword, "open", true),
        mqttSetupStatement(cfg),
        mqttNodeStatusSetupStatement(node.id),
        { key: readyVar, code: `${readyVar} = False` },
      ],
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
