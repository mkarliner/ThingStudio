// Tier 1 item 5's UDP/TCP batch: udp_receive (editor/src/node-library/udp-receive.ts).
//
// A repeating source, so in principle this hits the same
// pymock-has-no-sleep_ms constraint node-wifi-status.test.ts's/
// node-mqtt-subscribe.test.ts's headers document -- except udp-receive.ts
// is the first node whose OWN buildMsg (not just compile.ts's outer
// per-iteration wrapper) calls asyncio.sleep_ms as real, load-bearing
// logic (the EAGAIN retry loop -- see that file's header). Rather than
// work around that the way the two existing repeating-source tests do
// (never actually executing the sleep_ms-containing path), this session
// closed the gap in fixtures/pymock/runtime.py itself (a real, guarded
// `sleep_ms` on top of real asyncio.sleep) -- see that file's own comment
// -- specifically so this node's actual poll/retry behavior could be
// proven against a real local UDP peer (Node's `dgram` module), not just
// asserted on generated-source text the way node-wifi-status.test.ts's
// structural test has to settle for.
//
// buildMsg is run directly (not through compile()/runtime.spawn()), one
// call per expected datagram, each wrapped in `asyncio.wait_for(..., 3)`
// as a safety bound so a real bug (buildMsg never returning) fails the
// test with a clear TimeoutError instead of hanging the suite -- not part
// of the node's own generated code, just this harness's own guard rail.

import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { udpReceiveNode } from "../src/node-library/udp-receive.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx: CodegenContext = { uniqueName: (hint) => `_${hint}` };

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/udp_receive", properties };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs buildMsg once per entry in `sends`, bound to the node's configured
 * `port`, against a real Node dgram client sending on loopback -- not a
 * mock. Starts the Python process, gives it a moment to bind before
 * sending (real, if small, warm-up race -- a datagram sent before the
 * socket is bound would just be dropped, same as it would on-device), then
 * sends each buffer in turn. */
async function runReceive(properties: Record<string, unknown>, sends: Buffer[]): Promise<string> {
  const result = udpReceiveNode.codegenSource!(node(properties), ctx);
  const loopLines: string[] = [];
  for (let i = 0; i < sends.length; i++) {
    loopLines.push(...result.buildMsg.split("\n"));
    loopLines.push("print('RECEIVED', msg)");
  }
  const lines = [
    "import runtime",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    "async def _run():",
    ...loopLines.map((l) => `    ${l}`),
    "",
    "asyncio.run(asyncio.wait_for(_run(), 3))",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  const runPromise = execFileAsync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
    timeout: 10_000,
  });

  await delay(300); // let Python bind before anything is sent at it
  const client = dgram.createSocket("udp4");
  for (const buf of sends) {
    await new Promise<void>((resolve, reject) => {
      client.send(buf, Number(properties.port), "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    await delay(50);
  }
  try {
    const { stdout } = await runPromise;
    return stdout;
  } finally {
    client.close();
  }
}

// High, randomized-per-run port range -- avoids colliding with a lingering
// listener from a previous failed run on the same fixed port, without
// needing a Node-side bind-then-release dance (which would just move the
// same small race from "Node sends before Python binds" to "something else
// grabs the port between Node's release and Python's bind").
function freshPort(): number {
  return 41000 + Math.floor(Math.random() * 9000);
}

describe("thingstudio/udp_receive node", () => {
  it("receives a datagram as bytes payload with the sender's host/port", async () => {
    const port = freshPort();
    const output = await runReceive({ port }, [Buffer.from("hello udp", "utf8")]);
    expect(output).toContain("b'hello udp'");
    expect(output).toContain("'host': '127.0.0.1'");
    expect(output).toMatch(/'port': \d+/);
  });

  it("receives multiple datagrams in order, one msg per datagram", async () => {
    const port = freshPort();
    const output = await runReceive({ port, pollMs: 5 }, [Buffer.from("first"), Buffer.from("second")]);
    const firstIdx = output.indexOf("b'first'");
    const secondIdx = output.indexOf("b'second'");
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it("rejects an invalid port", () => {
    expect(() => udpReceiveNode.codegenSource!(node({ port: 0 }), ctx)).toThrow(CompileError);
    expect(() => udpReceiveNode.codegenSource!(node({ port: 70000 }), ctx)).toThrow(/valid port number/);
  });

  it("rejects a non-positive pollMs", () => {
    expect(() => udpReceiveNode.codegenSource!(node({ port: 1000, pollMs: 0 }), ctx)).toThrow(/positive number/);
  });

  it("defaults pollMs to 20ms", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 1000 }), ctx);
    expect(result.buildMsg).toContain("asyncio.sleep_ms(20)");
  });

  it("repeatMs is a small fixed mandatory yield, not the poll interval (see header)", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 1000, pollMs: 500 }), ctx);
    expect(result.repeatMs).toBe(10);
    expect(result.buildMsg).toContain("asyncio.sleep_ms(500)");
  });

  it("binds a non-blocking socket on the configured port", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242 }), ctx);
    expect(result.statements?.[0]?.code).toContain("setblocking(False)");
    expect(result.statements?.[0]?.code).toContain("bind(('0.0.0.0', 4242))");
  });

  it("two udp_receive nodes on the same port share one socket setup (dedup)", () => {
    const resultA = udpReceiveNode.codegenSource!(node({ port: 5000 }), ctx);
    const resultB = udpReceiveNode.codegenSource!(node({ port: 5000 }), ctx);
    expect(resultA.statements?.[0]?.key).toBe(resultB.statements?.[0]?.key);
    expect(resultA.statements?.[0]?.code).toBe(resultB.statements?.[0]?.code);
  });

  it("brings the WiFi station interface up even with no ssid configured", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242 }), ctx);
    expect(result.statements?.[1]?.key).toBe("wifi-sta");
    expect(result.statements?.[1]?.code).toContain("network.WLAN(network.STA_IF)");
    expect(result.statements?.[1]?.code).not.toContain(".connect(");
  });

  it("connects with the configured ssid/password, sharing the wifi-sta key with wifi_status/http_request/udp_send", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242, ssid: "MyNet", password: "hunter2" }), ctx);
    expect(result.statements?.[1]?.code).toContain(".connect(");
    expect(result.statements?.[1]?.code).toContain('"MyNet"');
  });

  it("compiles into a full flow with the expected structure (source text only)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bytes"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("socket.socket(socket.AF_INET, socket.SOCK_DGRAM)");
    expect(source).toContain("recvfrom(1472)");
    expect(source).toContain("while True:");
    expect(source).toMatch(/runtime\.spawn\(/);
    // Mandatory post-message yield (repeatMs=10), distinct from the
    // internal pollMs-driven sleep_ms inside buildMsg's own retry loop.
    expect(source).toMatch(/await asyncio\.sleep_ms\(10\)\s*$/m);
  });
});
