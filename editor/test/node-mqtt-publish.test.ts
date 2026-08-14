// Tier 1 network node: mqtt_publish (editor/src/node-library/mqtt-publish.ts).
// A sink triggered by a one-shot ("manual") inject, so unlike
// node-wifi-status.test.ts/node-mqtt-subscribe.test.ts this runs fine
// through the full compile() + runGenerated path (same pattern as
// node-boolean.test.ts) -- no repeating loop involved. Asserts against
// pymock's mqtt_as.py fixture (PUBLISHED list + printed MQTT_* lines),
// not a real broker -- see node-http-request.test.ts for the real-local-
// server approach used where the node's own I/O logic (not just its
// config wiring) needs exercising; mqtt_as itself is the vendored,
// already-proven-elsewhere library here, so this test's job is "does the
// generated code call it correctly," not "does MQTT actually work."

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { mqttPublishNode } from "../src/node-library/mqtt-publish.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import type { GraphNode } from "../src/compiler/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();
const ctx: CodegenContext = { uniqueName: (hint) => `_${hint}` };

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/mqtt_publish", properties };
}

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

function graphWith(mqttProps: Record<string, unknown>): GraphData {
  return {
    nodes: [
      { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "42.5", repeat: "manual" } },
      { id: 2, type: "thingstudio/mqtt_publish", properties: mqttProps },
    ],
    links: [[1, 1, 0, 2, 0, "string"]],
  };
}

describe("thingstudio/mqtt_publish node", () => {
  it("connects once and publishes the inbound payload to the configured topic", () => {
    const { source } = compile(
      graphWith({ broker: "test.broker.local", port: 1883, topic: "sensors/temp", ssid: "MyNet", password: "hunter2" }),
      registry,
    );
    const output = runGenerated(source);
    expect(output).toContain("MQTT_CONNECT server=test.broker.local port=1883");
    expect(output).toContain("MQTT_PUBLISH topic='sensors/temp' payload=b'42.5' retain=False qos=0");
  });

  it("publishes with retain=True and qos=1 when configured", () => {
    const { source } = compile(
      graphWith({ broker: "b", port: 1883, topic: "t", ssid: "s", retain: true, qos: 1 }),
      registry,
    );
    const output = runGenerated(source);
    expect(output).toContain("retain=True qos=1");
  });

  it("two mqtt_publish nodes on the same broker share one client (setup dedup)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "a", repeat: "manual" } },
        { id: 2, type: "thingstudio/mqtt_publish", properties: { broker: "b", port: 1883, topic: "t1", ssid: "s" } },
        { id: 3, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "b", repeat: "manual" } },
        { id: 4, type: "thingstudio/mqtt_publish", properties: { broker: "b", port: 1883, topic: "t2", ssid: "s" } },
      ],
      links: [
        [1, 1, 0, 2, 0, "string"],
        [2, 3, 0, 4, 0, "string"],
      ],
    };
    const { source } = compile(graph, registry);
    expect(source.match(/mqtt_as\.MQTTClient\(/g)?.length).toBe(1);
    const output = runGenerated(source);
    expect(output).toContain("MQTT_PUBLISH topic='t1'");
    expect(output).toContain("MQTT_PUBLISH topic='t2'");
  });

  it("rejects a missing broker", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", ssid: "s" }), ctx)).toThrow(CompileError);
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", ssid: "s" }), ctx)).toThrow(/requires a "broker"/);
  });

  it("rejects a missing ssid", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ broker: "b", topic: "t" }), ctx)).toThrow(/requires "ssid"/);
  });

  it("rejects a missing topic", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ broker: "b", ssid: "s" }), ctx)).toThrow(/non-empty "topic"/);
  });

  it("rejects an invalid port", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ broker: "b", ssid: "s", topic: "t", port: 0 }), ctx)).toThrow(/valid port number/);
    expect(() => mqttPublishNode.codegenSink!(node({ broker: "b", ssid: "s", topic: "t", port: 70000 }), ctx)).toThrow(/valid port number/);
  });

  it("rejects an unsupported qos", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ broker: "b", ssid: "s", topic: "t", qos: 2 }), ctx)).toThrow(/must be 0 or 1/);
  });

  it("defaults port to 1883 and qos to 0", () => {
    const result = mqttPublishNode.codegenSink!(node({ broker: "b", ssid: "s", topic: "t" }), ctx);
    expect(result.statements?.[0]?.code).toContain("_cfg['port'] = 1883");
    expect(result.functionBody).toContain("qos=0");
  });
});
