// udp_send as a core package with a compile hook (2026-10-19): the hook validates host/port/timeout and derives
// WiFi; the Python keeps the built-in's non-blocking bounded send and shared socket. Behaviour tests use a real
// local UDP server.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import dgram from "node:dgram";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphConfigNode, GraphData } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const TYPE = "thingstudio/udp_send";
const WIFI = "thingstudio/config/wifi";

function graph(properties: Record<string, unknown>, configs: GraphConfigNode[] = []): GraphData {
  return { nodes: [{ id: "1", type: TYPE, properties }], links: [], ...(configs.length ? { configs } : {}) };
}
const wifi = (properties: Record<string, unknown>, id = "w1"): GraphConfigNode => ({ id, type: WIFI, properties });
const unmanaged = () => [wifi({ security: "unmanaged" })];

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
  return def.codegenSink!(g.nodes[0]!, ctx);
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

async function runSend(properties: Record<string, unknown>, payload: unknown, configs = unmanaged()): Promise<void> {
  const result = await codegen(graph(properties, configs));
  const lines = [
    "import runtime",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    "async def _main():",
    `    msg = {'payload': ${JSON.stringify(payload)}, 'topic': ''}`,
    `    await ${result.functionName}(msg)`,
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-udpsend-"));
  const script = join(dir, "_snippet.py");
  writeFileSync(script, lines.join("\n"));
  await execFileAsync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 10_000,
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("thingstudio/udp_send package", () => {
  let server: dgram.Socket;
  let port: number;
  let received: Buffer[];

  beforeEach(async () => {
    received = [];
    server = dgram.createSocket("udp4");
    server.on("message", (msg) => received.push(msg));
    await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends a string payload as UTF-8 bytes to the configured host:port", async () => {
    await runSend({ host: "127.0.0.1", port, timeoutMs: 2000 }, "hello udp");
    await waitFor(() => received.length > 0);
    expect(received[0]!.toString("utf8")).toBe("hello udp");
  });

  it("stringifies a non-string, non-bytes payload", async () => {
    await runSend({ host: "127.0.0.1", port, timeoutMs: 2000 }, 42);
    await waitFor(() => received.length > 0);
    expect(received[0]!.toString("utf8")).toBe("42");
  });

  it("two udp_send instances share the socket through runtime.shared", async () => {
    const a = await codegen(graph({ host: "h", port: 1 }, unmanaged()));
    const b = await codegen(graph({ host: "h", port: 1 }, unmanaged()));
    for (const r of [a, b]) {
      const setup = (r.statements ?? []).map((s) => s.code).join("\n");
      expect(setup).toContain("runtime.shared('udp_send_sock'");
    }
  });

  it("rejects a missing host", async () => {
    expect(await hookError(graph({ port: 9999 }, unmanaged()))).toMatch(/non-empty "host"/);
  });

  it("rejects an invalid port", async () => {
    expect(await hookError(graph({ host: "h", port: 0 }, unmanaged()))).toMatch(/valid port number/);
    expect(await hookError(graph({ host: "h", port: 70000 }, unmanaged()))).toMatch(/valid port number/);
  });

  it("rejects a non-positive timeoutMs", async () => {
    expect(await hookError(graph({ host: "h", port: 1, timeoutMs: 0 }, unmanaged()))).toMatch(/positive number/);
  });

  it("keeps the built-in's non-blocking bounded send and shared cleanup", async () => {
    const result = await codegen(graph({ host: "h", port: 1 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain(".setblocking(False)");
    expect(generated).toContain("errno.EAGAIN");
    expect(generated).toContain("await asyncio.wait_for(");
    expect(generated).toContain("runtime.register_cleanup('udp-send-sock'");
    expect(generated).toContain("_sock.close()");
    expect(generated).toContain("int(properties.get('timeoutMs', 2000)) / 1000");
  });

  it("folds the target host:port into lookup and non-EAGAIN errors", async () => {
    const result = await codegen(graph({ host: "example.invalid", port: 4242 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("udp_send: could not resolve %s:%s");
    expect(generated).toContain("udp_send to %s:%s failed");
    expect(generated).toContain('"example.invalid"');
    expect(generated).toContain("4242");
  });

  it("refuses a flow with no WiFi config", async () => {
    expect(await hookError(graph({ host: "h", port: 1 }))).toMatch(/needs a WiFi network/);
  });

  it("refuses two WiFi configs", async () => {
    expect(await hookError(graph({ host: "h", port: 1 }, [wifi({ ssid: "a" }, "w1"), wifi({ ssid: "b" }, "w2")]))).toMatch(/2 WiFi configs/);
  });

  it("brings the link up with no connect for unmanaged", async () => {
    const result = await codegen(graph({ host: "h", port: 1 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("ts_wifi.ensure_station(");
    expect(generated).toContain('"unmanaged"');
  });

  it("passes the config's credentials and the mqtt deferral to ts_wifi", async () => {
    const g: GraphData = {
      nodes: [
        { id: "1", type: TYPE, properties: { host: "h", port: 1 } },
        { id: "2", type: "thingstudio/mqtt_publish", properties: { topic: "t", brokerConfigId: "b1" } },
      ],
      links: [],
      configs: [
        wifi({ ssid: "MyNet", password: "hunter2" }),
        { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "b", port: 1883 } },
      ],
    };
    const result = await codegen(g);
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain('"ssid": "MyNet"');
    expect(generated).toContain('"password": "hunter2"');
    expect(generated).toContain('"deferToMqtt": True');
  });

  it("refuses a password network with no password", async () => {
    expect(await hookError(graph({ host: "h", port: 1 }, [wifi({ ssid: "MyNet", password: "" })]))).toMatch(/has no password/);
  });
});
