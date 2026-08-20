// Tier 1 network node: wifi_status (editor/src/node-library/wifi-status.ts).
//
// Always-repeating source (repeatMs > 0), same constraint node-gpio-in.test.ts's
// header documents -- pymock's runtime.py aliases real CPython asyncio,
// which has no sleep_ms, so a repeating flow can't run end-to-end through
// runGenerated. Uses the same two-pattern split: codegenSource called
// directly for "does it read status correctly" (against pymock's network
// module), source-text assertions for "does it compile into a sane flow."
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// updated 2026-08-18 for the wifiConfigId behavior change -- see
// wifi-status.ts's own header. `ctx` here is a small fake CodegenContext
// whose `resolveConfig` reads from a local, per-test-populated map (via
// `setConfig`), standing in for compile.ts's real configsById the same
// way every other node test file's `ctx.uniqueName` stub already stands
// in for compile.ts's real name-uniquing.
//
// Updated again 2026-08-20 (redeploy-cleanup-and-network-fault-detection-
// briefing.md, Problem 2b Option B): `wifiConfigId` is now mandatory, so
// every test below that only cares about the reported connection state
// (not about credentials) now points at a pre-populated "unmanaged1"
// config (`security: "unmanaged"`) instead of omitting `wifiConfigId`
// entirely the way it used to -- that's the explicit, labeled replacement
// for what an omitted `wifiConfigId` used to mean implicitly. The old
// "does not call connect() when no wifiConfigId is set" tests are gone;
// omitting it is a CompileError now, covered by the new tests near the
// bottom of this describe block instead.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { wifiStatusNode } from "../src/node-library/wifi-status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeConfigs = new Map<string, Record<string, unknown>>();
function setConfig(id: string, properties: Record<string, unknown>): void {
  fakeConfigs.set(id, properties);
}
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}`,
  resolveConfig: (id) => {
    const cfg = fakeConfigs.get(id);
    if (!cfg) throw new CompileError(`referenced config "${id}" not found`);
    return cfg;
  },
};

beforeEach(() => {
  fakeConfigs.clear();
  // Stand-in for "no managed connection" now that wifiConfigId is
  // mandatory -- see this file's header.
  setConfig("unmanaged1", { security: "unmanaged" });
});

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/wifi_status", properties };
}

function runSnippet(preamble: string, properties: Record<string, unknown>): string {
  const result = wifiStatusNode.codegenSource!(node(properties), ctx);
  const lines = [...(result.imports ?? []), preamble, ...(result.statements ?? []).map((s) => s.code), result.buildMsg, "print(msg)"];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

describe("thingstudio/wifi_status node", () => {
  it("reports payload False and ip '' when not connected", () => {
    const output = runSnippet("network.WLAN.CONNECTED = False", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    expect(output).toContain("'payload': False");
    expect(output).toContain("'ip': ''");
  });

  it("reports payload True and the real ifconfig IP when connected", () => {
    const output = runSnippet(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(output).toContain("'payload': True");
    expect(output).toContain("'ip': '192.168.1.42'");
  });

  it("defaults to False if nothing has driven the connection state", () => {
    const output = runSnippet("", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    expect(output).toContain("'payload': False");
  });

  it("does not call connect() when the referenced config's security is 'unmanaged'", () => {
    const output = runSnippet("", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    expect(output).not.toContain("WLAN_CONNECT");
  });

  it("throws a CompileError when wifiConfigId is not set (Problem 2b Option B: mandatory as of 2026-08-20)", () => {
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000 }), ctx)).toThrow(CompileError);
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000 }), ctx)).toThrow(/wifi_status requires a WiFi config/);
  });

  it("throws a CompileError when wifiConfigId is an empty string", () => {
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "" }), ctx)).toThrow(/wifi_status requires a WiFi config/);
  });

  it("throws a CompileError when the referenced config has security 'password' (the default) and an empty password", () => {
    setConfig("nopw", { ssid: "MyNetwork", password: "" });
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "nopw" }), ctx)).toThrow(CompileError);
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "nopw" }), ctx)).toThrow(/has no password but security is "password"/);
  });

  it("connects with an empty password when the referenced config's security is 'open'", () => {
    setConfig("openNet", { ssid: "GuestNet", password: "", security: "open" });
    const output = runSnippet("", { pollMs: 1000, wifiConfigId: "openNet" });
    expect(output).toContain("WLAN_CONNECT STA_IF GuestNet");
  });

  it("calls connect() with the referenced config's ssid/password when wifiConfigId is set", () => {
    setConfig("wifi1", { ssid: "MyNetwork", password: "hunter2" });
    const output = runSnippet("", { pollMs: 1000, wifiConfigId: "wifi1" });
    expect(output).toContain("WLAN_CONNECT STA_IF MyNetwork");
  });

  it("raises a CompileError referencing the missing id when wifiConfigId doesn't resolve", () => {
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "does-not-exist" }), ctx)).toThrow(CompileError);
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "does-not-exist" }), ctx)).toThrow(/referenced config "does-not-exist" not found/);
  });

  it("sets repeatMs from the configured pollMs", () => {
    const result = wifiStatusNode.codegenSource!(node({ pollMs: 2000, wifiConfigId: "unmanaged1" }), ctx);
    expect(result.repeatMs).toBe(2000);
  });

  it("defaults pollMs to 5000ms when not configured", () => {
    const result = wifiStatusNode.codegenSource!(node({ wifiConfigId: "unmanaged1" }), ctx);
    expect(result.repeatMs).toBe(5000);
  });

  it("rejects a non-positive pollMs", () => {
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 0 }), ctx)).toThrow(CompileError);
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: -5 }), ctx)).toThrow(/positive number/);
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/wifi_status", properties: { pollMs: 3000, wifiConfigId: "wifi1" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "MyNetwork", password: "hunter2" } }],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_wifi_sta = network.WLAN(network.STA_IF)");
    expect(source).toContain("_wifi_sta.active(True)");
    expect(source).toContain("while True:");
    expect(source).toContain("asyncio.sleep_ms(3000)");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("dedups the shared wifi-sta setup statement across two wifi_status nodes sharing one config (first one wins)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/wifi_status", properties: { pollMs: 1000, wifiConfigId: "wifi1" } },
        { id: 2, type: "thingstudio/wifi_status", properties: { pollMs: 2000, wifiConfigId: "wifi1" } },
      ],
      links: [],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "First", password: "a" } }],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/_wifi_sta = network\.WLAN/g)?.length).toBe(1);
    // pyStringLiteral uses JSON.stringify -- double-quoted output.
    expect(source).toContain('"First"');
  });

  it("compiling a flow with a dangling wifiConfigId raises a CompileError naming the missing config", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "thingstudio/wifi_status", properties: { pollMs: 1000, wifiConfigId: "no-such-config" } }],
      links: [],
    };
    expect(() => compile(graph, buildRegistry())).toThrow(/referenced config "no-such-config" not found/);
  });
});
