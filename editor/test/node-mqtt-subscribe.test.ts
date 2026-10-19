// mqtt_subscribe as a core package with a compile hook (2026-10-19): the hook validates topic/qos and derives the
// flow's WiFi + referenced broker config; the Python waits for a message routed to this node by the shared ts_mqtt
// client. Behaviour tests run the package's setup + wait/emit once, with a message injected into pymock's mqtt_as
// queue (the software analog of a real broker delivering it); validation tests run the real WASI hook.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphConfigNode, GraphData } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { compileWithHooks } from "./compile-with-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const TYPE = "thingstudio/mqtt_subscribe";

const WIFI = (properties: Record<string, unknown> = { ssid: "s", password: "pw" }, id = "wifi1"): GraphConfigNode => ({
  id,
  type: "thingstudio/config/wifi",
  properties,
});
const BROKER = (properties: Record<string, unknown> = { broker: "b", port: 1883 }, id = "broker1"): GraphConfigNode => ({
  id,
  type: "thingstudio/config/mqtt-broker",
  properties,
});

function graphWith(props: Record<string, unknown>, configs: GraphConfigNode[] = [WIFI(), BROKER()]): GraphData {
  return {
    nodes: [{ id: "1", type: TYPE, properties: { ...props, brokerConfigId: props.brokerConfigId ?? "broker1" } }],
    links: [],
    configs,
  };
}

async function hookError(g: GraphData): Promise<string | undefined> {
  try {
    await runCompileHooks(g, buildRegistry(), runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Compiles the package, runs its setup, injects one message into the shared client's queue, then runs the
 * wait/emit pair once and prints the message. */
async function runOneMessage(props: Record<string, unknown>, topic: string, payload: string, retained = false): Promise<string> {
  const g = graphWith(props);
  const registry = buildRegistry();
  const hooks = await runCompileHooks(g, registry, runner);
  const def = registry.get(TYPE)!;
  const used = new Set<string>();
  const ctx: CodegenContext = {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    hookResult: (id: string) => hooks.results.get(id),
    resolveConfig: () => ({}),
    findConfigsOfType: (type: string) => (g.configs ?? []).filter((c) => c.type === type),
  };
  const result = def.codegenEventSource!(g.nodes[0]!, ctx);
  const lines = [
    "import runtime",
    "asyncio = runtime.asyncio",
    "import mqtt_as",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    `mqtt_as.CLIENTS[-1].queue._inject(${JSON.stringify(topic)}.encode(), ${JSON.stringify(payload)}.encode(), ${retained ? "True" : "False"})`,
    "",
    "async def _run():",
    `    ${result.waitStatement}`,
    `    ${result.buildMsg}`,
    "    print(msg)",
    "",
    "asyncio.run(_run())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-mqttsub-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("thingstudio/mqtt_subscribe package", () => {
  it("connects, subscribes, and delivers an incoming message as payload/topic", async () => {
    const output = await runOneMessage({ topic: "sensors/temp" }, "sensors/temp", "23.5");
    expect(output).toContain("MQTT_CONNECT server=b port=1883");
    expect(output).toContain("MQTT_SUBSCRIBE topic='sensors/temp' qos=0");
    expect(output).toContain("'payload': '23.5'");
    expect(output).toContain("'topic': 'sensors/temp'");
  });

  it("decodes the retained flag", async () => {
    const output = await runOneMessage({ topic: "t" }, "t", "x", true);
    expect(output).toContain("'retained': True");
  });

  it("subscribes with the configured qos", async () => {
    const output = await runOneMessage({ topic: "t", qos: 1 }, "t", "x");
    expect(output).toContain("MQTT_SUBSCRIBE topic='t' qos=1");
  });

  it("rejects a missing brokerConfigId", async () => {
    expect(await hookError(graphWith({ topic: "t", brokerConfigId: "" }))).toMatch(/requires an MQTT broker config/);
  });

  it("rejects a referenced broker config with no broker hostname", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI(), BROKER({ port: 1883 })]))).toMatch(/no "broker" hostname\/IP set/);
  });

  it("rejects a referenced broker config with an invalid port", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI(), BROKER({ broker: "b", port: 70000 })]))).toMatch(/invalid port/);
  });

  it("rejects a missing topic", async () => {
    expect(await hookError(graphWith({}))).toMatch(/non-empty "topic"/);
  });

  it("rejects an unsupported qos", async () => {
    expect(await hookError(graphWith({ topic: "t", qos: 2 }))).toMatch(/must be 0 or 1/);
  });

  it("rejects a flow with no WiFi config", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [BROKER()]))).toMatch(/needs a WiFi network/);
  });

  it("rejects a flow with two WiFi configs", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI(), WIFI({ ssid: "Other", password: "x" }, "wifi2"), BROKER()]))).toMatch(/a flow can only have one/);
  });

  it("rejects WiFi security 'unmanaged' -- mqtt_as always needs real credentials", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI({ security: "unmanaged" }), BROKER()]))).toMatch(/security "unmanaged"/);
  });

  it("rejects security 'password' with an empty password", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI({ ssid: "MyNet", password: "" }), BROKER()]))).toMatch(/has no password but security is "password"/);
  });

  it("compiles into a full flow as an event source", async () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: TYPE, properties: { topic: "sensors/temp", brokerConfigId: "broker1" } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "any"]],
      configs: [WIFI(), BROKER()],
    };
    const { source } = await compileWithHooks(graph, buildRegistry());
    expect(source).toContain("ts_mqtt.ensure_client(");
    expect(source).toContain("await _broker.wait_message(");
    expect(source).toContain("while True:");
  });
});
