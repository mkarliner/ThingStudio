// Tier 1 network node: mqtt_publish (editor/src/node-library/mqtt-publish.ts).
// A sink triggered by a one-shot ("manual") inject, so unlike
// node-wifi-status.test.ts/node-mqtt-subscribe.test.ts this runs fine
// through the full compile() + runGenerated path (same pattern as
// node-boolean.test.ts) -- no repeating loop involved. Asserts against
// pymock's mqtt_as.py fixture (PUBLISHED list + printed MQTT_* lines),
// not a real broker -- see node-http-request.test.ts for the real-local-
// server approach used where the node's own I/O logic (not just its
// config wiring) needs exercising; mqtt_as itself is the vendored,
// already-proven-elsewhere library here, so this test's job is "does the
// generated code call it correctly," not "does MQTT actually work."
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// updated 2026-08-21 for the wifiConfigId behavior change -- see
// mqtt-shared.ts's own header. Same fake-resolveConfig-via-local-map
// pattern node-udp-send.test.ts uses, EXCEPT there's no "unmanaged1"
// stand-in default here: mqtt_publish rejects "unmanaged" outright (see
// mqtt-shared.ts's header for why), so the default seeded WiFi config
// ("wifi1") always carries a real ssid/password.
//
// Updated again the same day for the broker-config behavior change (Mike's
// own follow-up request, same session): `broker`/`port` moved out of the
// node's own properties into a second referenced config,
// `thingstudio/config/mqtt-broker`, via `brokerConfigId` -- default seeded
// as "broker1". Unlike the fixed "wifi1" WiFi config (every test wants the
// same credentials), most tests here DO care about the broker's own
// broker/port value, so `configsWith()` below reseeds "broker1" fresh per
// call rather than reusing one fixed default the way DEFAULT_WIFI_CONFIG
// does.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { mqttPublishNode } from "../src/node-library/mqtt-publish.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import type { GraphNode } from "../src/compiler/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();

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

/** Finds the actual MQTTClient-construction statement among a codegen
 * result's `statements` -- NOT index [0] (that's
 * `mqttWifiPrecheckStatement()`'s WiFi-reconnect race fix, mqtt-shared.ts,
 * emitted first but with no broker/credential content of its own to
 * assert against here). Looked up by content rather than a fixed index so
 * this stays correct regardless of how many statements get added ahead of
 * it in the future. */
function mqttClientSetupCode(result: { statements?: { key: string; code: string }[] }): string {
  const stmt = result.statements?.find((s) => s.code.includes("mqtt_as.MQTTClient("));
  if (!stmt) throw new Error("no MQTTClient setup statement found in codegen result");
  return stmt.code;
}

const DEFAULT_WIFI_CONFIG = { id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "MyNet", password: "hunter2" } };

function configsWith(brokerProps: Record<string, unknown>): NonNullable<GraphData["configs"]> {
  return [DEFAULT_WIFI_CONFIG, { id: "broker1", type: "thingstudio/config/mqtt-broker", properties: brokerProps }];
}

beforeEach(() => {
  fakeConfigs.clear();
  setConfig("wifi1", { ssid: "MyNet", password: "hunter2" });
  setConfig("broker1", { broker: "b", port: 1883, username: "", password: "" });
});

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/mqtt_publish", properties };
}

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

function graphWith(mqttProps: Record<string, unknown>, brokerProps: Record<string, unknown>): GraphData {
  return {
    nodes: [
      { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "42.5", repeat: "manual" } },
      { id: 2, type: "thingstudio/mqtt_publish", properties: { ...mqttProps, wifiConfigId: "wifi1", brokerConfigId: "broker1" } },
    ],
    links: [[1, 1, 0, 2, 0, "string"]],
    configs: configsWith(brokerProps),
  };
}

describe("thingstudio/mqtt_publish node", () => {
  it("connects once and publishes the inbound payload to the configured topic", () => {
    const { source } = compile(graphWith({ topic: "sensors/temp" }, { broker: "test.broker.local", port: 1883 }), registry);
    const output = runGenerated(source);
    expect(output).toContain("MQTT_CONNECT server=test.broker.local port=1883");
    expect(output).toContain("MQTT_PUBLISH topic='sensors/temp' payload=b'42.5' retain=False qos=0");
  });

  it("publishes with retain=True and qos=1 when configured", () => {
    const { source } = compile(graphWith({ topic: "t", retain: true, qos: 1 }, { broker: "b", port: 1883 }), registry);
    const output = runGenerated(source);
    expect(output).toContain("retain=True qos=1");
  });

  it("two mqtt_publish nodes on the same broker share one client (setup dedup)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "a", repeat: "manual" } },
        { id: 2, type: "thingstudio/mqtt_publish", properties: { topic: "t1", wifiConfigId: "wifi1", brokerConfigId: "broker1" } },
        { id: 3, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "b", repeat: "manual" } },
        { id: 4, type: "thingstudio/mqtt_publish", properties: { topic: "t2", wifiConfigId: "wifi1", brokerConfigId: "broker1" } },
      ],
      links: [
        [1, 1, 0, 2, 0, "string"],
        [2, 3, 0, 4, 0, "string"],
      ],
      configs: configsWith({ broker: "b", port: 1883 }),
    };
    const { source } = compile(graph, registry);
    expect(source.match(/mqtt_as\.MQTTClient\(/g)?.length).toBe(1);
    const output = runGenerated(source);
    expect(output).toContain("MQTT_PUBLISH topic='t1'");
    expect(output).toContain("MQTT_PUBLISH topic='t2'");
  });

  it("rejects a missing brokerConfigId", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1" }), ctx)).toThrow(CompileError);
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1" }), ctx)).toThrow(/requires an MQTT broker config/);
  });

  it("rejects a referenced broker config with no broker hostname", () => {
    setConfig("noHost", { port: 1883 });
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "noHost" }), ctx)).toThrow(
      /no "broker" hostname\/IP set/,
    );
  });

  it("rejects a referenced broker config with an invalid port", () => {
    setConfig("badPort", { broker: "b", port: 0 });
    setConfig("badPort2", { broker: "b", port: 70000 });
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "badPort" }), ctx)).toThrow(/invalid port/);
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "badPort2" }), ctx)).toThrow(/invalid port/);
  });

  it("resolves the broker config's username/password into the client setup code", () => {
    setConfig("authed", { broker: "b", port: 1883, username: "flowuser", password: "brokerpw" });
    const result = mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "authed" }), ctx);
    expect(mqttClientSetupCode(result)).toContain('"flowuser"');
    expect(mqttClientSetupCode(result)).toContain('"brokerpw"');
  });

  it("defaults broker username/password to empty when the referenced config omits them", () => {
    const result = mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "broker1" }), ctx);
    expect(mqttClientSetupCode(result)).toContain("_cfg['user'] = \"\"");
    expect(mqttClientSetupCode(result)).toContain("_cfg['password'] = \"\"");
  });

  it("raises a CompileError referencing the missing id when brokerConfigId doesn't resolve", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "nope" }), ctx)).toThrow(
      /referenced config "nope" not found/,
    );
  });

  it("rejects a missing wifiConfigId", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", brokerConfigId: "broker1" }), ctx)).toThrow(CompileError);
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", brokerConfigId: "broker1" }), ctx)).toThrow(/requires a WiFi config/);
  });

  it("rejects a missing topic", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ wifiConfigId: "wifi1", brokerConfigId: "broker1" }), ctx)).toThrow(/non-empty "topic"/);
  });

  it("rejects an unsupported qos", () => {
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "broker1", qos: 2 }), ctx)).toThrow(
      /must be 0 or 1/,
    );
  });

  it("defaults port to 1883 (from the broker config's own default) and qos to 0", () => {
    const result = mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi1", brokerConfigId: "broker1" }), ctx);
    expect(mqttClientSetupCode(result)).toContain("_cfg['port'] = 1883");
    expect(result.functionBody).toContain("qos=0");
  });

  it("rejects a referenced WiFi config with security 'unmanaged' -- mqtt_as always needs real credentials", () => {
    setConfig("unmanaged1", { security: "unmanaged" });
    expect(() =>
      mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "unmanaged1", brokerConfigId: "broker1" }), ctx),
    ).toThrow(/security "unmanaged", which isn't supported here/);
  });

  it("rejects a referenced WiFi config with security 'password' (the default) and an empty password", () => {
    setConfig("nopw", { ssid: "MyNet", password: "" });
    expect(() => mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "nopw", brokerConfigId: "broker1" }), ctx)).toThrow(
      /has no password but security is "password"/,
    );
  });

  it("resolves the WiFi config's ssid/password into the client setup code", () => {
    setConfig("wifi2", { ssid: "RealNet", password: "realpw" });
    const result = mqttPublishNode.codegenSink!(node({ topic: "t", wifiConfigId: "wifi2", brokerConfigId: "broker1" }), ctx);
    expect(mqttClientSetupCode(result)).toContain('"RealNet"');
    expect(mqttClientSetupCode(result)).toContain('"realpw"');
  });

  // The "connect wifi, connect mqtt, then do mqtt things" ordering
  // question: within one node's own function body this is trivially true
  // (ordinary sequential Python), but the interesting case is TWO
  // independently-triggered chains sharing one broker client, both
  // reaching mqttEnsureConnectedSnippet's "not connected yet" check
  // before either has actually finished connecting. Every other test in
  // this file only proves "already connected, skip" (pymock's spawn()
  // runs each spawned chain to completion via its own asyncio.run() call
  // before the next one starts -- see that fixture's own header -- so
  // two chains never actually race there). This test bypasses compile()/
  // spawn() entirely and drives both function bodies through a REAL
  // concurrent asyncio.gather(), with an artificial delay inside
  // connect() (pymock's MQTTClient.CONNECT_DELAY_S) long enough to give
  // a genuine window for both coroutines to reach the "not connected"
  // check before either has set the flag -- proving the
  // mqttEnsureConnectedSnippet double-checked-lock actually serializes
  // real contention, not just reasoned about on paper.
  it("two chains racing to connect the same client only actually connect once", () => {
    // A real dedup'd ctx (matching compile.ts's own uniqueName logic), not
    // the fixed `(hint) => "_"+hint` used elsewhere in this file -- that
    // fixed version is fine when only one codegen call ever happens per
    // test, but here TWO codegenSink calls need genuinely distinct
    // function names, exactly as real compilation would produce. Using
    // the fixed version here silently caused the second `async def`
    // to redefine (shadow) the first at module scope -- caught by this
    // test's own first run, not assumed safe.
    const used = new Set<string>();
    const ctxShared: CodegenContext = {
      uniqueName(hint: string): string {
        let candidate = `_${hint}`;
        let i = 1;
        while (used.has(candidate)) candidate = `_${hint}_${i++}`;
        used.add(candidate);
        return candidate;
      },
      resolveConfig: (id) => {
        const cfg = fakeConfigs.get(id);
        if (!cfg) throw new CompileError(`referenced config "${id}" not found`);
        return cfg;
      },
    };
    const cfg = { topic: "t1", wifiConfigId: "wifi1", brokerConfigId: "broker1" };
    const resultA = mqttPublishNode.codegenSink!(node(cfg), ctxShared);
    const resultB = mqttPublishNode.codegenSink!(node({ ...cfg, topic: "t2" }), ctxShared);
    // Both nodes target the same broker/port, so both proposed statements
    // (the WiFi-reconnect precheck plus the client setup, mqtt-shared.ts)
    // are byte-identical -- emit each once, exactly like compile.ts's
    // mergeSetup dedup would.
    expect(resultA.statements?.map((s) => s.code)).toEqual(resultB.statements?.map((s) => s.code));

    const lines = [
      "import asyncio",
      ...(resultA.imports ?? []),
      ...(resultA.statements ?? []).map((s) => s.code),
      "",
      `async def ${resultA.functionName}(msg):`,
      ...resultA.functionBody.split("\n").map((l) => `    ${l}`),
      "",
      `async def ${resultB.functionName}(msg):`,
      ...resultB.functionBody.split("\n").map((l) => `    ${l}`),
      "",
      "async def _main():",
      "    mqtt_as.MQTTClient.CONNECT_DELAY_S = 0.05",
      `    await asyncio.gather(${resultA.functionName}({'payload': 'a', 'topic': ''}), ${resultB.functionName}({'payload': 'b', 'topic': ''}))`,
      "    print('CONNECT_CALLS', mqtt_as.CLIENTS[-1].connect_calls)",
      "",
      "asyncio.run(_main())",
    ];
    const output = runGenerated(lines.join("\n"));
    expect(output).toContain("CONNECT_CALLS 1");
    // Both still actually published -- the second chain wasn't dropped or
    // errored while waiting on the lock, just delayed until connect()
    // (started by the first chain) finished.
    expect(output).toContain("MQTT_PUBLISH topic='t1'");
    expect(output).toContain("MQTT_PUBLISH topic='t2'");
  });
});
