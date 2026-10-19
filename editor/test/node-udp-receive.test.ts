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

import { spawn } from "node:child_process";
import dgram from "node:dgram";
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
const runner = {
  run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }),
};
const TYPE = "thingstudio/udp_receive";
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
    findConfigsOfType: (type: string) => (g.configs ?? []).filter((c) => c.type === type),
  };
  return def.codegenSource!(g.nodes[0]!, ctx);
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
async function runReceive(properties: Record<string, unknown>, sends: Buffer[], configs = unmanaged()): Promise<string> {
  const result = await codegen(graph(properties, configs));
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

  it("rejects an invalid port", async () => {
    expect(await hookError(graph({ port: 0 }))).toMatch(/valid port number/);
    expect(await hookError(graph({ port: 70000 }))).toMatch(/valid port number/);
  });

  it("rejects a non-positive pollMs", async () => {
    expect(await hookError(graph({ port: 1000, pollMs: 0 }))).toMatch(/pollMs must be a positive number/);
  });

  it("defaults the internal retry poll to 20ms and keeps the loop yield at 10ms", async () => {
    const result = await codegen(graph({ port: 1000 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("sleep_ms(_poll)");
    expect(generated).toContain("properties.get('pollMs', 20)");
    expect(result.repeatMs).toBe(10);
  });

  it("uses pollMs for the EAGAIN retry but not for the loop interval", async () => {
    const result = await codegen(graph({ port: 1000, pollMs: 500 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("properties.get('pollMs', 20)");
    expect(result.repeatMs).toBe(10);
  });

  it("binds a non-blocking socket on the configured port through runtime.shared", async () => {
    const result = await codegen(graph({ port: 4242 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("setblocking(False)");
    expect(generated).toContain("bind(('0.0.0.0', _port))");
    expect(generated).toContain("runtime.shared('udp_receive_sock'");
  });

  it("registers a cleanup that closes the port's socket", async () => {
    const result = await codegen(graph({ port: 4242 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("'udp-receive-%d' % _port");
    expect(generated).toContain("_sock.close()");
  });

  it("folds the bound port into a non-EAGAIN error", async () => {
    const result = await codegen(graph({ port: 4242 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("udp_receive on port %d failed");
  });

  it("refuses a flow with no WiFi config", async () => {
    expect(await hookError(graph({ port: 4242 }))).toMatch(/needs a WiFi network/);
  });

  it("refuses two WiFi configs", async () => {
    expect(await hookError(graph({ port: 4242 }, [wifi({ ssid: "a" }, "w1"), wifi({ ssid: "b" }, "w2")]))).toMatch(/2 WiFi configs/);
  });

  it("two nodes on the same port share the socket at runtime", async () => {
    const a = await codegen(graph({ port: 5000 }, unmanaged()));
    const b = await codegen(graph({ port: 5000 }, unmanaged()));
    for (const r of [a, b]) {
      const generated = (r.statements ?? []).map((s) => s.code).join("\n");
      expect(generated).toContain("runtime.shared('udp_receive_sock'");
      expect(generated).toContain("('udp', _port)");
    }
  });

  it("brings the link up with no connect for unmanaged", async () => {
    const result = await codegen(graph({ port: 4242 }, unmanaged()));
    const generated = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(generated).toContain("ts_wifi.ensure_station(");
    expect(generated).toContain('"unmanaged"');
  });

  it("passes the config's credentials and the mqtt deferral to ts_wifi", async () => {
    const g: GraphData = {
      nodes: [
        { id: "1", type: TYPE, properties: { port: 4242 } },
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
    expect(generated).toContain('"deferToMqtt": True');
  });

  it("refuses a password network with no password", async () => {
    expect(await hookError(graph({ port: 4242 }, [wifi({ ssid: "MyNet", password: "" })]))).toMatch(/has no password/);
  });

  it("compiles into a full flow: 10ms yield, the port's socket and the shared WiFi call", async () => {
    const g: GraphData = {
      nodes: [
        { id: "1", type: TYPE, properties: { port: 4242 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
        { id: "3", type: "thingstudio/wifi_status", properties: { pollMs: 5000 } },
      ],
      links: [[1, "1", 0, "2", 0, "bytes"]],
      configs: unmanaged(),
    };
    const { source } = await compileWithHooks(g, buildRegistry());
    expect(source).toContain("asyncio.sleep_ms(10)");
    expect(source).toContain("bind(('0.0.0.0', _port))");
    expect(source.match(/ts_wifi\.ensure_station\(/g)?.length).toBe(2); // udp_receive + wifi_status package
    expect(source).toMatch(/runtime\.spawn\(/);
  });
});
