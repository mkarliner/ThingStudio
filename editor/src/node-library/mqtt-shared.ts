// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/mqtt-shared.ts
//
// Shared between mqtt-publish.ts and mqtt-subscribe.ts: broker/client
// config validation, the client-construction setup statement, and the
// "make sure we're connected" snippet both node types need before doing
// anything else. Factored out (rather than duplicated per node type, or
// left to mergeSetup's ordinary dedup) for a real correctness reason, not
// just to avoid repetition: mergeSetup's dedup is "first writer under this
// key wins, later writers under the same key are silently dropped, no
// consistency check" (compile.ts's mergeSetup). If mqtt-publish.ts and
// mqtt-subscribe.ts independently generated their OWN setup code for the
// same broker, and a flow happened to compile the publish node before the
// subscribe node, the publish node's version would win -- and if it
// hadn't been written to also enable the client's event/queue interface
// (`queue_len > 0`), the subscribe node sharing that same client would
// silently get no queue at all, a real functional break, not just
// suboptimal codegen. Both node types calling this same function with the
// same config always produces byte-identical setup code regardless of
// which one compiles first, so which one "wins" the dedup race is a
// non-issue by construction rather than a documented gap to live with.
//
// mqtt_publish/mqtt_subscribe manage their OWN WiFi connection via
// mqtt_as's `connect()` (which internally calls `wifi_connect()` using the
// `ssid`/`wifi_pw` in the client's own config) rather than sharing
// wifi-status.ts's "wifi-sta" setup key. Deliberate, not an oversight:
// mqtt_as's `_keep_connected()` gives real outage recovery (the entire
// reason it was vendored over `umqtt.simple` -- see
// device-runtime/src/vendor/mqtt_as/README.md), and forcing it to share a
// plain `network.WLAN.connect()`-once statement with wifi_status.ts would
// throw that away. This does mean `ssid`/`password` may end up configured
// twice in a flow that also has a wifi_status node -- an accepted v1
// duplication, not a conflict: `network.WLAN(network.STA_IF)` returns a
// fresh Python wrapper object on each call, but every wrapper proxies to
// the same one physical station interface, so wifi_status's own handle
// still reports accurate `isconnected()`/`ifconfig()` state regardless of
// which code path actually brought the link up.
//
// Possible future enhancement, not built: the vendored mqtt_as hardcodes
// `network.WLAN(network.STA_IF)` inside its own `MQTT_base.__init__` --
// unlike wifi-status.ts/http-request.ts's interface choice (also
// hardcoded today, but only on our side), this one lives in third-party
// code we don't control. The most likely real case wanting a different
// interface is a board with WiFi plus a wired Ethernet add-on (e.g. a
// WIZnet W5500 over SPI) that wants MQTT traffic over Ethernet instead of
// WiFi. Doing that would need a fork/patch of the vendored file (or
// upstream support for it), not just a config change here -- a real
// enough lift that it's worth confirming there's an actual board/use case
// before starting, not speculatively built now.

import { CompileError } from "../compiler/errors.js";
import { pyStringLiteral } from "./py-literals.js";

export interface MqttBrokerConfig {
  broker: string;
  port: number;
  ssid: string;
  password: string;
}

function sanitizeIdent(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

function idSuffix(cfg: MqttBrokerConfig): string {
  return `${sanitizeIdent(cfg.broker)}_${cfg.port}`;
}

export function mqttClientVar(cfg: MqttBrokerConfig): string {
  return `_mqtt_client_${idSuffix(cfg)}`;
}

function mqttConnectedVar(cfg: MqttBrokerConfig): string {
  return `_mqtt_connected_${idSuffix(cfg)}`;
}

function mqttLockVar(cfg: MqttBrokerConfig): string {
  return `_mqtt_lock_${idSuffix(cfg)}`;
}

export function mqttSetupKey(cfg: MqttBrokerConfig): string {
  return `mqtt-client-${cfg.broker}-${cfg.port}`;
}

/** `context` is prefixed onto error messages (e.g. "mqtt_publish", so a
 * caller's CompileError says which node type actually rejected it). */
export function parseMqttBrokerProps(properties: Record<string, unknown>, context: string): MqttBrokerConfig {
  const broker = typeof properties.broker === "string" ? properties.broker.trim() : "";
  if (!broker) {
    throw new CompileError(`${context} requires a "broker" hostname/IP`);
  }
  const port = Math.round(Number(properties.port ?? 1883));
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new CompileError(`${context} port "${String(properties.port)}" must be a valid port number (1-65535)`);
  }
  const ssid = typeof properties.ssid === "string" ? properties.ssid.trim() : "";
  if (!ssid) {
    // Deliberately required rather than optional-with-fallback (contrast
    // wifi-status.ts/http-request.ts, where an empty ssid just skips the
    // connect call and assumes something else brings the link up) -- see
    // this file's header on why mqtt_as owns its own WiFi lifecycle
    // rather than assuming a connection already exists.
    throw new CompileError(`${context} requires "ssid" -- mqtt_as manages its own WiFi connection and needs credentials to do so`);
  }
  const password = typeof properties.password === "string" ? properties.password : "";
  return { broker, port, ssid, password };
}

/** Module-scope statement that constructs the shared MQTTClient for this
 * broker. `queue_len` is always set to a fixed positive value regardless
 * of whether the calling node is mqtt_publish or mqtt_subscribe -- see
 * this file's header for why that's what makes the dedup-sharing safe. */
export function mqttSetupStatement(cfg: MqttBrokerConfig): { key: string; code: string } {
  const clientVar = mqttClientVar(cfg);
  const lines = [
    `${clientVar}_cfg = dict(mqtt_as.config)`,
    `${clientVar}_cfg['server'] = ${pyStringLiteral(cfg.broker)}`,
    `${clientVar}_cfg['port'] = ${cfg.port}`,
    `${clientVar}_cfg['ssid'] = ${pyStringLiteral(cfg.ssid)}`,
    `${clientVar}_cfg['wifi_pw'] = ${pyStringLiteral(cfg.password)}`,
    // Fixed, not configurable -- the queue is only ever read by
    // mqtt_subscribe nodes (mqtt-subscribe.ts), a publish-only flow just
    // never drains it, which is harmless (MsgQueue discards oldest on
    // overflow, per the vendored mqtt_as's own MsgQueue.put()).
    `${clientVar}_cfg['queue_len'] = 20`,
    `${clientVar} = mqtt_as.MQTTClient(${clientVar}_cfg)`,
    `${mqttConnectedVar(cfg)} = False`,
    `${mqttLockVar(cfg)} = asyncio.Lock()`,
  ];
  return { key: mqttSetupKey(cfg), code: lines.join("\n") };
}

/** NOT indented; caller embeds this at the top of an async function body
 * (mqtt-publish.ts's sink functionBody, or mqtt-subscribe.ts's buildMsg --
 * both already run inside an `async def`/coroutine, so `await` here is
 * always legal). Double-checked-locking: the fast path (already
 * connected) never touches the lock; only the first caller across
 * however many chains share this client actually awaits `.connect()`,
 * everyone else just observes `_mqtt_connected_*` flip to True. */
export function mqttEnsureConnectedSnippet(cfg: MqttBrokerConfig): string {
  const clientVar = mqttClientVar(cfg);
  const connectedVar = mqttConnectedVar(cfg);
  const lockVar = mqttLockVar(cfg);
  return [
    `global ${connectedVar}`,
    `if not ${connectedVar}:`,
    `    async with ${lockVar}:`,
    `        if not ${connectedVar}:`,
    `            await ${clientVar}.connect()`,
    `            ${connectedVar} = True`,
  ].join("\n");
}

// payloadToBytesSnippet used to live here (mqtt_publish's outgoing-payload
// encoding). Moved to py-literals.ts 2026-08-18 when udp-send.ts needed
// the identical snippet -- see that file's doc comment for why. Re-exported
// from here too, so mqtt-publish.ts's existing import path keeps working
// without a churny cross-file rename.
export { payloadToBytesSnippet } from "./py-literals.js";
