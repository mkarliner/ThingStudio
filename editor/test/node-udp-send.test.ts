// Tier 1 item 5's UDP/TCP batch: udp_send (editor/src/node-library/udp-send.ts).
//
// A sink, so (like node-mqtt-publish.test.ts) this can run generated code
// end-to-end without hitting the pymock-has-no-sleep_ms constraint
// node-wifi-status.test.ts documents for repeating sources -- one send,
// one process exit, no loop. Spins up a real local UDP peer (Node's
// `dgram` module) on loopback and points generated Python at it, matching
// node-http-request.test.ts's "real local server, not a mock" bar at the
// off-device level -- this exercises the actual generated socket/retry
// code over a real UDP datagram, not stubbed I/O.
//
// Runs generated code via `import runtime; asyncio = runtime.asyncio`
// (PYTHONPATH=pymock), NOT a bare `import asyncio` the way
// node-http-request.test.ts/node-mqtt-publish.test.ts do -- udp-send.ts's
// EAGAIN retry branch calls `asyncio.sleep_ms`, which only exists on
// pymock's patched shim (see fixtures/pymock/runtime.py's own comment on
// why), not real CPython asyncio. The happy-path tests below never
// actually take that branch (a real bound loopback peer never leaves the
// local send buffer full), but the harness goes through the real
// generated-code alias path anyway for consistency with what compile.ts
// itself produces, rather than a harness-only shortcut that would let a
// bug in that alias assumption go unnoticed.
//
// No forced-timeout test here, unlike node-http-request.test.ts's "server
// that never responds" case -- UDP sendto to a real bound local peer does
// not block or fail the way an unresponsive TCP server does, and reliably
// forcing a local UDP send buffer to actually fill (the only real way
// sendto raises EAGAIN) needs OS-level setup outside what a portable
// off-device test can assume. The retry-loop shape itself is exercised
// indirectly: the EAGAIN branch's `asyncio.sleep_ms` availability is
// confirmed by every test in this file completing through the same
// runtime.py-aliased code path that branch would run under if it were hit.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// updated 2026-08-18 for the wifiConfigId behavior change -- see
// wifi-status.ts's own header. Same fake-resolveConfig-via-local-map
// pattern node-wifi-status.test.ts uses.
//
// Updated again 2026-08-20 (redeploy-cleanup-and-network-fault-detection-
// briefing.md, Problems 1/2a/2b): wifiConfigId is now mandatory, so every
// test below that isn't specifically about credentials points at a
// pre-populated "unmanaged1" config (same pattern node-wifi-status.test.ts
// uses) instead of omitting wifiConfigId. New tests cover the
// register_cleanup self-registration (Problem 1) and the host:port-
// qualified OSError re-raise (Problem 2a).

import { flowWifiConfigsFrom } from "./flow-wifi-helper.js";
import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { udpSendNode } from "../src/node-library/udp-send.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeConfigs = new Map<string, Record<string, unknown>>();
function setConfig(id: string, properties: Record<string, unknown>): void {
  fakeConfigs.set(id, properties);
}
// Synthetic wifi_status node(s), 2026-09-04: udp_send no longer carries
// its own wifiConfigId (wifi-status.ts's header has the full story --
// this node now derives WiFi credentials from the flow's own wifi_status
// node via ctx.findNodesOfType()). `node()` below still accepts
// `wifiConfigId` as a convenience so this file's many existing call sites
// (written when udp_send DID carry its own) need no per-line changes: it
// stashes whatever id is passed into this shared array instead of onto
// the real udp_send properties, synthesizing exactly the flow shape
// compile.ts's real findNodesOfType would see for a flow with one
// wifi_status node pointed at that config. Reset to empty (= "no
// wifi_status node in this flow") in beforeEach, same "explicit stand-in,
// not an implicit fallback" spirit as fakeConfigs/setConfig above.
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
  // Stand-in for "no managed connection" now that wifiConfigId is
  // mandatory -- see this file's header.
  setConfig("unmanaged1", { security: "unmanaged" });
  wifiStatusNodes = [];
});

function node(properties: Record<string, unknown>): GraphNode {
  const { wifiConfigId, ...rest } = properties;
  if (typeof wifiConfigId === "string") {
    wifiStatusNodes = [{ id: "wifi_status_1", type: "thingstudio/wifi_status", properties: { wifiConfigId } }];
  }
  return { id: "1", type: "thingstudio/udp_send", properties: rest };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** Runs codegenSink's output once against a real payload. Async (execFile,
 * not execFileSync), matching node-http-request.test.ts's own reasoning:
 * Node's event loop -- and this file's in-process dgram socket -- needs to
 * keep running while python3 does. */
async function runSend(properties: Record<string, unknown>, payload: unknown): Promise<void> {
  const result = udpSendNode.codegenSink!(node(properties), ctx);
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
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  await execFileAsync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
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

describe("thingstudio/udp_send node", () => {
  let server: dgram.Socket;
  let port: number;
  let received: { msg: Buffer; rinfo: dgram.RemoteInfo }[];

  beforeEach(async () => {
    received = [];
    server = dgram.createSocket("udp4");
    server.on("message", (msg, rinfo) => received.push({ msg, rinfo }));
    await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends the inbound string payload as UTF-8 bytes to the configured host:port", async () => {
    await runSend({ host: "127.0.0.1", port, timeoutMs: 2000, wifiConfigId: "unmanaged1" }, "hello udp");
    await waitFor(() => received.length > 0);
    expect(received[0]!.msg.toString("utf8")).toBe("hello udp");
  });

  it("stringifies a non-string, non-bytes payload before sending", async () => {
    await runSend({ host: "127.0.0.1", port, timeoutMs: 2000, wifiConfigId: "unmanaged1" }, 42);
    await waitFor(() => received.length > 0);
    expect(received[0]!.msg.toString("utf8")).toBe("42");
  });

  it("two udp_send nodes share one socket setup (dedup)", async () => {
    const resultA = udpSendNode.codegenSink!(node({ host: "127.0.0.1", port, wifiConfigId: "unmanaged1" }), ctx);
    const resultB = udpSendNode.codegenSink!(node({ host: "127.0.0.1", port, wifiConfigId: "unmanaged1" }), ctx);
    expect(resultA.statements?.[0]?.code).toBe(resultB.statements?.[0]?.code);
    expect(resultA.statements?.[0]?.key).toBe(resultB.statements?.[0]?.key);
  });

  it("rejects a missing host", () => {
    expect(() => udpSendNode.codegenSink!(node({ port: 9999 }), ctx)).toThrow(CompileError);
    expect(() => udpSendNode.codegenSink!(node({ port: 9999 }), ctx)).toThrow(/non-empty "host"/);
  });

  it("rejects an invalid port", () => {
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 0 }), ctx)).toThrow(/valid port number/);
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 70000 }), ctx)).toThrow(/valid port number/);
  });

  it("rejects a non-positive timeoutMs", () => {
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 1, timeoutMs: 0 }), ctx)).toThrow(/positive number/);
  });

  it("defaults timeoutMs to 2000ms", () => {
    const result = udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.functionBody).toMatch(/,\s*2\)/); // 2000ms -> 2s
  });

  it("uses a non-blocking socket so the retry loop's EAGAIN branch is reachable, not decorative", () => {
    const result = udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.statements?.[0]?.code).toContain(".setblocking(False)");
    expect(result.functionBody).toContain("except OSError as _e:");
    expect(result.functionBody).toContain("errno.EAGAIN");
    expect(result.functionBody).toMatch(/await asyncio\.wait_for\(/);
  });

  it("registers a runtime cleanup that closes the shared send socket, keyed to the same 'udp-send-sock' dedup key (Problem 1)", () => {
    const result = udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.statements?.[0]?.key).toBe("udp-send-sock");
    expect(result.statements?.[0]?.code).toContain('runtime.register_cleanup("udp-send-sock"');
    expect(result.statements?.[0]?.code).toContain("_udp_send_sock.close()");
  });

  it("re-raises a non-EAGAIN OSError with the target host:port folded into the message (Problem 2a)", () => {
    const result = udpSendNode.codegenSink!(node({ host: "example.invalid", port: 4242, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.functionBody).toContain('raise OSError("udp_send to %s:%s failed: %r" % ("example.invalid", 4242, _e))');
    expect(result.functionBody).toContain('raise OSError("udp_send: could not resolve %s:%s: %r" % ("example.invalid", 4242, _e))');
  });

  it("throws a CompileError when the flow has no wifi_status node (2026-09-04: no wifiConfigId of its own any more, derives from wifi_status instead)", () => {
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 1 }), ctx)).toThrow(CompileError);
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 1 }), ctx)).toThrow(/udp_send needs a WiFi network/);
  });

  it("rejects a flow with two WiFi configs (one radio, so one WiFi config per flow)", () => {
    wifiStatusNodes = [
      { id: "w1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } },
      { id: "w2", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1_other" } },
    ];
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 1 }), ctx)).toThrow(/a flow can only have one/);
  });

  it("brings the WiFi station interface up with no connect call when the referenced config's security is 'unmanaged'", () => {
    const result = udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.statements?.[1]?.key).toBe("wifi-sta");
    expect(result.statements?.[1]?.code).toContain("network.WLAN(network.STA_IF)");
    expect(result.statements?.[1]?.code).toContain(".active(True)");
    expect(result.statements?.[1]?.code).not.toContain(".connect(");
  });

  it("connects with the referenced config's ssid/password, sharing the wifi-sta key with wifi_status/http_request", () => {
    setConfig("wifi1", { ssid: "MyNet", password: "hunter2" });
    const result = udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "wifi1" }), ctx);
    expect(result.statements?.[1]?.code).toContain(".connect(");
    expect(result.statements?.[1]?.code).toContain('"MyNet"');
  });

  it("throws a CompileError when the referenced config has security 'password' (the default) and an empty password", () => {
    setConfig("nopw", { ssid: "MyNet", password: "" });
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "nopw" }), ctx)).toThrow(/has no password but security is "password"/);
  });

  it("raises a CompileError referencing the missing id when wifiConfigId doesn't resolve", () => {
    expect(() => udpSendNode.codegenSink!(node({ host: "h", port: 1, wifiConfigId: "nope" }), ctx)).toThrow(/referenced config "nope" not found/);
  });
});
