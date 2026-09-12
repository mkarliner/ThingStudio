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
  return { id: "1", type: "thingstudio/wifi_status", properties };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

// buildMsg now contains a `global` statement (2026-09-02 emit-on-change
// change, wifi-status.ts) -- needs a real function scope to mean what it
// means in the real compiled flow (compile.ts inlines buildMsg into the
// coroutine body, a real function). Calling it directly at bare module
// scope, with the state var's `= None` init also at module scope, is a
// SyntaxError ("assigned to before global declaration"): module-level code
// is its own block for that check, same as a function's, so the init
// assignment and the `global` referencing the same name in that same block
// collide. Wrapping in a real function avoids that -- same fix
// node-timer.test.ts's own `runIterations`/`_iterate()` already applies to
// the identical problem for `timer`'s own `global _timer_count`.
function runSnippet(preamble: string, properties: Record<string, unknown>): string {
  const result = wifiStatusNode.codegenSource!(node(properties), ctx);
  const lines = [
    "import runtime", // compile.ts always adds this to a real flow (line ~196) -- buildMsg's runtime.report_status() call needs it here too
    ...(result.imports ?? []),
    preamble,
    ...(result.statements ?? []).map((s) => s.code),
    `def _poll():\n${indent(`${result.buildMsg}\nprint(msg)`, 4)}`,
    "_poll()",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

// Runs buildMsg twice in the same process (same module-scope `_wifi_status_last*`
// global carrying state across the two calls, exactly as it would across two
// real polls in the generated flow's own while-loop) -- `runSnippet` above
// only ever runs it once, which can't exercise the 2026-09-02 emit-on-change
// behavior (outstanding-items/wifi-status-emit-on-change.md) at all.
// `initialPreamble` runs once before the first call (sets the state the
// first poll observes); `betweenPreamble` runs after the first call and
// before the second (the state change, if any, the second poll should
// react to). Each call's `msg` is printed via `repr()` on its own line so
// `None` (skipped, unchanged) is distinguishable from an actual `{...}` dict.
function runSnippetTwice(initialPreamble: string, betweenPreamble: string, properties: Record<string, unknown>): [string, string, string] {
  const result = wifiStatusNode.codegenSource!(node(properties), ctx);
  // `_poll()` defined ONCE (buildMsg's `global` needs real function scope,
  // same reason `runSnippet` above wraps it -- see that function's own
  // comment) then called twice, with `initialPreamble`/`betweenPreamble`
  // run at module scope in between calls to mutate pymock's WLAN class
  // state -- mirrors two real polls in the generated flow's own
  // while-loop, where the same coroutine-local `global` var persists
  // across iterations.
  //
  // Setup statements (WLAN construction/`.active(True)`/etc.) print their
  // own "WLAN_INIT"/"WLAN_ACTIVE"/"WLAN_CONNECT" lines (pymock's network.py)
  // -- a marker prefix on just the two lines this helper actually cares
  // about, filtered below, keeps this robust against however much or little
  // setup-statement output sits in between, rather than assuming (wrongly)
  // that the two `msg` reprs are the only lines printed at all.
  const lines = [
    "import runtime", // same reason as runSnippet() above
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    `def _poll():\n${indent(`${result.buildMsg}\nprint("MSG:" + repr(msg))`, 4)}`,
    initialPreamble,
    "_poll()",
    betweenPreamble,
    "_poll()",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  const output = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
  const printed = output
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("MSG:"))
    .map((line) => line.slice("MSG:".length));
  if (printed.length !== 2) throw new Error(`expected exactly 2 "MSG:" lines, got: ${output}`);
  // Third element: the full raw output, unfiltered -- lets a caller also
  // check for/count NODE_STATUS lines (report_status(), 2026-09-10),
  // which the MSG:-only filtering above would otherwise throw away.
  // Existing callers destructuring just `[first, second]` are unaffected.
  return [printed[0]!, printed[1]!, output];
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

  it("emits on the first poll but not a second poll with no change (2026-09-02 emit-on-change)", () => {
    const [first, second] = runSnippetTwice("", "", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    expect(first).toContain("'payload': False");
    expect(second).toBe("None");
  });

  it("emits again on a second poll when connection state changes False -> True", () => {
    const [first, second] = runSnippetTwice(
      "",
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(first).toContain("'payload': False");
    expect(second).toContain("'payload': True");
    expect(second).toContain("'ip': '192.168.1.42'");
  });

  it("emits again when still connected but the IP changes (DHCP lease renewal)", () => {
    const [first, second] = runSnippetTwice(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      "network.WLAN.IFCONFIG = ('192.168.1.99', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(first).toContain("'ip': '192.168.1.42'");
    expect(second).toContain("'payload': True");
    expect(second).toContain("'ip': '192.168.1.99'");
  });

  it("does not emit again on a second poll when still connected with the same IP", () => {
    const [first, second] = runSnippetTwice(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      "",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(first).toContain("'ip': '192.168.1.42'");
    expect(second).toBe("None");
  });

  it("includes subnet/gateway/dns/rssi in the envelope when connected (2026-09-09 completeness change)", () => {
    const output = runSnippet(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI = -47",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(output).toContain("'ip': '192.168.1.42'");
    expect(output).toContain("'subnet': '255.255.255.0'");
    expect(output).toContain("'gateway': '192.168.1.1'");
    expect(output).toContain("'dns': '8.8.8.8'");
    expect(output).toContain("'rssi': -47");
  });

  it("reports empty-string subnet/gateway/dns and rssi None when not connected", () => {
    const output = runSnippet("network.WLAN.CONNECTED = False", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    expect(output).toContain("'subnet': ''");
    expect(output).toContain("'gateway': ''");
    expect(output).toContain("'dns': ''");
    expect(output).toContain("'rssi': None");
  });

  it("degrades rssi to None (not a crash) on a board where status('rssi') raises OSError -- board-idiosyncrasy limitation, wifi-status-completeness.md", () => {
    const output = runSnippet(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI_UNSUPPORTED = True",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(output).toContain("'rssi': None");
    expect(output).toContain("'payload': True");
  });

  it("re-emits when gateway changes even though ip stays the same (network-identity field, same treatment as ip)", () => {
    const [first, second] = runSnippetTwice(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      "network.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.254', '8.8.8.8')",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(first).toContain("'gateway': '192.168.1.1'");
    expect(second).toContain("'gateway': '192.168.1.254'");
  });

  it("does NOT re-emit merely because rssi changes between polls -- rssi is deliberately excluded from change-detection (2026-09-09 header note)", () => {
    const [first, second] = runSnippetTwice(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI = -40",
      "network.WLAN.RSSI = -80",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(first).toContain("'rssi': -40");
    expect(second).toBe("None");
  });

  it("calls runtime.report_status with state 'connected' and the IP as text when connected (NODE_STATUS, 2026-09-10)", () => {
    const output = runSnippet(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    expect(output).toContain("NODE_STATUS node=1 state=connected text=192.168.1.42");
  });

  it("calls runtime.report_status with state 'disconnected' and no text when not connected (NODE_STATUS, 2026-09-10)", () => {
    const output = runSnippet("network.WLAN.CONNECTED = False", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    expect(output).toContain("NODE_STATUS node=1 state=disconnected text=None");
  });

  it("does not call report_status again on a second poll with no connection-state change (same emit-on-change gate as msg)", () => {
    const [, , raw] = runSnippetTwice("network.WLAN.CONNECTED = False", "", { pollMs: 1000, wifiConfigId: "unmanaged1" });
    const statusLines = raw.split("\n").filter((line) => line.startsWith("NODE_STATUS"));
    expect(statusLines).toHaveLength(1); // only the first poll's -- see wifi-status.ts's own comment on report_status piggybacking on the msg change-detection branch
  });

  it("reports again when the gateway changes while staying connected, even though 'connected' itself didn't change (documented redundancy, wifi-status.ts header)", () => {
    const [, , raw] = runSnippetTwice(
      "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      "network.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.254', '8.8.8.8')",
      { pollMs: 1000, wifiConfigId: "unmanaged1" },
    );
    const statusLines = raw.split("\n").filter((line) => line.startsWith("NODE_STATUS"));
    expect(statusLines).toHaveLength(2);
    expect(statusLines[0]).toBe("NODE_STATUS node=1 state=connected text=192.168.1.42");
    expect(statusLines[1]).toBe("NODE_STATUS node=1 state=connected text=192.168.1.42"); // same state+text -- the documented harmless redundancy
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

  // WiFi-vs-mqtt_as dual-connection-ownership fix, 2026-09-11 (Mike's
  // real-hardware finding of WiFi visibly cycling up/down with mqtt nodes
  // in the flow -- outstanding-items/node-status-indicators.md,
  // wifi-status.ts's own header comment right above its `flowHasMqttNodes()`
  // call site for the full mechanism). A real, config'd (not "unmanaged")
  // WiFi credential is used here specifically so this test can tell
  // "connect() was skipped because mqtt nodes are present" apart from
  // "connect() was skipped because the config itself said unmanaged"
  // (covered separately below) -- `deferToMqtt` is a deliberately
  // SEPARATE parameter from `security` (wifiSetupStatement()'s own
  // header, 2026-09-11 revision: Mike's call, a first cut of this fix
  // overloaded `security: "unmanaged"` for both meanings and he flagged
  // that as confusing for a future maintainer -- no way to tell "I set
  // this" from "the compiler decided this").
  it("does not call connect() itself when the flow has an mqtt_publish node -- defers to mqtt_as (2026-09-11)", () => {
    setConfig("wifi1", { ssid: "MyNetwork", password: "hunter2" });
    const mqttNode: GraphNode = { id: "m1", type: "thingstudio/mqtt_publish", properties: {} };
    const ctxWithMqtt: CodegenContext = { ...ctx, findNodesOfType: (type) => (type === "thingstudio/mqtt_publish" ? [mqttNode] : []) };
    const result = wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "wifi1" }), ctxWithMqtt);
    const wifiStaCode = result.statements?.find((s) => s.code.includes("network.WLAN"))?.code ?? "";
    expect(wifiStaCode).not.toContain(".connect(");
    expect(wifiStaCode).toContain("_wifi_sta.active(True)"); // interface still brought up, just not connected by this node
    expect(wifiStaCode).toContain("# WiFi connection managed by mqtt_as"); // generated code says why, without needing the property panel
  });

  it("does not call connect() when the flow has an mqtt_subscribe node either (same deferral, other mqtt node type)", () => {
    setConfig("wifi1", { ssid: "MyNetwork", password: "hunter2" });
    const mqttNode: GraphNode = { id: "m1", type: "thingstudio/mqtt_subscribe", properties: {} };
    const ctxWithMqtt: CodegenContext = { ...ctx, findNodesOfType: (type) => (type === "thingstudio/mqtt_subscribe" ? [mqttNode] : []) };
    const result = wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "wifi1" }), ctxWithMqtt);
    const wifiStaCode = result.statements?.find((s) => s.code.includes("network.WLAN"))?.code ?? "";
    expect(wifiStaCode).not.toContain(".connect(");
  });

  it("still calls connect() itself when findNodesOfType reports no mqtt nodes at all (unaffected by the deferral)", () => {
    setConfig("wifi1", { ssid: "MyNetwork", password: "hunter2" });
    const ctxNoMqtt: CodegenContext = { ...ctx, findNodesOfType: () => [] };
    const result = wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "wifi1" }), ctxNoMqtt);
    const wifiStaCode = result.statements?.find((s) => s.code.includes("network.WLAN"))?.code ?? "";
    expect(wifiStaCode).toContain('.connect("MyNetwork", "hunter2")');
    expect(wifiStaCode).not.toContain("# WiFi connection managed by mqtt_as");
  });

  it("keeps the mqtt-deferral comment separate from a user-chosen 'unmanaged' config -- the two never get conflated", () => {
    // No mqtt nodes at all here -- "unmanaged1" is the flow author's OWN
    // choice (this file's beforeEach), not the compiler's. The generated
    // code should look exactly like the pre-2026-09-11 "unmanaged" case
    // always has: no connect(), and critically no mqtt-deferral comment,
    // since nothing here has anything to do with mqtt.
    const ctxNoMqtt: CodegenContext = { ...ctx, findNodesOfType: () => [] };
    const result = wifiStatusNode.codegenSource!(node({ pollMs: 1000, wifiConfigId: "unmanaged1" }), ctxNoMqtt);
    const wifiStaCode = result.statements?.find((s) => s.code.includes("network.WLAN"))?.code ?? "";
    expect(wifiStaCode).not.toContain(".connect(");
    expect(wifiStaCode).not.toContain("# WiFi connection managed by mqtt_as");
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
        { id: "1", type: "thingstudio/wifi_status", properties: { pollMs: 3000, wifiConfigId: "wifi1" } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "MyNetwork", password: "hunter2" } }],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_wifi_sta = network.WLAN(network.STA_IF)");
    expect(source).toContain("_wifi_sta.active(True)");
    expect(source).toContain("while True:");
    expect(source).toContain("asyncio.sleep_ms(3000)");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("guards the downstream chain with \"if msg is not None\" so an unchanged poll doesn't call debug (2026-09-02)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/wifi_status", properties: { pollMs: 3000, wifiConfigId: "wifi1" } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
      configs: [{ id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "MyNetwork", password: "hunter2" } }],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("if msg is not None:");
    // The sleep/yield must sit outside that guard -- a skipped poll must
    // still yield the event loop every iteration, not busy-loop (this
    // file's own header, compile.ts's matching comment on the transform
    // side of the same mechanism).
    const guardIndex = source.indexOf("if msg is not None:");
    // "await " prefixes the sleep call on its own line -- searching for
    // the call including that keyword, not just the bare function name,
    // keeps the indentation slice below anchored to the actual start of
    // the line rather than partway through it.
    const sleepIndex = source.indexOf("await asyncio.sleep_ms(3000)");
    expect(sleepIndex).toBeGreaterThan(guardIndex);
    const guardLineIndent = source.slice(0, guardIndex).match(/\n( *)$/)?.[1] ?? "";
    const sleepLineIndent = source.slice(0, sleepIndex).match(/\n( *)$/)?.[1] ?? "";
    expect(sleepLineIndent.length).toBe(guardLineIndent.length);
  });

  it("dedups the shared wifi-sta setup statement across two wifi_status nodes sharing one config (first one wins)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/wifi_status", properties: { pollMs: 1000, wifiConfigId: "wifi1" } },
        { id: "2", type: "thingstudio/wifi_status", properties: { pollMs: 2000, wifiConfigId: "wifi1" } },
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
      nodes: [{ id: "1", type: "thingstudio/wifi_status", properties: { pollMs: 1000, wifiConfigId: "no-such-config" } }],
      links: [],
    };
    expect(() => compile(graph, buildRegistry())).toThrow(/referenced config "no-such-config" not found/);
  });
});
