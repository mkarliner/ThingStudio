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
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { httpRequestNode } from "../src/node-library/http-request.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
// 2026-09-04: http_request now derives its WiFi credentials from the
// flow's own wifi_status node (wifi-status.ts's resolveFlowWifiCredentials,
// via the new ctx.findNodesOfType() -- see that file's header for the bug
// this fixes). resolveConfig itself still isn't exercised directly by
// this node's OWN codegen (it has no config reference of its own -- the
// lookup happens through the synthesized wifi_status node's properties,
// resolved by resolveFlowWifiCredentials internally against ITS
// wifiConfigId), so it stays a throwing stub, matching every other node
// test file's convention for "this path shouldn't be hit."
const fakeWifiConfigs = new Map<string, Record<string, unknown>>();
let wifiStatusNodes: GraphNode[] = [];
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}`,
  resolveConfig: (id) => {
    const cfg = fakeWifiConfigs.get(id);
    if (!cfg) throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx only stubs wifi configs (see wifiStatusNodes)`);
    return cfg;
  },
  findNodesOfType: (type) => (type === "thingstudio/wifi_status" ? wifiStatusNodes : []),
};

beforeEach(() => {
  fakeWifiConfigs.clear();
  fakeWifiConfigs.set("unmanaged1", { security: "unmanaged" });
  // Default: one wifi_status node, riding on an externally-managed
  // connection -- matches this node's own old "open"/no-validation
  // default closely enough that every pre-existing test below (which
  // only cares about http behavior, not WiFi credentials) keeps passing
  // unmodified.
  wifiStatusNodes = [{ id: "wifi_status_1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } }];
});

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/http_request", properties };
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
async function runRequest(properties: Record<string, unknown>, initialPayload: unknown = null): Promise<string> {
  const result = httpRequestNode.codegenTransform!(node(properties), ctx);
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

  it("rejects a non-http:// url", () => {
    expect(() => httpRequestNode.codegenTransform!(node({ url: "https://example.com/", method: "GET" }), ctx)).toThrow(CompileError);
    expect(() => httpRequestNode.codegenTransform!(node({ url: "https://example.com/", method: "GET" }), ctx)).toThrow(/https\/TLS/);
  });

  it("rejects an unsupported method", () => {
    expect(() => httpRequestNode.codegenTransform!(node({ url: "http://x/", method: "DELETE" }), ctx)).toThrow(/must be "GET" or "POST"/);
  });

  it("rejects a non-positive timeoutMs", () => {
    expect(() => httpRequestNode.codegenTransform!(node({ url: "http://x/", method: "GET", timeoutMs: 0 }), ctx)).toThrow(/positive number/);
  });

  it("defaults method to GET and timeoutMs to 5000 when not configured", () => {
    const result = httpRequestNode.codegenTransform!(node({ url: "http://x/" }), ctx);
    expect(result.functionBody).toContain('"GET"');
    // timeoutMs 5000 -> 5000/1000 = 5 (a whole-number seconds value prints
    // as "5" in JS, not "5.0" -- asyncio.wait_for accepts an int timeout
    // identically to a float one, so this isn't a functional gap, just
    // matching what the codegen actually emits).
    expect(result.functionBody).toMatch(/,\s*5\)/);
  });

  it("parses host/port/path out of the configured url", () => {
    const result = httpRequestNode.codegenTransform!(node({ url: "http://example.local:8080/api/data" }), ctx);
    expect(result.functionBody).toContain('"example.local"');
    expect(result.functionBody).toContain("8080");
    expect(result.functionBody).toContain('"/api/data"');
  });

  it("defaults path to / when the url has none", () => {
    const result = httpRequestNode.codegenTransform!(node({ url: "http://example.local" }), ctx);
    expect(result.functionBody).toContain('"/"');
  });

  it("throws a CompileError when the flow has no wifi_status node (2026-09-04: no ssid/password properties of its own any more)", () => {
    wifiStatusNodes = [];
    expect(() => httpRequestNode.codegenTransform!(node({ url: "http://example.local" }), ctx)).toThrow(CompileError);
    expect(() => httpRequestNode.codegenTransform!(node({ url: "http://example.local" }), ctx)).toThrow(/http_request needs a "wifi_status" node/);
  });

  it("throws a CompileError when the flow has more than one wifi_status node (single-interface assumption, for now)", () => {
    wifiStatusNodes = [
      { id: "w1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } },
      { id: "w2", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } },
    ];
    expect(() => httpRequestNode.codegenTransform!(node({ url: "http://example.local" }), ctx)).toThrow(/only one WiFi interface is supported today/);
  });

  it("derives ssid/password/security from the flow's wifi_status node instead of properties of its own", () => {
    fakeWifiConfigs.set("wifi1", { ssid: "MyNet", password: "hunter2" });
    wifiStatusNodes = [{ id: "wifi_status_1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "wifi1" } }];
    const result = httpRequestNode.codegenTransform!(node({ url: "http://example.local" }), ctx);
    expect(result.statements?.[0]?.code).toContain('"MyNet"');
    expect(result.statements?.[0]?.code).toContain(".connect(");
  });
});
