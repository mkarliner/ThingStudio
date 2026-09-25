// Tier 1 network node pair: http_in / http_response
// (editor/src/node-library/http-in.ts, http-response.ts, and their shared
// plumbing in http-server-shared.ts -- that file's own header has the
// full v1 scope and architecture).
//
// http_in/http_response are the opposite shape from http_request.ts's
// transform: rather than firing one request and returning, the generated
// code IS a real, long-lived asyncio TCP server. So this file's harness
// runs the opposite direction from node-http-request.test.ts's: the
// generated Python is spawned as a genuinely long-lived BACKGROUND
// process (child_process.spawn, not execFile/execFileSync -- there's no
// single "run once, read the result" moment here), and real HTTP
// requests are made INTO it from Node's own `fetch`, not the other way
// around. Killed in afterEach; never left running past one test.
//
// Builds a small standalone driver script per test wiring httpInNode's
// own codegenEventSource output for one or more synthetic http_in nodes
// straight to httpResponseNode's own codegenSink output (bypassing
// compile.ts/the full graph, same approach node-http-request.test.ts
// already uses) -- a `handler` snippet per route stands in for whatever a
// real flow puts in between (a function node setting msg['statusCode'],
// etc.), and `handler: null` skips calling http_response entirely, to
// exercise the auto-timeout/500 fallback.

import { flowWifiConfigsFrom } from "./flow-wifi-helper.js";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { httpInNode } from "../src/node-library/http-in.js";
import { httpResponseNode } from "../src/node-library/http-response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeWifiConfigs = new Map<string, Record<string, unknown>>();
let wifiStatusNodes: GraphNode[] = [];
let httpInNodes: GraphNode[] = [];

// uniqueName below is a real counter (not the "_${hint}" constant stub
// node-http-request.test.ts's ctx uses) -- http_response's own
// functionName needs to be genuinely unique across a test file that
// calls codegenSink more than once per test in some cases (duplicate-
// route tests construct more than one http_in node in a single
// codegen call), matching compile.ts's real ctx.uniqueName contract
// instead of a throwaway stub.
function makeCtx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName: (hint: string) => {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    resolveConfig: (id: string) => {
      const cfg = fakeWifiConfigs.get(id);
      if (!cfg) throw new Error(`unexpected resolveConfig("${id}") call`);
      return cfg;
    },
    findConfigsOfType: (type: string) => (type === "thingstudio/config/wifi" ? flowWifiConfigsFrom(wifiStatusNodes, (id) => fakeWifiConfigs.get(id)) : []),
    findNodesOfType: (type: string) => {
      if (type === "thingstudio/wifi_status") return wifiStatusNodes;
      if (type === "thingstudio/http_in") return httpInNodes;
      return [];
    },
  };
}

let ctx: CodegenContext;

function httpInGraphNode(id: string, properties: Record<string, unknown>): GraphNode {
  return { id, type: "thingstudio/http_in", properties };
}

beforeEach(() => {
  fakeWifiConfigs.clear();
  fakeWifiConfigs.set("unmanaged1", { security: "unmanaged" });
  wifiStatusNodes = [{ id: "wifi_status_1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } }];
  httpInNodes = [];
  ctx = makeCtx();
});

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

interface Route {
  id: string;
  port: number;
  path: string;
  method?: "GET" | "POST";
  responseTimeoutMs?: number;
  /** Python, run against each dequeued msg before http_response's own
   * function is called -- stands in for whatever a real flow puts
   * between http_in and http_response. Omit for a plain passthrough;
   * `null` skips calling http_response entirely (the auto-timeout/500
   * path). */
  handler?: string | null;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let stderrChunks: string[] = [];

afterEach(() => {
  if (proc) {
    proc.kill("SIGKILL");
    proc = null;
  }
});

/** Starts a real background python3 server process wired from one or more
 * http_in nodes to http_response (or, per-route, skipping it entirely),
 * and waits until it prints READY (after its own asyncio.start_server()
 * calls have completed) before returning -- so a caller's first real
 * request never races server startup. */
async function startServer(routes: Route[]): Promise<void> {
  httpInNodes = routes.map((r) =>
    httpInGraphNode(r.id, { port: r.port, path: r.path, method: r.method ?? "GET", responseTimeoutMs: r.responseTimeoutMs ?? 2000 }),
  );

  const responseResult = httpResponseNode.codegenSink!({ id: "resp", type: "thingstudio/http_response", properties: {} }, ctx);

  const seenImports = new Set<string>(["import network"]);
  const setupBlocks: string[] = [];
  const seenKeys = new Set<string>();
  const consumeFns: string[] = [];

  for (const inNode of httpInNodes) {
    const src = httpInNode.codegenEventSource!(inNode, ctx);
    const route = routes.find((r) => r.id === inNode.id)!;
    for (const imp of src.imports ?? []) seenImports.add(imp);
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
    const loopBody = bodyLines.join("\n");
    consumeFns.push(`async def _consume_${route.id}():\n${indent(`while True:\n${indent(loopBody, 4)}`, 4)}`);
  }

  // "import runtime" + "asyncio = runtime.asyncio", NOT a bare "import
  // asyncio" -- matching compile.ts's own real boilerplate exactly (and
  // node-udp-receive.test.ts's identical precedent), so pymock's own
  // runtime.py fixture -- which provides a real, dedup-by-key
  // register_cleanup() -- is what generated code's
  // `runtime.register_cleanup(...)` calls (http-server-shared.ts) resolve
  // against, instead of a bare NameError.
  const lines: string[] = ["import runtime", "asyncio = runtime.asyncio", "import sys", ...seenImports, "", ...setupBlocks, ""];
  lines.push(`async def ${responseResult.functionName}(msg):`);
  lines.push(indent(responseResult.functionBody, 4));
  lines.push("");
  lines.push(...consumeFns);
  lines.push("");
  lines.push("async def _main():");
  // Explicitly awaited here, one call per distinct port, BEFORE printing
  // READY -- not left to the freshly-created consumer tasks below to get
  // a scheduling turn on their own first. _http_ensure_<port>() is
  // idempotent (a global bool flag, http-server-shared.ts), so a
  // consumer's own later call is just a no-op once this has already run;
  // this is purely about making READY a genuine "the listening socket is
  // actually bound" signal rather than a best-effort scheduling-turn
  // guess, which proved flaky under load (real failure seen running the
  // full suite in parallel: a fixed number of `await asyncio.sleep(0)`
  // turns isn't always enough for asyncio.start_server's own bind to
  // land before the client's first real connection attempt).
  const ports = [...new Set(routes.map((r) => r.port))];
  for (const port of ports) lines.push(`    await _http_ensure_${port}()`);
  for (const route of routes) lines.push(`    asyncio.create_task(_consume_${route.id}())`);
  lines.push(`    print("READY", flush=True)`);
  lines.push(`    await asyncio.sleep(3600)`);
  lines.push("");
  lines.push("asyncio.run(_main())");

  const dir = mkdtempSync(join(tmpdir(), "thingstudio-httpin-"));
  const scriptPath = join(dir, "_server.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");

  stderrChunks = [];
  proc = spawn("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: pymockDir } });
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

describe("thingstudio/http_in + thingstudio/http_response nodes", () => {
  it("routes a matching GET request to http_in, and http_response's msg.payload/statusCode reach the real HTTP response", async () => {
    await startServer([{ id: "in1", port: 18081, path: "/status", handler: "msg['payload'] = 'ok'\nmsg['statusCode'] = 201" }]);
    const res = await fetch("http://127.0.0.1:18081/status");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("ok");
  });

  it("defaults statusCode to 200 when the handler doesn't set one", async () => {
    await startServer([{ id: "in1", port: 18082, path: "/", handler: "msg['payload'] = 'hi'" }]);
    const res = await fetch("http://127.0.0.1:18082/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("v1 does not parse the request body -- msg.payload starts out None regardless of what the client sent", async () => {
    await startServer([{ id: "in1", port: 18083, path: "/echo", method: "POST", handler: "msg['payload'] = repr(msg['payload'])" }]);
    const res = await fetch("http://127.0.0.1:18083/echo", { method: "POST", body: "this body is ignored in v1" });
    expect(await res.text()).toBe("None");
  });

  it("routes on method+path together -- GET and POST on the same path are two independent routes", async () => {
    await startServer([
      { id: "get1", port: 18084, path: "/thing", method: "GET", handler: "msg['payload'] = 'got'" },
      { id: "post1", port: 18084, path: "/thing", method: "POST", handler: "msg['payload'] = 'posted'" },
    ]);
    const getRes = await fetch("http://127.0.0.1:18084/thing", { method: "GET" });
    const postRes = await fetch("http://127.0.0.1:18084/thing", { method: "POST", body: "x" });
    expect(await getRes.text()).toBe("got");
    expect(await postRes.text()).toBe("posted");
  });

  it("msg.req carries the real method and path", async () => {
    await startServer([{ id: "in1", port: 18085, path: "/who", handler: "msg['payload'] = msg['req']['method'] + ' ' + msg['req']['path']" }]);
    const res = await fetch("http://127.0.0.1:18085/who");
    expect(await res.text()).toBe("GET /who");
  });

  it("an unmatched path gets a plain 404, not a hang", async () => {
    await startServer([{ id: "in1", port: 18086, path: "/known" }]);
    const res = await fetch("http://127.0.0.1:18086/unknown");
    expect(res.status).toBe(404);
  });

  it("a request whose flow never reaches http_response times out with a 500, not a hang (fault-handling)", async () => {
    await startServer([{ id: "in1", port: 18087, path: "/stuck", responseTimeoutMs: 300, handler: null }]);
    const start = Date.now();
    const res = await fetch("http://127.0.0.1:18087/stuck");
    const elapsed = Date.now() - start;
    expect(res.status).toBe(500);
    expect(elapsed).toBeGreaterThanOrEqual(250); // real wait, not an immediate short-circuit
    expect(elapsed).toBeLessThan(4000); // and genuinely bounded, not a de-facto hang
  });

  it("two ports get two independent servers, each only serving its own routes", async () => {
    await startServer([
      { id: "a", port: 18088, path: "/", handler: "msg['payload'] = 'A'" },
      { id: "b", port: 18089, path: "/", handler: "msg['payload'] = 'B'" },
    ]);
    expect(await (await fetch("http://127.0.0.1:18088/")).text()).toBe("A");
    expect(await (await fetch("http://127.0.0.1:18089/")).text()).toBe("B");
  });

  it("http_response completing a request that was never asked for raises a clear, attributable error", () => {
    const responseResult = httpResponseNode.codegenSink!({ id: "resp", type: "thingstudio/http_response", properties: {} }, ctx);
    expect(responseResult.functionBody).toContain("did not come from an http_in node");
  });

  // Real bug, hit on Mike's own second real-browser deploy of a flow with
  // an http_in node (not hypothetical): without a registered cleanup, the
  // previous deploy's listening socket was never closed, so the next
  // deploy's own asyncio.start_server() call on the same port failed with
  // EADDRINUSE. Same fix shape udp-receive.ts/udp-send.ts already
  // established (redeploy-cleanup-and-network-fault-detection-
  // briefing.md's Problem 1) -- see http-server-shared.ts's own comment
  // at the register_cleanup() call site.
  it("registers a redeploy cleanup that closes the listening server, keyed by port", () => {
    httpInNodes = [httpInGraphNode("a", { port: 8080, path: "/", method: "GET" })];
    const result = httpInNode.codegenEventSource!(httpInNodes[0]!, ctx);
    const serverSetup = result.statements?.find((s) => s.key === "http-server-8080");
    expect(serverSetup?.code).toContain('runtime.register_cleanup("http-server-8080"');
    expect(serverSetup?.code).toContain("_http_server_8080.close()");
  });

  it("surviving a redeploy: closing the registered cleanup actually frees the port for an immediate rebind", async () => {
    const port = 18090;
    httpInNodes = [httpInGraphNode("a", { port, path: "/", method: "GET" })];
    const src = httpInNode.codegenEventSource!(httpInNodes[0]!, ctx);
    const responseResult = httpResponseNode.codegenSink!({ id: "resp", type: "thingstudio/http_response", properties: {} }, ctx);

    const setupCode = (src.statements ?? []).map((s) => s.code).join("\n\n");
    const script = [
      "import runtime",
      "asyncio = runtime.asyncio",
      ...(src.imports ?? []),
      "",
      setupCode,
      "",
      `async def ${responseResult.functionName}(msg):`,
      indent(responseResult.functionBody, 4),
      "",
      "async def _consume():",
      "    while True:",
      indent(src.waitStatement, 8),
      indent(src.buildMsg, 8),
      "        msg['payload'] = 'ok'",
      `        msg = await ${responseResult.functionName}(msg)`,
      "",
      "async def _main():",
      "    asyncio.create_task(_consume())",
      `    await _http_ensure_${port}()`,
      '    print("READY", flush=True)',
      "    await asyncio.sleep(0.2)",
      // Simulates what runtime.cancel_running() does on a real redeploy:
      // run every registered cleanup, then let the (in this test,
      // simulated-fresh) module set the server up again from scratch.
      `    runtime._cleanups["http-server-${port}"]()`,
      `    global _http_started_${port}`,
      `    _http_started_${port} = False`,
      `    await _http_ensure_${port}()`,
      '    print("READY2", flush=True)',
      "    await asyncio.sleep(3600)",
      "",
      "asyncio.run(_main())",
    ].join("\n");

    const dir = mkdtempSync(join(tmpdir(), "thingstudio-httpin-redeploy-"));
    const scriptPath = join(dir, "_server.py");
    writeFileSync(scriptPath, script);
    const pymockDir = join(__dirname, "fixtures", "pymock");

    stderrChunks = [];
    proc = spawn("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: pymockDir } });
    proc.stderr.on("data", (c) => stderrChunks.push(c.toString()));

    const seen = { ready: false, ready2: false };
    const waitFor = (label: "READY" | "READY2") =>
      new Promise<void>((resolve, reject) => {
        if ((label === "READY" && seen.ready) || (label === "READY2" && seen.ready2)) {
          resolve();
          return;
        }
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
          reject(new Error(`server process exited early (code ${code}) waiting for ${label}. This is exactly the EADDRINUSE regression if it happens after READY. stderr:\n${stderrChunks.join("")}`));
        });
      });

    await waitFor("READY");
    const firstRes = await fetch(`http://127.0.0.1:${port}/`);
    expect(await firstRes.text()).toBe("ok");

    // If register_cleanup's close() didn't actually work, this second
    // _http_ensure_<port>() call raises OSError EADDRINUSE, which -- being
    // uncaught inside _main()'s own top-level task -- crashes the whole
    // process before READY2 ever prints. waitFor's own "exited early"
    // rejection is what surfaces that as a clear, attributable test
    // failure rather than a hang.
    await waitFor("READY2");
    const secondRes = await fetch(`http://127.0.0.1:${port}/`);
    expect(await secondRes.text()).toBe("ok");
  });

  it("declares the expected ports (source-only output for http_in, sink-only input for http_response)", () => {
    expect(httpInNode.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
    expect(httpInNode.ports?.inputs).toBeUndefined();
    expect(httpResponseNode.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(httpResponseNode.ports?.outputs).toBeUndefined();
  });
});

describe("thingstudio/http_in property validation and route-table rules (no server needed)", () => {
  it("rejects a path that doesn't start with /", () => {
    httpInNodes = [httpInGraphNode("a", { port: 8080, path: "bad", method: "GET" })];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(CompileError);
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(/must start with "\/"/);
  });

  it("rejects an out-of-range port", () => {
    httpInNodes = [httpInGraphNode("a", { port: 0, path: "/", method: "GET" })];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(/between 1 and 65535/);
  });

  it("rejects an unsupported method", () => {
    httpInNodes = [httpInGraphNode("a", { port: 8080, path: "/", method: "DELETE" })];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(/must be "GET" or "POST"/);
  });

  it("rejects a non-positive responseTimeoutMs", () => {
    httpInNodes = [httpInGraphNode("a", { port: 8080, path: "/", method: "GET", responseTimeoutMs: 0 })];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(/positive number/);
  });

  it("defaults method to GET and responseTimeoutMs to 10000 when not configured", () => {
    httpInNodes = [httpInGraphNode("a", { port: 8080, path: "/" })];
    const result = httpInNode.codegenEventSource!(httpInNodes[0]!, ctx);
    // 10000ms -> 10 (seconds) in the shared route-table tuple, and "GET"
    // in the route key.
    expect(result.statements?.some((s) => /,\s*10\)/.test(s.code))).toBe(true);
    expect(result.statements?.some((s) => s.code.includes('"GET"'))).toBe(true);
  });

  it("rejects two http_in nodes claiming the same (method, path) on the same port", () => {
    httpInNodes = [
      httpInGraphNode("a", { port: 8080, path: "/dup", method: "GET" }),
      httpInGraphNode("b", { port: 8080, path: "/dup", method: "GET" }),
    ];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(CompileError);
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(/both claim GET \/dup on port 8080/);
  });

  it("allows the same path on the same port when methods differ", () => {
    httpInNodes = [
      httpInGraphNode("a", { port: 8080, path: "/same", method: "GET" }),
      httpInGraphNode("b", { port: 8080, path: "/same", method: "POST" }),
    ];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).not.toThrow();
  });

  it("allows the same (method, path) on two DIFFERENT ports", () => {
    httpInNodes = [
      httpInGraphNode("a", { port: 8080, path: "/x", method: "GET" }),
      httpInGraphNode("b", { port: 8081, path: "/x", method: "GET" }),
    ];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).not.toThrow();
  });

  it("throws a CompileError when the flow has no wifi_status node", () => {
    wifiStatusNodes = [];
    httpInNodes = [httpInGraphNode("a", { port: 8080, path: "/" })];
    expect(() => httpInNode.codegenEventSource!(httpInNodes[0]!, ctx)).toThrow(/http_in needs a WiFi network/);
  });
});
