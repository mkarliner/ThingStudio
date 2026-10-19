// mqtt_publish as a core package with a compile hook (2026-10-19): the hook validates topic/qos and derives the
// flow's WiFi + referenced broker config; the Python publishes through the shared ts_mqtt client. Behaviour tests
// run the generated flow against pymock's mqtt_as fixture (connect/publish are recorded and printed); validation
// tests run the real WASI hook.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphConfigNode, GraphData } from "../src/compiler/graph.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { compileWithHooks } from "./compile-with-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const TYPE = "thingstudio/mqtt_publish";

const WIFI = (properties: Record<string, unknown> = { ssid: "MyNet", password: "hunter2" }, id = "wifi1"): GraphConfigNode => ({
  id,
  type: "thingstudio/config/wifi",
  properties,
});
const BROKER = (properties: Record<string, unknown> = { broker: "test.broker.local", port: 1883 }, id = "broker1"): GraphConfigNode => ({
  id,
  type: "thingstudio/config/mqtt-broker",
  properties,
});

function graphWith(props: Record<string, unknown>, configs: GraphConfigNode[] = [WIFI(), BROKER()]): GraphData {
  return {
    nodes: [
      { id: "1", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "42.5", repeat: "manual" } },
      { id: "2", type: TYPE, properties: { ...props, brokerConfigId: props.brokerConfigId ?? "broker1" } },
    ],
    links: [[1, "1", 0, "2", 0, "string"]],
    configs,
  };
}

async function hookError(g: GraphData): Promise<string | undefined> {
  try {
    await runCompileHooks(g, buildRegistry(), runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-mqttpub-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("thingstudio/mqtt_publish package", () => {
  it("connects once and publishes the inbound payload to the configured topic", async () => {
    const { source } = await compileWithHooks(graphWith({ topic: "sensors/temp" }), buildRegistry());
    const output = runGenerated(source);
    expect(output).toContain("MQTT_CONNECT server=test.broker.local port=1883");
    expect(output).toContain("MQTT_PUBLISH topic='sensors/temp' payload=b'42.5' retain=False qos=0");
  });

  it("reports NODE_STATUS connected under its own node id after connecting", async () => {
    const { source } = await compileWithHooks(graphWith({ topic: "t" }), buildRegistry());
    const output = runGenerated(source);
    expect(output).toContain("NODE_STATUS node=2 state=connected text=None");
  });

  it("two mqtt_publish nodes on the same broker share one client", async () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "a", repeat: "manual" } },
        { id: "2", type: TYPE, properties: { topic: "t1", brokerConfigId: "broker1" } },
        { id: "3", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "b", repeat: "manual" } },
        { id: "4", type: TYPE, properties: { topic: "t2", brokerConfigId: "broker1" } },
      ],
      links: [
        [1, "1", 0, "2", 0, "string"],
        [2, "3", 0, "4", 0, "string"],
      ],
      configs: [WIFI(), BROKER({ broker: "b", port: 1883 })],
    };
    const { source } = await compileWithHooks(graph, buildRegistry());
    const output = runGenerated(source);
    expect(output.match(/MQTT_CONNECT /g)?.length).toBe(1);
    expect(output).toContain("MQTT_PUBLISH topic='t1'");
    expect(output).toContain("MQTT_PUBLISH topic='t2'");
  });

  it("publishes with retain=True and qos=1 when configured", async () => {
    const { source } = await compileWithHooks(graphWith({ topic: "t", retain: true, qos: 1 }), buildRegistry());
    expect(runGenerated(source)).toContain("retain=True qos=1");
  });

  it("resolves the broker config's username/password and the WiFi ssid/password into the generated client", async () => {
    const { source } = await compileWithHooks(
      graphWith({ topic: "t" }, [WIFI({ ssid: "RealNet", password: "realpw" }), BROKER({ broker: "b", port: 1883, username: "flowuser", password: "brokerpw" })]),
      buildRegistry(),
    );
    expect(source).toContain("ensure_client(");
    expect(source).toContain('"ssid": "RealNet"');
    expect(source).toContain('"wifiPassword": "realpw"');
    expect(source).toContain('"username": "flowuser"');
    expect(source).toContain('"brokerPassword": "brokerpw"');
  });

  it("rejects a missing brokerConfigId", async () => {
    const err = await hookError(graphWith({ topic: "t", brokerConfigId: "" }));
    expect(err).toMatch(/requires an MQTT broker config/);
  });

  it("rejects a referenced broker config with no broker hostname", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI(), BROKER({ port: 1883 })]))).toMatch(/no "broker" hostname\/IP set/);
  });

  it("rejects a referenced broker config with an invalid port", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI(), BROKER({ broker: "b", port: 70000 })]))).toMatch(/invalid port/);
  });

  it("rejects a missing topic", async () => {
    expect(await hookError(graphWith({}))).toMatch(/non-empty "topic"/);
  });

  it("rejects an unsupported qos", async () => {
    expect(await hookError(graphWith({ topic: "t", qos: 2 }))).toMatch(/must be 0 or 1/);
  });

  it("rejects a flow with no WiFi config", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [BROKER()]))).toMatch(/needs a WiFi network/);
  });

  it("rejects a flow with two WiFi configs", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI(), WIFI({ ssid: "Other", password: "x" }, "wifi2"), BROKER()]))).toMatch(/a flow can only have one/);
  });

  it("rejects WiFi security 'unmanaged' -- mqtt_as always needs real credentials", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI({ security: "unmanaged" }), BROKER()]))).toMatch(/security "unmanaged"/);
  });

  it("rejects security 'password' with an empty password", async () => {
    expect(await hookError(graphWith({ topic: "t" }, [WIFI({ ssid: "MyNet", password: "" }), BROKER()]))).toMatch(/has no password but security is "password"/);
  });

  it("defaults the port to 1883 and qos to 0", async () => {
    const { source } = await compileWithHooks(graphWith({ topic: "t" }, [WIFI(), BROKER({ broker: "b" })]), buildRegistry());
    expect(source).toContain('"port": 1883');
    expect(source).toContain('"qos": 0');
  });
});
