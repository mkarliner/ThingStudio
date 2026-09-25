// The pass-or-drop half of mvp-feature-priorities.md's 2026-08-14
// "connection-state gate/router nodes" item (outstanding-items/
// connection-state-gate-router-nodes.md), built 2026-09-14, WiFi link
// state only (Mike's explicit scope call -- see wifi-gate.ts's own
// header). A transform, so this runs generated code end-to-end the same
// way node-delay.test.ts's `runGate` does (real `asyncio.run`,
// PYTHONPATH=pymock), plus network.py's test-controlled `WLAN.CONNECTED`
// (its own header) to simulate link-up/link-down before calling the
// generated function -- not just source-string assertions that the
// generated code merely mentions `isconnected()`.
//
// wifi_status-node-synthesis and CompileError coverage below follows
// node-udp-send.test.ts's own pattern exactly (same "no wifi_status
// node"/"more than one wifi_status node" cases, same fake ctx shape) --
// wifi_gate derives its WiFi config the same way udp_send/udp_receive/
// http_request/mqtt_publish/mqtt_subscribe all do (wifi-status.ts's
// resolveFlowWifiCredentials()), with no wifiConfigId of its own.

import { flowWifiConfigsFrom } from "./flow-wifi-helper.js";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { wifiGateNode } from "../src/node-library/wifi-gate.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeConfigs = new Map<string, Record<string, unknown>>();
function setConfig(id: string, properties: Record<string, unknown>): void {
  fakeConfigs.set(id, properties);
}

// Same synthetic-wifi_status-node convenience node-udp-send.test.ts's own
// `node()` uses: a `wifiConfigId` passed here stashes a synthetic
// wifi_status GraphNode into this array instead of onto wifi_gate's own
// properties (wifi_gate has none), matching what compile.ts's real
// findNodesOfType would see for a flow with one wifi_status node pointed
// at that config.
let wifiStatusNodes: GraphNode[] = [];

const ctx: CodegenContext = {
  uniqueName: (() => {
    const used = new Set<string>();
    return (hint: string) => {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    };
  })(),
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

function node(wifiConfigId?: string): GraphNode {
  if (typeof wifiConfigId === "string") {
    wifiStatusNodes = [{ id: "wifi_status_1", type: "thingstudio/wifi_status", properties: { wifiConfigId } }];
  }
  return { id: "1", type: "thingstudio/wifi_gate", properties: {} };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** Runs codegenTransform's output once against a real msg dict, with
 * network.WLAN.CONNECTED set beforehand to simulate the link state --
 * same `asyncio.run` + pymock-runtime-alias harness node-delay.test.ts's
 * `runDelay` uses, plus the CONNECTED toggle network.py's own header
 * documents. Prints `null` (not a dict) when the generated function
 * dropped the message, so the test can tell "dropped" apart from "passed
 * through with a null payload" (which this node never produces, but the
 * harness stays honest about the distinction either way). */
async function runGate(wifiConfigId: string, connected: boolean, payload: unknown): Promise<{ payload: unknown; topic: unknown } | null> {
  const result = wifiGateNode.codegenTransform!(node(wifiConfigId), ctx);
  const lines = [
    "import runtime",
    "import json",
    "import network",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []).filter((i) => i !== "import network"),
    ...(result.statements ?? []).map((s) => s.code),
    `network.WLAN.CONNECTED = ${connected ? "True" : "False"}`,
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    "async def _main():",
    `    msg = {'payload': ${JSON.stringify(payload)}, 'topic': 'in'}`,
    `    msg = await ${result.functionName}(msg)`,
    // network.py's WLAN methods print their own debug lines (WLAN_INIT/
    // WLAN_ACTIVE/WLAN_CONNECT -- see that fixture's header) to the same
    // stdout this harness reads, same as node-wifi-status.test.ts's own
    // tests see -- a "RESULT:" prefix on the one line this harness
    // actually cares about lets it find that line regardless of what
    // else the setup statement's WLAN() construction happens to print.
    "    print('RESULT:' + json.dumps(None if msg is None else {'payload': msg['payload'], 'topic': msg['topic']}))",
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
  const resultLine = stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!resultLine) throw new Error(`runGate: no RESULT: line in stdout -- got:\n${stdout}`);
  return JSON.parse(resultLine.slice("RESULT:".length));
}

describe("thingstudio/wifi_gate node", () => {
  it("passes the msg through unchanged when the WiFi station is connected", async () => {
    const out = await runGate("unmanaged1", true, "hello gate");
    expect(out).not.toBeNull();
    expect(out?.payload).toBe("hello gate");
    expect(out?.topic).toBe("in");
  });

  it("drops the msg (returns None) when the WiFi station is not connected", async () => {
    const out = await runGate("unmanaged1", false, "hello gate");
    expect(out).toBeNull();
  });

  it("throws a CompileError when the flow has no wifi_status node", () => {
    expect(() => wifiGateNode.codegenTransform!(node(), ctx)).toThrow(CompileError);
    expect(() => wifiGateNode.codegenTransform!(node(), ctx)).toThrow(/wifi_gate needs a WiFi network/);
  });

  it("rejects a flow with two WiFi configs (one radio, so one WiFi config per flow)", () => {
    wifiStatusNodes = [
      { id: "w1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1" } },
      { id: "w2", type: "thingstudio/wifi_status", properties: { wifiConfigId: "unmanaged1_other" } },
    ];
    expect(() => wifiGateNode.codegenTransform!(node(), ctx)).toThrow(/a flow can only have one/);
  });

  it("brings the WiFi station interface up with no connect call when the referenced config's security is 'unmanaged'", () => {
    const result = wifiGateNode.codegenTransform!(node("unmanaged1"), ctx);
    expect(result.statements?.[0]?.key).toBe("wifi-sta");
    expect(result.statements?.[0]?.code).toContain("network.WLAN(network.STA_IF)");
    expect(result.statements?.[0]?.code).toContain(".active(True)");
    expect(result.statements?.[0]?.code).not.toContain(".connect(");
  });

  it("connects with the referenced config's ssid/password, sharing the wifi-sta key with wifi_status/udp_send/etc", () => {
    setConfig("wifi1", { ssid: "MyNet", password: "hunter2" });
    const result = wifiGateNode.codegenTransform!(node("wifi1"), ctx);
    expect(result.statements?.[0]?.code).toContain(".connect(");
    expect(result.statements?.[0]?.code).toContain('"MyNet"');
  });

  it("checks live link state (_wifi_sta.isconnected()), not a value read from a wifi_status message", () => {
    const result = wifiGateNode.codegenTransform!(node("unmanaged1"), ctx);
    expect(result.functionBody).toContain("_wifi_sta.isconnected()");
  });

  it("declares an input and output msg port (transform kind, matching delay.ts's shape)", () => {
    expect(wifiGateNode.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(wifiGateNode.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
  });
});
