// Tier 1 network node: mqtt_subscribe (editor/src/node-library/mqtt-subscribe.ts).
//
// Always-repeating source (repeatMs > 0, per its own header comment on
// why), same pymock-has-no-sleep_ms constraint node-gpio-in.test.ts/
// node-wifi-status.test.ts document -- calls codegenSource directly and
// runs just the returned setup+buildMsg snippet, skipping the coroutine/
// asyncio-loop machinery. Uses pymock's mqtt_as.py fixture's
// `_inject()` to place a message on the client's queue BEFORE running
// buildMsg (which awaits queue.__anext__()) -- the software-only analog
// of the witness rig physically driving a stimulus into a gpio_in flow.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// updated 2026-08-21 for the wifiConfigId behavior change -- see
// mqtt-shared.ts's own header. Same fake-resolveConfig-via-local-map
// pattern node-udp-send.test.ts uses, EXCEPT there's no "unmanaged1"
// stand-in default here: mqtt_subscribe rejects "unmanaged" outright (see
// mqtt-shared.ts's header for why), so the default seeded WiFi config
// ("wifi1") always carries a real ssid/password.
//
// Updated again the same day for the broker-config behavior change (Mike's
// own follow-up request, same session): `broker`/`port` moved out of the
// node's own properties into a second referenced config,
// `thingstudio/config/mqtt-broker`, via `brokerConfigId` -- default seeded
// as "broker1" (see beforeEach below).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { mqttSubscribeNode } from "../src/node-library/mqtt-subscribe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeConfigs = new Map<string, Record<string, unknown>>();
function setConfig(id: string, properties: Record<string, unknown>): void {
  fakeConfigs.set(id, properties);
}

const DEFAULT_WIFI_CONFIG = { id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "s", password: "pw" } };
function configsWith(brokerProps: Record<string, unknown>): NonNullable<GraphData["configs"]> {
  return [DEFAULT_WIFI_CONFIG, { id: "broker1", type: "thingstudio/config/mqtt-broker", properties: brokerProps }];
}

beforeEach(() => {
  fakeConfigs.clear();
  setConfig("wifi1", { ssid: "s", password: "pw" });
  setConfig("broker1", { broker: "b", port: 1883, username: "", password: "" });
});

function freshCtx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    resolveConfig(id: string): Record<string, unknown> {
      const cfg = fakeConfigs.get(id);
      if (!cfg) throw new CompileError(`referenced config "${id}" not found`);
      return cfg;
    },
  };
}

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/mqtt_subscribe", properties };
}

/** Finds the actual MQTTClient-construction statement among a codegen
 * result's `statements` -- NOT index [0] (that's
 * `mqttWifiPrecheckStatement()`'s WiFi-reconnect race fix, mqtt-shared.ts,
 * emitted first but with no broker/credential content of its own to
 * assert against here). Looked up by content rather than a fixed index so
 * this stays correct regardless of how many statements get added ahead of
 * it in the future. */
function mqttClientSetupCode(result: { statements?: { key: string; code: string }[] }): string {
  const stmt = result.statements?.find((s) => s.code.includes("mqtt_as.MQTTClient("));
  if (!stmt) throw new Error("no MQTTClient setup statement found in codegen result");
  return stmt.code;
}

/** Constructs the client + injects one message onto its queue, then runs
 * buildMsg exactly once (wrapped in a real async function, since buildMsg
 * contains `global` -- same reason node-timer.test.ts wraps its own
 * buildMsg rather than running it at bare module scope) and prints the
 * resulting msg dict. */
function runOneMessage(properties: Record<string, unknown>, injectedTopic: string, injectedPayload: string, retained = false): string {
  const ctx = freshCtx();
  const result = mqttSubscribeNode.codegenSource!(node(properties), ctx);
  const lines = [
    "import asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    `mqtt_as.CLIENTS[-1].queue._inject(${JSON.stringify(injectedTopic)}.encode(), ${JSON.stringify(injectedPayload)}.encode(), ${retained ? "True" : "False"})`,
    "",
    "async def _run():",
    ...result.buildMsg.split("\n").map((l) => `    ${l}`),
    "    print(msg)",
    "",
    "asyncio.run(_run())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

const BASE = { wifiConfigId: "wifi1", brokerConfigId: "broker1" };

describe("thingstudio/mqtt_subscribe node", () => {
  it("connects, subscribes, and delivers an incoming message as payload/topic", () => {
    const output = runOneMessage({ ...BASE, topic: "sensors/temp" }, "sensors/temp", "23.5");
    expect(output).toContain("MQTT_CONNECT server=b port=1883");
    expect(output).toContain("MQTT_SUBSCRIBE topic='sensors/temp' qos=0");
    expect(output).toContain("'payload': '23.5'");
    expect(output).toContain("'topic': 'sensors/temp'");
  });

  it("decodes the retained flag", () => {
    const output = runOneMessage({ ...BASE, topic: "t" }, "t", "x", true);
    expect(output).toContain("'retained': True");
  });

  it("subscribes with the configured qos", () => {
    const output = runOneMessage({ ...BASE, topic: "t", qos: 1 }, "t", "x");
    expect(output).toContain("MQTT_SUBSCRIBE topic='t' qos=1");
  });

  it("rejects a missing brokerConfigId", () => {
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi1" }), ctx)).toThrow(CompileError);
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi1" }), ctx)).toThrow(/requires an MQTT broker config/);
  });

  it("rejects a referenced broker config with no broker hostname", () => {
    setConfig("noHost", { port: 1883 });
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "noHost" }), ctx)).toThrow(
      /no "broker" hostname\/IP set/,
    );
  });

  it("rejects a referenced broker config with an invalid port", () => {
    setConfig("badPort", { broker: "b", port: 70000 });
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "badPort" }), ctx)).toThrow(
      /invalid port/,
    );
  });

  it("resolves the broker config's username/password into the client setup code", () => {
    setConfig("authed", { broker: "b", port: 1883, username: "flowuser", password: "brokerpw" });
    const ctx = freshCtx();
    const result = mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "authed" }), ctx);
    expect(mqttClientSetupCode(result)).toContain('"flowuser"');
    expect(mqttClientSetupCode(result)).toContain('"brokerpw"');
  });

  it("raises a CompileError referencing the missing id when brokerConfigId doesn't resolve", () => {
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "nope" }), ctx)).toThrow(
      /referenced config "nope" not found/,
    );
  });

  it("rejects a missing wifiConfigId/topic", () => {
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", brokerConfigId: "broker1" }), ctx)).toThrow(/requires a WiFi config/);
    expect(() => mqttSubscribeNode.codegenSource!(node({ ...BASE }), ctx)).toThrow(/non-empty "topic"/);
  });

  it("rejects an unsupported qos", () => {
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ ...BASE, topic: "t", qos: 2 }), ctx)).toThrow(/must be 0 or 1/);
  });

  it("rejects a referenced WiFi config with security 'unmanaged' -- mqtt_as always needs real credentials", () => {
    setConfig("unmanaged1", { security: "unmanaged" });
    const ctx = freshCtx();
    expect(() =>
      mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "unmanaged1", brokerConfigId: "broker1" }), ctx),
    ).toThrow(/security "unmanaged", which isn't supported here/);
  });

  it("rejects a referenced WiFi config with security 'password' (the default) and an empty password", () => {
    setConfig("nopw", { ssid: "MyNet", password: "" });
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "nopw", brokerConfigId: "broker1" }), ctx)).toThrow(
      /has no password but security is "password"/,
    );
  });

  it("resolves the WiFi config's ssid/password into the client setup code", () => {
    setConfig("wifi2", { ssid: "RealNet", password: "realpw" });
    const ctx = freshCtx();
    const result = mqttSubscribeNode.codegenSource!(node({ topic: "t", wifiConfigId: "wifi2", brokerConfigId: "broker1" }), ctx);
    expect(mqttClientSetupCode(result)).toContain('"RealNet"');
    expect(mqttClientSetupCode(result)).toContain('"realpw"');
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/mqtt_subscribe", properties: { ...BASE, topic: "sensors/temp" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "any"]],
      configs: configsWith({ broker: "b", port: 1883 }),
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("mqtt_as.MQTTClient(");
    expect(source).toContain("while True:");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("two mqtt_subscribe nodes on the same broker share one client but subscribe independently", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/mqtt_subscribe", properties: { ...BASE, topic: "t1" } },
        { id: 2, type: "thingstudio/mqtt_subscribe", properties: { ...BASE, topic: "t2" } },
      ],
      links: [],
      configs: configsWith({ broker: "b", port: 1883 }),
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/mqtt_as\.MQTTClient\(/g)?.length).toBe(1);
    // pyStringLiteral (used for the .subscribe() topic argument) is
    // JSON.stringify-based -- double-quoted output.
    expect(source).toContain('"t1"');
    expect(source).toContain('"t2"');
  });

  it("mqtt_publish and mqtt_subscribe on the same broker share one client", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "x", repeat: "manual" } },
        { id: 2, type: "thingstudio/mqtt_publish", properties: { ...BASE, topic: "out" } },
        { id: 3, type: "thingstudio/mqtt_subscribe", properties: { ...BASE, topic: "in" } },
      ],
      links: [[1, 1, 0, 2, 0, "string"]],
      configs: configsWith({ broker: "shared.broker", port: 1883 }),
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/mqtt_as\.MQTTClient\(/g)?.length).toBe(1);
    expect(source).toContain("queue_len'] = 20");
  });
});
