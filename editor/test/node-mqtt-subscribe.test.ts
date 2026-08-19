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

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { mqttSubscribeNode } from "../src/node-library/mqtt-subscribe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    // resolveConfig isn't exercised here -- mqtt_subscribe stays
    // registry-only this session (config-node-and-palette-implementation-
    // briefing.md's explicit, flagged follow-up). Stub throws if ever
    // called, matching every other node test file's updated ctx.
    resolveConfig(id: string): Record<string, unknown> {
      throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
    },
  };
}

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/mqtt_subscribe", properties };
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

describe("thingstudio/mqtt_subscribe node", () => {
  it("connects, subscribes, and delivers an incoming message as payload/topic", () => {
    const output = runOneMessage({ broker: "b", port: 1883, topic: "sensors/temp", ssid: "s" }, "sensors/temp", "23.5");
    expect(output).toContain("MQTT_CONNECT server=b port=1883");
    expect(output).toContain("MQTT_SUBSCRIBE topic='sensors/temp' qos=0");
    expect(output).toContain("'payload': '23.5'");
    expect(output).toContain("'topic': 'sensors/temp'");
  });

  it("decodes the retained flag", () => {
    const output = runOneMessage({ broker: "b", topic: "t", ssid: "s" }, "t", "x", true);
    expect(output).toContain("'retained': True");
  });

  it("subscribes with the configured qos", () => {
    const output = runOneMessage({ broker: "b", topic: "t", ssid: "s", qos: 1 }, "t", "x");
    expect(output).toContain("MQTT_SUBSCRIBE topic='t' qos=1");
  });

  it("rejects a missing broker/ssid/topic", () => {
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ topic: "t", ssid: "s" }), ctx)).toThrow(CompileError);
    expect(() => mqttSubscribeNode.codegenSource!(node({ broker: "b", topic: "t" }), ctx)).toThrow(/requires "ssid"/);
    expect(() => mqttSubscribeNode.codegenSource!(node({ broker: "b", ssid: "s" }), ctx)).toThrow(/non-empty "topic"/);
  });

  it("rejects an unsupported qos", () => {
    const ctx = freshCtx();
    expect(() => mqttSubscribeNode.codegenSource!(node({ broker: "b", ssid: "s", topic: "t", qos: 2 }), ctx)).toThrow(/must be 0 or 1/);
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/mqtt_subscribe", properties: { broker: "b", topic: "sensors/temp", ssid: "s" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "any"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("mqtt_as.MQTTClient(");
    expect(source).toContain("while True:");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("two mqtt_subscribe nodes on the same broker share one client but subscribe independently", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/mqtt_subscribe", properties: { broker: "b", topic: "t1", ssid: "s" } },
        { id: 2, type: "thingstudio/mqtt_subscribe", properties: { broker: "b", topic: "t2", ssid: "s" } },
      ],
      links: [],
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
        { id: 2, type: "thingstudio/mqtt_publish", properties: { broker: "shared.broker", port: 1883, topic: "out", ssid: "s" } },
        { id: 3, type: "thingstudio/mqtt_subscribe", properties: { broker: "shared.broker", port: 1883, topic: "in", ssid: "s" } },
      ],
      links: [[1, 1, 0, 2, 0, "string"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/mqtt_as\.MQTTClient\(/g)?.length).toBe(1);
    expect(source).toContain("queue_len'] = 20");
  });
});
