// http_in as a core package with a compile hook (2026-10-20): the hook builds the port's route table from
// ctx.nodesOfType (still compile-time duplicate detection); the Python shares one ts_http_server.Server per port
// through runtime.shared, each node owning its request queue. These tests drive real HTTP requests into a real
// background python server built from the package's generated setup.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphConfigNode, GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildCoreNodeDefinition } from "../src/node-library/custom-node.js";
import { descriptor as httpInDescriptor, python as httpInPython, compileHook as httpInCompileHook } from "../src/node-library/core-packages/http-in.js";
import { descriptor as httpResponseDescriptor, python as httpResponsePython } from "../src/node-library/core-packages/http-response.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };

const httpInNode = buildCoreNodeDefinition(httpInDescriptor, httpInPython, httpInCompileHook);
const httpResponseNode = buildCoreNodeDefinition(httpResponseDescriptor, httpResponsePython);

const WIFI: GraphConfigNode = { id: "wifi1", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } };

interface Route {
  id: string;
  port: number;
  path: string;
  method?: "GET" | "POST";
  responseTimeoutMs?: number;
  /** Python run after dequeue, before http_response. `null` skips the response node (timeout path). */
  handler?: string | null;
}

function httpInNodeOf(route: Route): GraphNode {
  return {
    id: route.id,
    type: "thingstudio/http_in",
    properties: {
      port: route.port,
      path: route.path,
      method: route.method ?? "GET",
      ...(route.responseTimeoutMs === undefined ? {} : { responseTimeoutMs: route.responseTimeoutMs }),
      wifiConfigId: "wifi1",
    },
  };
}

function graphOf(routes: Route[]): GraphData {
  return {
    nodes: [...routes.map(httpInNodeOf), { id: "resp", type: "thingstudio/http_response", properties: {} }],
    links: [],
    configs: [WIFI],
  };
}

function ctxWith(hookResult?: (id: string) => unknown): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    resolveConfig: () => ({}),
    findConfigsOfType: (type: string) => (type === WIFI.type ? [WIFI] : []),
    hookResult: hookResult as CodegenContext["hookResult"],
  } as CodegenContext;
}

async function hookError(g: GraphData): Promise<string | undefined> {
  try {
    await runCompileHooks(g, buildRegistry(), runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const responseResult = httpResponseNode.codegenSink!({ id: "resp", type: "thingstudio/http_response", properties: {} }, ctxWith());

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

let proc: ChildProcessWithoutNullStreams | null = null;
let stderrChunks: string[] = [];

afterEach(() => {
  if (proc) {
    proc.kill("SIGKILL");
    proc = null;
  }
});

async function startServer(routes: Route[]): Promise<void> {
  const graph = graphOf(routes);
  const registry = buildRegistry();
  const hooks = await runCompileHooks(graph, registry, runner);
  const setupBlocks: string[] = [];
  const seenKeys = new Set<string>();
  const consumeFns: string[] = [];
  // One ctx for every sibling, matching compile.ts's shared uniqueName counter -- a fresh ctx per node would give
  // each setup the same dedup key and drop all but the first.
  const ctx = ctxWith((id) => hooks.results.get(id));

  for (const route of routes) {
    const node = graph.nodes.find((n) => n.id === route.id)!;
    const src = httpInNode.codegenEventSource!(node, ctx);
    for (const stmt of src.statements ?? []) {
      if (!seenKeys.has(stmt.key)) {
        seenKeys.add(stmt.key);
        setupBlocks.push(stmt.code);
      }
    }
    const bodyLines = [src.waitStatement, src.buildMsg];
    if (route.handler !== null) {
      if (route.handler) bodyLines.push(route.handler);
      bodyLines.push(`msg = await ${responseResult.functionName}(msg)`);
    }
    consumeFns.push(`async def _consume_${route.id}():\n${indent(`while True:\n${indent(bodyLines.join("\n"), 4)}`, 4)}`);
  }
  for (const stmt of responseResult.statements ?? []) {
    if (!seenKeys.has(stmt.key)) {
      seenKeys.add(stmt.key);
      setupBlocks.push(stmt.code);
    }
  }

  const lines = [
    "import runtime",
    "asyncio = runtime.asyncio",
    "import network",
    "import ts_wifi",
    "import ts_http_server",
    "",
    ...setupBlocks,
    "",
    `async def ${responseResult.functionName}(msg):`,
    indent(responseResult.functionBody, 4),
    "",
    ...consumeFns,
    "",
    "async def _main():",
  ];
  for (const port of [...new Set(routes.map((r) => r.port))]) {
    // The package's setup created this singleton at module scope; fetch-only here so READY means the socket is bound.
    lines.push(`    await runtime.shared('http_server', ${port}, 'v1').ensure()`);
  }
  for (const route of routes) lines.push(`    asyncio.create_task(_consume_${route.id}())`);
  lines.push('    print("READY", flush=True)');
  lines.push("    await asyncio.sleep(3600)");
  lines.push("");
  lines.push("asyncio.run(_main())");

  const dir = mkdtempSync(join(tmpdir(), "thingstudio-httpin-"));
  const scriptPath = join(dir, "_server.py");
  writeFileSync(scriptPath, lines.join("\n"));

  stderrChunks = [];
  proc = spawn("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") } });
  proc.stderr.on("data", (c) => stderrChunks.push(c.toString()));

  await new Promise<void>((resolve, reject) => {
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`server never printed READY within 5s. stderr:\n${stderrChunks.join("")}`));
    }, 5000);
    const onData = (c: Buffer) => {
      out += c.toString();
      if (!settled && out.includes("READY")) {
        settled = true;
        clearTimeout(timer);
        proc?.stdout.off("data", onData);
        resolve();
      }
    };
    proc?.stdout.on("data", onData);
    proc?.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server process exited early (code ${code}). stderr:\n${stderrChunks.join("")}`));
    });
  });
}

describe("thingstudio/http_in + thingstudio/http_response packages", () => {
  it("the pymock ts_http_server fixture is a byte-identical copy of the vendored library", () => {
    const fixture = readFileSync(join(__dirname, "fixtures", "pymock", "ts_http_server.py"));
    const vendor = readFileSync(join(__dirname, "../../device-runtime/src/vendor/thingstudio_http/ts_http_server.py"));
    expect(fixture.equals(vendor)).toBe(true);
  });


  it("routes a matching GET request and http_response's payload/statusCode reach the real response", async () => {
    await startServer([{ id: "in1", port: 18081, path: "/status", handler: "msg['payload'] = 'ok'\nmsg['statusCode'] = 201" }]);
    const res = await fetch("http://127.0.0.1:18081/status");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("ok");
  });

  it("defaults statusCode to 200", async () => {
    await startServer([{ id: "in1", port: 18082, path: "/", handler: "msg['payload'] = 'hi'" }]);
    const res = await fetch("http://127.0.0.1:18082/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("does not parse the request body -- payload starts as None", async () => {
    await startServer([{ id: "in1", port: 18083, path: "/echo", method: "POST", handler: "msg['payload'] = repr(msg['payload'])" }]);
    const res = await fetch("http://127.0.0.1:18083/echo", { method: "POST", body: "ignored" });
    expect(await res.text()).toBe("None");
  });

  it("routes on method+path together", async () => {
    await startServer([
      { id: "get1", port: 18084, path: "/thing", method: "GET", handler: "msg['payload'] = 'got'" },
      { id: "post1", port: 18084, path: "/thing", method: "POST", handler: "msg['payload'] = 'posted'" },
    ]);
    expect(await (await fetch("http://127.0.0.1:18084/thing")).text()).toBe("got");
    expect(await (await fetch("http://127.0.0.1:18084/thing", { method: "POST", body: "x" })).text()).toBe("posted");
  });

  it("msg.req carries the method and path", async () => {
    await startServer([{ id: "in1", port: 18085, path: "/who", handler: "msg['payload'] = msg['req']['method'] + ' ' + msg['req']['path']" }]);
    expect(await (await fetch("http://127.0.0.1:18085/who")).text()).toBe("GET /who");
  });

  it("an unmatched path gets a plain 404", async () => {
    await startServer([{ id: "in1", port: 18086, path: "/known" }]);
    expect((await fetch("http://127.0.0.1:18086/unknown")).status).toBe(404);
  });

  it("a request that never reaches http_response times out with a 500", async () => {
    await startServer([{ id: "in1", port: 18087, path: "/stuck", responseTimeoutMs: 300, handler: null }]);
    const start = Date.now();
    const res = await fetch("http://127.0.0.1:18087/stuck");
    const elapsed = Date.now() - start;
    expect(res.status).toBe(500);
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(4000);
  });

  it("two ports get two independent servers", async () => {
    await startServer([
      { id: "a", port: 18088, path: "/", handler: "msg['payload'] = 'A'" },
      { id: "b", port: 18089, path: "/", handler: "msg['payload'] = 'B'" },
    ]);
    expect(await (await fetch("http://127.0.0.1:18088/")).text()).toBe("A");
    expect(await (await fetch("http://127.0.0.1:18089/")).text()).toBe("B");
  });

  it("declares the expected ports", () => {
    expect(httpInNode.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
    expect(httpInNode.ports?.inputs).toBeUndefined();
    expect(httpResponseNode.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(httpResponseNode.ports?.outputs).toBeUndefined();
  });
});

describe("thingstudio/http_in compile hook (no server needed)", () => {
  it("rejects a path that doesn't start with /", async () => {
    expect(await hookError(graphOf([{ id: "a", port: 8080, path: "bad" }]))).toMatch(/must start with "\/"/);
  });

  it("rejects an out-of-range port", async () => {
    expect(await hookError(graphOf([{ id: "a", port: 0, path: "/" }]))).toMatch(/between 1 and 65535/);
  });

  it("rejects an unsupported method", async () => {
    const g = graphOf([{ id: "a", port: 8080, path: "/" }]);
    g.nodes[0]!.properties.method = "DELETE";
    expect(await hookError(g)).toMatch(/must be "GET" or "POST"/);
  });

  it("rejects a non-positive responseTimeoutMs", async () => {
    expect(await hookError(graphOf([{ id: "a", port: 8080, path: "/", responseTimeoutMs: 0 }]))).toMatch(/positive number/);
  });

  it("defaults method to GET and the timeout to 10 s", async () => {
    const g = graphOf([{ id: "a", port: 8080, path: "/" }]);
    const hooks = await runCompileHooks(g, buildRegistry(), runner);
    const props = hooks.results.get("a")!.properties as { routes: { method: string; timeoutS: number }[] };
    expect(props.routes).toEqual([{ id: "a", port: 8080, path: "/", method: "GET", timeoutS: 10 }]);
  });

  it("rejects two nodes claiming the same (method, path) on one port", async () => {
    expect(await hookError(graphOf([
      { id: "a", port: 8080, path: "/dup" },
      { id: "b", port: 8080, path: "/dup" },
    ]))).toMatch(/both claim GET \/dup on port 8080/);
  });

  it("allows the same path with different methods, or on different ports", async () => {
    expect(await hookError(graphOf([
      { id: "a", port: 8080, path: "/same", method: "GET" },
      { id: "b", port: 8080, path: "/same", method: "POST" },
    ]))).toBeUndefined();
    expect(await hookError(graphOf([
      { id: "a", port: 8080, path: "/x" },
      { id: "b", port: 8081, path: "/x" },
    ]))).toBeUndefined();
  });

  it("rejects a flow with no WiFi config", async () => {
    const g: GraphData = { nodes: [httpInNodeOf({ id: "a", port: 8080, path: "/" })], links: [] };
    expect(await hookError(g)).toMatch(/needs a WiFi network/);
  });
});

describe("ts_http_server redeploy", () => {
  it("closing the registered cleanup frees the port for an immediate rebind", async () => {
    const port = 18090;
    const dir = mkdtempSync(join(tmpdir(), "thingstudio-httpin-redeploy-"));
    const scriptPath = join(dir, "_server.py");
    const route = `[{'id': 'a', 'method': 'GET', 'path': '/', 'timeoutS': 2}]`;
    writeFileSync(scriptPath, [
      "import runtime",
      "asyncio = runtime.asyncio",
      "import ts_http_server",
      "async def _main():",
      `    q = {'a': ts_http_server.Queue()}`,
      `    s = ts_http_server.Server(${port}, ${route}, q)`,
      "    await s.ensure()",
      '    print("READY", flush=True)',
      "    await asyncio.sleep(0.2)",
      `    runtime._cleanups["http-server-${port}"]()`,
      "    runtime._singletons.clear()",
      `    q2 = {'a': ts_http_server.Queue()}`,
      `    s2 = ts_http_server.Server(${port}, ${route}, q2)`,
      "    await s2.ensure()",
      '    print("READY2", flush=True)',
      "    await asyncio.sleep(3600)",
      "",
      "asyncio.run(_main())",
    ].join("\n"));

    stderrChunks = [];
    proc = spawn("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") } });
    proc.stderr.on("data", (c) => stderrChunks.push(c.toString()));

    const seen = { ready: false, ready2: false };
    const waitFor = (label: "READY" | "READY2") =>
      new Promise<void>((resolve, reject) => {
        if ((label === "READY" && seen.ready) || (label === "READY2" && seen.ready2)) return resolve();
        let out = "";
        const timer = setTimeout(() => reject(new Error(`never saw ${label} within 3s. stderr:\n${stderrChunks.join("")}`)), 3000);
        const onData = (c: Buffer) => {
          out += c.toString();
          if (out.includes("READY2")) seen.ready2 = true;
          if (out.includes("READY")) seen.ready = true;
          if ((label === "READY" && seen.ready) || (label === "READY2" && seen.ready2)) {
            clearTimeout(timer);
            proc?.stdout.off("data", onData);
            resolve();
          }
        };
        proc?.stdout.on("data", onData);
        proc?.on("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`server exited early (code ${code}) waiting for ${label}. stderr:\n${stderrChunks.join("")}`));
        });
      });

    await waitFor("READY");
    await waitFor("READY2");
  });
});
