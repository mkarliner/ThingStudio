// Tier 1 network node: wifi_status (editor/src/node-library/wifi-status.ts).
//
// Always-repeating source (repeatMs > 0), same constraint node-gpio-in.test.ts's
// header documents -- pymock's runtime.py aliases real CPython asyncio,
// which has no sleep_ms, so a repeating flow can't run end-to-end through
// runGenerated. Uses the same two-pattern split: codegenSource called
// directly for "does it read status correctly" (against pymock's network
// module), source-text assertions for "does it compile into a sane flow."

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { wifiStatusNode } from "../src/node-library/wifi-status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx: CodegenContext = { uniqueName: (hint) => `_${hint}` };

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
    const output = runSnippet("network.WLAN.CONNECTED = False", { pollMs: 1000 });
    expect(output).toContain("'payload': False");
    expect(output).toContain("'ip': ''");
  });

  it("reports payload True and the real ifconfig IP when connected", () => {
    const output = runSnippet(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      { pollMs: 1000 },
    );
    expect(output).toContain("'payload': True");
    expect(output).toContain("'ip': '192.168.1.42'");
  });

  it("defaults to False if nothing has driven the connection state", () => {
    const output = runSnippet("", { pollMs: 1000 });
    expect(output).toContain("'payload': False");
  });

  it("does not call connect() when no ssid is configured", () => {
    const output = runSnippet("", { pollMs: 1000 });
    expect(output).not.toContain("WLAN_CONNECT");
  });

  it("calls connect() with the configured ssid/password when ssid is set", () => {
    const output = runSnippet("", { pollMs: 1000, ssid: "MyNetwork", password: "hunter2" });
    expect(output).toContain("WLAN_CONNECT STA_IF MyNetwork");
  });

  it("sets repeatMs from the configured pollMs", () => {
    const result = wifiStatusNode.codegenSource!(node({ pollMs: 2000 }), ctx);
    expect(result.repeatMs).toBe(2000);
  });

  it("defaults pollMs to 5000ms when not configured", () => {
    const result = wifiStatusNode.codegenSource!(node({}), ctx);
    expect(result.repeatMs).toBe(5000);
  });

  it("rejects a non-positive pollMs", () => {
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: 0 }), ctx)).toThrow(CompileError);
    expect(() => wifiStatusNode.codegenSource!(node({ pollMs: -5 }), ctx)).toThrow(/positive number/);
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/wifi_status", properties: { pollMs: 3000, ssid: "MyNetwork", password: "hunter2" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_wifi_sta = network.WLAN(network.STA_IF)");
    expect(source).toContain("_wifi_sta.active(True)");
    expect(source).toContain("while True:");
    expect(source).toContain("asyncio.sleep_ms(3000)");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("dedups the shared wifi-sta setup statement across two wifi_status nodes (first one wins)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/wifi_status", properties: { pollMs: 1000, ssid: "First", password: "a" } },
        { id: 2, type: "thingstudio/wifi_status", properties: { pollMs: 2000, ssid: "Second", password: "b" } },
      ],
      links: [],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/_wifi_sta = network\.WLAN/g)?.length).toBe(1);
    // pyStringLiteral uses JSON.stringify -- double-quoted output.
    expect(source).toContain('"First"');
    expect(source).not.toContain('"Second"');
  });
});
