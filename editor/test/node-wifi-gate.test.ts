// wifi_gate as a core package with a compile hook (2026-10-19): the hook derives WiFi, the shared ts_wifi
// dependency brings the link up, and the transform checks the live link state per message.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphConfigNode, GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const TYPE = "thingstudio/wifi_gate";
const WIFI = "thingstudio/config/wifi";

function node(properties: Record<string, unknown> = {}): GraphNode {
  return { id: "1", type: TYPE, properties };
}

function graph(configs: GraphConfigNode[], extra: GraphNode[] = []): GraphData {
  return { nodes: [node(), ...extra], links: [], ...(configs.length ? { configs } : {}) };
}

const wifi = (properties: Record<string, unknown>, id = "w1"): GraphConfigNode => ({ id, type: WIFI, properties });

async function hookError(g: GraphData): Promise<string | undefined> {
  try {
    await runCompileHooks(g, buildRegistry(), runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function codegen(g: GraphData) {
  const registry = buildRegistry();
  const hooks = await runCompileHooks(g, registry, runner);
  const def = registry.get(TYPE)!;
  const ctx: CodegenContext = {
    uniqueName: (hint: string) => `_${hint}`,
    hookResult: (id: string) => hooks.results.get(id),
    resolveConfig: () => ({}),
    findConfigsOfType: (type: string) => (g.configs ?? []).filter((c) => c.type === type),
  };
  return def.codegenTransform!(g.nodes[0]!, ctx);
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

async function runGateAsync(g: GraphData, connected: boolean, payload: unknown): Promise<{ payload: unknown; topic: unknown } | null> {
  const result = await codegen(g);
  const lines = [
    "import runtime",
    "import json",
    "import network",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    `network.WLAN.CONNECTED = ${connected ? "True" : "False"}`,
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    "async def _main():",
    `    msg = {'payload': ${JSON.stringify(payload)}, 'topic': 'in'}`,
    `    msg = await ${result.functionName}(msg)`,
    "    print('RESULT:' + json.dumps(None if msg is None else {'payload': msg['payload'], 'topic': msg['topic']}))",
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-wifigate-"));
  const script = join(dir, "_snippet.py");
  writeFileSync(script, lines.join("\n"));
  const stdout = execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
  });
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!line) throw new Error(`no RESULT line:\n${stdout}`);
  return JSON.parse(line.slice("RESULT:".length));
}

describe("thingstudio/wifi_gate package", () => {
  it("passes the msg through unchanged when the WiFi station is connected", async () => {
    const out = await runGateAsync(graph([wifi({ security: "unmanaged" })]), true, "hello gate");
    expect(out).toEqual({ payload: "hello gate", topic: "in" });
  });

  it("drops the msg (returns None) when the WiFi station is not connected", async () => {
    expect(await runGateAsync(graph([wifi({ security: "unmanaged" })]), false, "hello gate")).toBeNull();
  });

  it("refuses a flow with no WiFi config", async () => {
    expect(await hookError(graph([]))).toMatch(/needs a WiFi network/);
  });

  it("refuses a flow with two WiFi configs", async () => {
    expect(await hookError(graph([wifi({ ssid: "a" }, "w1"), wifi({ ssid: "b" }, "w2")]))).toMatch(/2 WiFi configs/);
  });

  it("brings the station up with no connect call for unmanaged", async () => {
    const result = await codegen(graph([wifi({ security: "unmanaged" })]));
    const setup = result.statements?.[0]?.code ?? "";
    expect(setup).toContain("ts_wifi.ensure_station(");
    expect(setup).toContain('"unmanaged"');
  });

  it("connects with the config's credentials", async () => {
    const result = await codegen(graph([wifi({ ssid: "MyNet", password: "hunter2" })]));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain('"ssid": "MyNet"');
    expect(generated).toContain('"password": "hunter2"');
  });

  it("defers to mqtt_as when the flow has an mqtt node", async () => {
    const result = await codegen(
      graph(
        [wifi({ ssid: "MyNet", password: "pw" }), { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "b", port: 1883 } }],
        [{ id: "m1", type: "thingstudio/mqtt_publish", properties: { topic: "t", brokerConfigId: "b1" } }],
      ),
    );
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain('"deferToMqtt": True');
  });

  it("checks the live link state on _sta", async () => {
    const result = await codegen(graph([wifi({ security: "unmanaged" })]));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("_sta.isconnected()");
  });

  it("declares an input and output msg port", async () => {
    const def = buildRegistry().get(TYPE)!;
    expect(def.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(def.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
  });
});
