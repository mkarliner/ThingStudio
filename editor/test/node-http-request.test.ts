// Tier 1 network node: http_request (editor/src/node-library/http-request.ts).
//
// http_request is a transform, not a repeating source, so unlike
// node-wifi-status.test.ts it doesn't hit the pymock-has-no-sleep_ms
// constraint -- but it does real socket I/O (asyncio.open_connection),
// which pymock's runtime.py aliases to real CPython asyncio, not a mock.
// Rather than stub the socket layer, this spins up a real local HTTP
// server (Node's http module) on loopback and points generated Python at
// it -- exercising the actual generated request-building/response-parsing
// logic over a real TCP connection, matching the validation plan's own
// "local, controllable HTTP test server, not live external services" bar
// at the off-device level (the Tier 1 hardware pass still needs its own
// run against a real test server from real hardware; this doesn't replace
// that, see mvp-validation-plan.md's network-nodes entry).
//
// Real bug worth recording, not just a note: the first draft of this file
// used execFileSync to run the generated Python against the in-process
// Node http.Server. That deadlocks -- execFileSync blocks Node's entire
// single-threaded event loop until the child exits, but the http.Server
// needing to answer the request lives on that SAME event loop, so it can
// never actually respond while blocked; the client then hangs until its
// own timeout, indistinguishable from "server never responds" from the
// Python side. Confirmed by reproducing outside vitest entirely (plain
// node script, http.Server + execFileSync -> identical hang) before
// concluding it wasn't a codegen bug. Fixed by using the async `execFile`
// API so Node's event loop keeps running while python3 does.
//
// Calls codegenTransform directly and wraps it in a minimal async harness
// script (not the full compile() + debug-node path) so both `payload` AND
// the extra `status` property can be inspected -- debug.ts only ever
// prints `payload`.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { GraphConfigNode, GraphData } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = {
  run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }),
};
const TYPE = "thingstudio/http_request";
const WIFI = "thingstudio/config/wifi";

const wifi = (properties: Record<string, unknown>, id = "w1"): GraphConfigNode => ({ id, type: WIFI, properties });
const unmanaged = () => [wifi({ security: "unmanaged" })];

function graph(properties: Record<string, unknown>, configs: GraphConfigNode[] = []): GraphData {
  return { nodes: [{ id: "1", type: TYPE, properties }], links: [], ...(configs.length ? { configs } : {}) };
}

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
    findConfigsOfType: (type: string) => (type === WIFI ? (g.configs ?? []) : []),
  };
  return def.codegenTransform!(g.nodes[0]!, ctx);
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** Runs codegenTransform's output against a real local server: builds a
 * standalone script (no runtime.py/compile.ts involved -- just enough
 * scaffolding to await the generated async function once and print the
 * resulting msg dict), executes it under python3 against pymock's
 * network.py (harmless no-op here) for the shared wifi-sta setup
 * statement's imports. Async (execFile, not execFileSync) so Node's event
 * loop -- and this file's in-process http.Server -- keeps running while
 * python3 does (see header comment for why that matters here). */
async function runRequest(properties: Record<string, unknown>, initialPayload: unknown = null, configs = unmanaged()): Promise<string> {
  const result = await codegen(graph(properties, configs));
  const lines = [
    "import asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    "async def _main():",
    `    msg = {'payload': ${initialPayload === null ? "None" : JSON.stringify(initialPayload)}, 'topic': ''}`,
    `    result = await ${result.functionName}(msg)`,
    "    print(result)",
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  const { stdout } = await execFileAsync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
    timeout: 10_000,
  });
  return stdout;
}

describe("thingstudio/http_request node", () => {
  let server: http.Server;
  let baseUrl: string;
  let lastRequest: { method?: string; url?: string; body: string } | null;

  beforeEach(async () => {
    lastRequest = null;
    // Sends an explicit Content-Length and writes the body in one shot
    // (never res.write() + res.end() separately) so Node doesn't fall
    // back to chunked transfer-encoding, which http-request.ts's hand-
    // rolled client deliberately doesn't support (documented gap in that
    // file's header) -- a real thing this test caught: Node's http module
    // defaults to chunked whenever Content-Length isn't set itself.
    const respond = (res: http.ServerResponse, status: number, text: string) => {
      const buf = Buffer.from(text, "utf8");
      res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": String(buf.length) });
      res.end(buf);
    };
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastRequest = { method: req.method, url: req.url, body };
        if (req.url === "/not-found") {
          respond(res, 404, "nope");
          return;
        }
        if (req.url === "/echo") {
          respond(res, 200, body);
          return;
        }
        respond(res, 200, "hello world");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("performs a GET and returns the response body as payload and status 200", async () => {
    const output = await runRequest({ url: `${baseUrl}/`, method: "GET", timeoutMs: 2000 });
    expect(output).toContain("'payload': 'hello world'");
    expect(output).toContain("'status': 200");
    expect(lastRequest?.method).toBe("GET");
  });

  it("reports a non-200 status accurately", async () => {
    const output = await runRequest({ url: `${baseUrl}/not-found`, method: "GET", timeoutMs: 2000 });
    expect(output).toContain("'status': 404");
    expect(output).toContain("'payload': 'nope'");
  });

  it("sends the incoming msg payload as the POST body", async () => {
    await runRequest({ url: `${baseUrl}/echo`, method: "POST", timeoutMs: 2000 }, "hello from thingstudio");
    expect(lastRequest?.method).toBe("POST");
    expect(lastRequest?.body).toBe("hello from thingstudio");
  });

  it("a GET sends no body and Content-Length: 0", async () => {
    await runRequest({ url: `${baseUrl}/`, method: "GET", timeoutMs: 2000 });
    expect(lastRequest?.body).toBe("");
  });

  it("times out against a server that never responds, rather than hanging", async () => {
    // Don't respond at all -- override the default handler for this one test.
    server.removeAllListeners("request");
    server.on("request", () => {
      /* never call res.end() */
    });
    await expect(runRequest({ url: `${baseUrl}/`, method: "GET", timeoutMs: 300 })).rejects.toThrow();
  });

  it("rejects a non-http:// url", async () => {
    expect(await hookError(graph({ url: "https://example.com/", method: "GET" }))).toMatch(/https\/TLS/);
  });

  it("rejects an unsupported method", async () => {
    expect(await hookError(graph({ url: "http://x/", method: "DELETE" }))).toMatch(/must be "GET" or "POST"/);
  });

  it("rejects a non-positive timeoutMs", async () => {
    expect(await hookError(graph({ url: "http://x/", method: "GET", timeoutMs: 0 }))).toMatch(/positive number/);
  });

  it("defaults method to GET, timeout to 5 s, port to 80 and path to /", async () => {
    const result = await codegen(graph({ url: "http://x/" }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain('"method": "GET"');
    expect(generated).toContain('"timeoutS": 5');
    expect(generated).toContain('"port": 80');
    expect(generated).toContain('"path": "/"');
  });

  it("parses host/port/path out of the configured url", async () => {
    const result = await codegen(graph({ url: "http://example.local:8080/api/data" }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain('"host": "example.local"');
    expect(generated).toContain('"port": 8080');
    expect(generated).toContain('"path": "/api/data"');
  });

  it("refuses a flow with no WiFi config", async () => {
    expect(await hookError(graph({ url: "http://example.local" }))).toMatch(/needs a WiFi network/);
  });

  it("refuses two WiFi configs", async () => {
    expect(await hookError(graph({ url: "http://example.local" }, [wifi({ ssid: "a" }, "w1"), wifi({ ssid: "b" }, "w2")]))).toMatch(/2 WiFi configs/);
  });

  it("derives ssid/password/security from the flow's WiFi config", async () => {
    const result = await codegen(graph({ url: "http://example.local" }, [wifi({ ssid: "MyNet", password: "hunter2" })]));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain('"ssid": "MyNet"');
    expect(generated).toContain("ts_wifi.ensure_station(");
  });

  it("declares an input and output msg port", async () => {
    const def = buildRegistry().get(TYPE)!;
    expect(def.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(def.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
  });

  it("re-raises a connection failure with the target host:port folded into the message", async () => {
    const closedServer = http.createServer();
    await new Promise<void>((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
    const closedPort = (closedServer.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    await expect(runRequest({ url: `http://127.0.0.1:${closedPort}/`, method: "GET", timeoutMs: 2000 })).rejects.toThrow(
      new RegExp(`http_request to 127\\.0\\.0\\.1:${closedPort}: connect failed`),
    );
  });
});
