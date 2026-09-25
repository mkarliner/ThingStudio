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
//
// **Fixed 2026-08-19, real failure caught on a real machine, not
// hypothetical**: runReceive originally sent after a fixed 300ms delay,
// gambling that python3's own interpreter-startup-plus-imports would
// always finish first. It doesn't reliably -- under `npm test`, several
// test files spawn python3 concurrently, and on a loaded machine that
// startup can lose the race. A datagram sent before the socket is bound
// is just dropped by the kernel (nothing is listening yet); no amount of
// retrying on the Python side recovers it, since it's already gone by the
// time the socket exists. Fix: the generated snippet now prints a `READY`
// line immediately after its setup statements (before entering the
// asyncio loop), and runReceive waits for that line on the child
// process's actual stdout before sending anything, instead of guessing a
// delay. This removes the race outright rather than picking a bigger
// guess and hoping -- CLAUDE.md's fault-handling-over-happy-path
// reasoning applied to test infrastructure, not just node codegen. This
// is a test-harness-only fix: the real on-device flow is already running
// (and its socket already bound) long before any real sender exists, so
// this race has no production analog.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// updated 2026-08-18 for the wifiConfigId behavior change -- see
// wifi-status.ts's own header. Same fake-resolveConfig-via-local-map
// pattern node-wifi-status.test.ts/node-udp-send.test.ts use.
//
// Updated again 2026-08-20 (redeploy-cleanup-and-network-fault-detection-
// briefing.md, Problems 1/2a/2b): wifiConfigId is now mandatory -- see
// node-udp-send.test.ts's own header for the same pattern applied here
// ("unmanaged1" stand-in config). New tests cover register_cleanup
// (Problem 1) and the port-qualified OSError re-raise (Problem 2a).

import { flowWifiConfigsFrom } from "./flow-wifi-helper.js";
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { udpReceiveNode } from "../src/node-library/udp-receive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeConfigs = new Map<string, Record<string, unknown>>();
function setConfig(id: string, properties: Record<string, unknown>): void {
  fakeConfigs.set(id, properties);
}
// Synthetic wifi_status node(s), 2026-09-04 -- see node-udp-send.test.ts's
// own comment on this exact mechanism (identical reasoning, this node got
// the identical treatment the same day).
let wifiStatusNodes: GraphNode[] = [];

const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}`,
  resolveConfig: (id) => {
    const cfg = fakeConfigs.get(id);
    if (!cfg) throw new CompileError(`referenced config "${id}" not found`);
    return cfg;
  },
  findNodesOfType: (type) => (type === "thingstudio/wifi_status" ? wifiStatusNodes : []),
  findConfigsOfType: (type: string) => (type === "thingstudio/config/wifi" ? flowWifiConfigsFrom(wifiStatusNodes, (id) => fakeConfigs.get(id)) : []),
};

beforeEach(() => {
  fakeConfigs.clear();
  setConfig("unmanaged1", { security: "unmanaged" });
  wifiStatusNodes = [];
});

function node(properties: Record<string, unknown>): GraphNode {
  const { wifiConfigId, ...rest } = properties;
  if (typeof wifiConfigId === "string") {
    wifiStatusNodes = [{ id: "wifi_status_1", type: "thingstudio/wifi_status", properties: { wifiConfigId } }];
  }
  return { id: "1", type: "thingstudio/udp_receive", properties: rest };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs buildMsg once per entry in `sends`, bound to the node's configured
 * `port`, against a real Node dgram client sending on loopback -- not a
 * mock. Spawns python3 with `-u` (unbuffered stdout) and waits for an
 * explicit `READY` line -- printed right after this snippet's setup
 * statements run (bind included), before entering the asyncio loop --
 * rather than a fixed delay before sending. See this file's header for why
 * a guessed delay turned out to be a genuine race, not a hypothetical one. */
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
    "print('READY', flush=True)",
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

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("python3", ["-u", scriptPath], {
      env: { ...process.env, PYTHONPATH: pymockDir },
    });
    const client = dgram.createSocket("udp4");
    let stdout = "";
    let stderr = "";
    let ready = false;
    let settled = false;

    // Backstop well above the snippet's own 3s asyncio.wait_for bound --
    // this should only ever fire on a genuine deadlock (e.g. python3
    // itself hanging before it can even print READY), not normal
    // slowness, which the READY handshake already absorbs.
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.close();
      proc.kill();
      reject(new Error(`runReceive: python3 never exited within 8s (ready=${ready})\nstdout so far:\n${stdout}\nstderr so far:\n${stderr}`));
    }, 8000);

    function sendAll(): void {
      (async () => {
        for (const buf of sends) {
          await new Promise<void>((res, rej) => {
            client.send(buf, Number(properties.port), "127.0.0.1", (err) => (err ? rej(err) : res()));
          });
          await delay(50);
        }
      })().catch((err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        client.close();
        proc.kill();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (!ready && stdout.includes("READY")) {
        ready = true;
        sendAll();
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      client.close();
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      client.close();
      if (code !== 0) {
        reject(new Error(`python3 exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
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
    const output = await runReceive({ port, wifiConfigId: "unmanaged1" }, [Buffer.from("hello udp", "utf8")]);
    expect(output).toContain("b'hello udp'");
    expect(output).toContain("'host': '127.0.0.1'");
    expect(output).toMatch(/'port': \d+/);
  });

  it("receives multiple datagrams in order, one msg per datagram", async () => {
    const port = freshPort();
    const output = await runReceive({ port, pollMs: 5, wifiConfigId: "unmanaged1" }, [Buffer.from("first"), Buffer.from("second")]);
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
    const result = udpReceiveNode.codegenSource!(node({ port: 1000, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.buildMsg).toContain("asyncio.sleep_ms(20)");
  });

  it("repeatMs is a small fixed mandatory yield, not the poll interval (see header)", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 1000, pollMs: 500, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.repeatMs).toBe(10);
    expect(result.buildMsg).toContain("asyncio.sleep_ms(500)");
  });

  it("binds a non-blocking socket on the configured port", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.statements?.[0]?.code).toContain("setblocking(False)");
    expect(result.statements?.[0]?.code).toContain("bind(('0.0.0.0', 4242))");
  });

  it("registers a runtime cleanup that closes the port's socket, keyed the same as the socket setup statement (Problem 1)", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.statements?.[0]?.key).toBe("udp-receive-4242");
    expect(result.statements?.[0]?.code).toContain('runtime.register_cleanup("udp-receive-4242"');
    expect(result.statements?.[0]?.code).toContain("_udp_recv_sock_4242.close()");
  });

  it("re-raises a non-EAGAIN OSError with the bound port folded into the message (Problem 2a)", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.buildMsg).toContain('raise OSError("udp_receive on port 4242 failed: %r" % (_e,))');
  });

  it("throws a CompileError when the flow has no wifi_status node (2026-09-04: no wifiConfigId of its own any more, derives from wifi_status instead)", () => {
    expect(() => udpReceiveNode.codegenSource!(node({ port: 4242 }), ctx)).toThrow(CompileError);
    expect(() => udpReceiveNode.codegenSource!(node({ port: 4242 }), ctx)).toThrow(/udp_receive needs a WiFi network/);
  });

  it("rejects a flow with two WiFi configs (one radio, so one WiFi config per flow)", () => {
    wifiStatusNodes = [
      { id: "w1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } },
      { id: "w2", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1_other" } },
    ];
    expect(() => udpReceiveNode.codegenSource!(node({ port: 4242 }), ctx)).toThrow(/a flow can only have one/);
  });

  it("two udp_receive nodes on the same port share one socket setup (dedup)", () => {
    const resultA = udpReceiveNode.codegenSource!(node({ port: 5000, wifiConfigId: "unmanaged1" }), ctx);
    const resultB = udpReceiveNode.codegenSource!(node({ port: 5000, wifiConfigId: "unmanaged1" }), ctx);
    expect(resultA.statements?.[0]?.key).toBe(resultB.statements?.[0]?.key);
    expect(resultA.statements?.[0]?.code).toBe(resultB.statements?.[0]?.code);
  });

  it("brings the WiFi station interface up with no connect call when the referenced config's security is 'unmanaged'", () => {
    const result = udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.statements?.[1]?.key).toBe("wifi-sta");
    expect(result.statements?.[1]?.code).toContain("network.WLAN(network.STA_IF)");
    expect(result.statements?.[1]?.code).not.toContain(".connect(");
  });

  it("connects with the referenced config's ssid/password, sharing the wifi-sta key with wifi_status/http_request/udp_send", () => {
    setConfig("wifi1", { ssid: "MyNet", password: "hunter2" });
    const result = udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "wifi1" }), ctx);
    expect(result.statements?.[1]?.code).toContain(".connect(");
    expect(result.statements?.[1]?.code).toContain('"MyNet"');
  });

  it("throws a CompileError when the referenced config has security 'password' (the default) and an empty password", () => {
    setConfig("nopw", { ssid: "MyNet", password: "" });
    expect(() => udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "nopw" }), ctx)).toThrow(/has no password but security is "password"/);
  });

  it("raises a CompileError referencing the missing id when wifiConfigId doesn't resolve", () => {
    expect(() => udpReceiveNode.codegenSource!(node({ port: 4242, wifiConfigId: "nope" }), ctx)).toThrow(/referenced config "nope" not found/);
  });

  it("compiles into a full flow with the expected structure (source text only)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
        // 2026-09-04: udp_receive no longer has its own wifiConfigId --
        // this wifi_status node is the flow's sole source of WiFi
        // credentials now (wifi-status.ts's header).
        { id: "3", type: "thingstudio/wifi_status", properties: { pollMs: 5000, wifiConfigId: "unmanaged1" } },
      ],
      links: [[1, "1", 0, "2", 0, "bytes"]],
      configs: [{ id: "unmanaged1", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } }],
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

  it("derives its WiFi credentials from the flow's one wifi_status node -- no wifiConfigId of its own any more (2026-09-04 fix)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
        { id: "3", type: "thingstudio/wifi_status", properties: { pollMs: 5000, wifiConfigId: "wifi1" } },
      ],
      links: [[1, "1", 0, "2", 0, "bytes"]],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "SharedNet", password: "sharedpw" } }],
    };
    const { source } = compile(graph, buildRegistry());
    // Exactly one wifi-sta setup statement -- udp_receive has no config
    // reference of its own to disagree with wifi_status's any more, so
    // there's only ever one credential source to dedup onto in the first
    // place (this file's own header, the bug this replaced).
    expect(source.match(/_wifi_sta = network\.WLAN/g)?.length).toBe(1);
    expect(source).toContain('"SharedNet"');
  });

  it("rejects a flow with no wifi_status node at all", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bytes"]],
      configs: [],
    };
    expect(() => compile(graph, buildRegistry())).toThrow(/udp_receive needs a WiFi network/);
  });

  it("rejects a flow with two WiFi configs (one radio, so one WiFi config per flow)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
        { id: "3", type: "thingstudio/wifi_status", properties: { pollMs: 5000, wifiConfigId: "wifi1" } },
        { id: "4", type: "thingstudio/wifi_status", properties: { pollMs: 5000, wifiConfigId: "wifi1_other" } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bytes"],
      ],
      configs: [
        { id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "SharedNet", password: "sharedpw" } },
        { id: "wifi1_other", type: "thingstudio/config/wifi", properties: { ssid: "OtherNet", password: "otherpw" } },
      ],
    };
    expect(() => compile(graph, buildRegistry())).toThrow(/a flow can only have one/);
  });

  it("compiles with no wifi_status node: the flow's one WiFi config is enough (2026-09-25 singleton)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bytes"]],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "SharedNet", password: "sharedpw" } }],
    };
    expect(compile(graph, buildRegistry()).source).toContain('"SharedNet"');
  });

  it("allows two wifi_status nodes -- they share the flow's one WiFi config", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/udp_receive", properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
        { id: "3", type: "thingstudio/wifi_status", properties: { pollMs: 5000, wifiConfigId: "wifi1" } },
        { id: "4", type: "thingstudio/wifi_status", properties: { pollMs: 5000 } },
      ],
      links: [[1, "1", 0, "2", 0, "bytes"]],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "SharedNet", password: "sharedpw" } }],
    };
    expect(() => compile(graph, buildRegistry())).not.toThrow();
  });
});
