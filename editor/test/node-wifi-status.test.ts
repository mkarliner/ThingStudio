// wifi_status as a core package with a compile hook: the first "no loss" conversion
// (package-compile-hooks-scoping.md §8). The hook runs for real against the vendored MicroPython WASI
// interpreter; the Python runs against pymock's network module in the behaviour tests.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphConfigNode, GraphData, GraphNode } from "../src/compiler/graph.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks, type CompileHookRunner } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { computeWifiProvisionMarker, normalizeWifiConfigs } from "../src/node-library/wifi-status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner: CompileHookRunner = {
  run: (hookSource, ctx, properties) => runHookOnce({ wasmBytes, hookSource, context: ctx, properties }),
};

const TYPE = "thingstudio/wifi_status";
const WIFI = "thingstudio/config/wifi";

function node(properties: Record<string, unknown>, id = "1"): GraphNode {
  return { id, type: TYPE, properties };
}

function graph(props: Record<string, unknown>, configs: GraphConfigNode[] = [], extra: GraphNode[] = []): GraphData {
  return { nodes: [node(props), ...extra], links: [], ...(configs.length > 0 ? { configs } : {}) };
}

function wifiConfig(properties: Record<string, unknown>, id = "w1"): GraphConfigNode {
  return { id, type: WIFI, properties };
}

/** `undefined` when the hook accepted the node, the thrown message when it refused. */
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
  const used = new Set<string>();
  const ctx = {
    uniqueName(hint: string) {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    hookResult: (id: string) => hooks.results.get(id),
    resolveConfig: (id: string) => {
      const c = g.configs?.find((x) => x.id === id);
      if (!c) throw new CompileError(`referenced config "${id}" not found`);
      return c.properties;
    },
    findConfigsOfType: (type: string) => (type === WIFI ? (g.configs ?? []).filter((c) => c.type === WIFI) : []),
  };
  const result = def.codegenSource!(g.nodes[0]!, ctx);
  return { result, hooks };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

interface Snippet {
  imports?: string[];
  statements?: { code: string }[];
  buildMsg: string;
}

/** Runs the package's `emit` twice: `initial` runs before the first call, `between` before the second. */
async function runTwice(
  g: GraphData,
  options: { initial?: string; between?: string } = {},
): Promise<{ first: string; second: string; raw: string }> {
  const { result } = await codegen(g);
  const call = /^msg = await (\w+)\((\w+)\)$/.exec(result.buildMsg);
  if (!call) throw new Error(`unexpected package buildMsg: ${result.buildMsg}`);
  const [, emitName, propsName] = call;
  const snippet = result as Snippet;
  const lines = [
    "import runtime",
    "import network",
    "asyncio = runtime.asyncio",
    ...(snippet.imports ?? []),
    ...(snippet.statements ?? []).map((s) => s.code),
    "",
    "async def _poll():",
    indent(`msg = await ${emitName}(${propsName})`, 4),
    indent(`print("MSG:" + repr(msg))`, 4),
    "",
    options.initial ?? "",
    "asyncio.run(_poll())",
    options.between ?? "",
    "asyncio.run(_poll())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-wifistatus-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const output = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
  });
  const printed = output
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("MSG:"))
    .map((l) => l.slice("MSG:".length));
  if (printed.length !== 2) throw new Error(`expected 2 MSG lines, got:\n${output}`);
  return { first: printed[0]!, second: printed[1]!, raw: output };
}

const unmanaged = () => [wifiConfig({ security: "unmanaged" })];

describe("thingstudio/wifi_status package", () => {
  describe("the compile hook", () => {
    it("resolves the flow's WiFi config and defers to mqtt when an mqtt node is present", async () => {
      const g = graph(
        { pollMs: 1000 },
        [wifiConfig({ ssid: "net", password: "pw" }), { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "b", port: 1883 } }],
        [{ id: "m1", type: "thingstudio/mqtt_publish", properties: { topic: "t", brokerConfigId: "b1" } }],
      );
      const { hooks } = await codegen(g);
      expect(hooks.results.get("1")!.properties).toEqual({
        ssid: "net",
        password: "pw",
        security: "password",
        deferToMqtt: true,
        intervalMs: 1000,
      });
    });

    it("refuses a flow with no WiFi config", async () => {
      expect(await hookError(graph({ pollMs: 1000 }))).toMatch(/needs a WiFi network/);
    });

    it("refuses two WiFi configs", async () => {
      expect(await hookError(graph({ pollMs: 1000 }, [wifiConfig({ ssid: "a" }, "w1"), wifiConfig({ ssid: "b" }, "w2")]))).toMatch(/2 WiFi configs/);
    });

    it("refuses an empty SSID unless unmanaged", async () => {
      expect(await hookError(graph({ pollMs: 1000 }, [wifiConfig({ ssid: "" })]))).toMatch(/no network name/);
    });

    it("refuses a password network with no password", async () => {
      expect(await hookError(graph({ pollMs: 1000 }, [wifiConfig({ ssid: "net", password: "" })]))).toMatch(/has no password/);
    });

    it("accepts an open network with no password", async () => {
      expect(await hookError(graph({ pollMs: 1000 }, [wifiConfig({ ssid: "net", password: "", security: "open" })]))).toBeUndefined();
    });

    it("refuses a non-positive poll interval", async () => {
      expect(await hookError(graph({ pollMs: 0 }, unmanaged()))).toMatch(/pollMs must be a positive number/);
      expect(await hookError(graph({ pollMs: -5 }, unmanaged()))).toMatch(/pollMs must be a positive number/);
    });

    it("its errors name the node", async () => {
      expect(await hookError(graph({ pollMs: 1000 }))).toMatch(/^thingstudio\/wifi_status \(node 1\): /);
    });
  });

  describe("the device behaviour (pymock)", () => {
    it("reports payload False and ip '' when not connected", async () => {
      const { first } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), { initial: "network.WLAN.CONNECTED = False" });
      expect(first).toContain("'payload': False");
      expect(first).toContain("'ip': ''");
    });

    it("reports payload True and the ifconfig fields when connected", async () => {
      const { first, raw } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), {
        initial:
          "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI = -47",
      });
      expect(first).toContain("'payload': True");
      expect(first).toContain("'ip': '192.168.1.42'");
      expect(first).toContain("'subnet': '255.255.255.0'");
      expect(first).toContain("'gateway': '192.168.1.1'");
      expect(first).toContain("'dns': '8.8.8.8'");
      expect(first).toContain("'rssi': -47");
      expect(raw).toContain("NODE_STATUS node=1 state=connected text=192.168.1.42");
    });

    it("emits on the first poll but not a second poll with no change", async () => {
      const { first, second } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), { initial: "network.WLAN.CONNECTED = False" });
      expect(first).toContain("'payload': False");
      expect(second).toBe("None");
    });

    it("emits again when connection state changes False -> True", async () => {
      const { first, second } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), {
        initial: "network.WLAN.CONNECTED = False",
        between:
          "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')",
      });
      expect(first).toContain("'payload': False");
      expect(second).toContain("'payload': True");
      expect(second).toContain("'ip': '192.168.1.42'");
    });

    it("emits again when the IP changes while still connected, but not when only rssi changes", async () => {
      const { first, second } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), {
        initial:
          "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI = -40",
        between: "network.WLAN.IFCONFIG = ('192.168.1.99', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI = -80",
      });
      expect(first).toContain("'ip': '192.168.1.42'");
      expect(second).toContain("'ip': '192.168.1.99'");
    });

    it("does not re-emit merely because rssi changes", async () => {
      const { second } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), {
        initial:
          "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI = -40",
        between: "network.WLAN.RSSI = -80",
      });
      expect(second).toBe("None");
    });

    it("degrades rssi to None when status('rssi') is unsupported", async () => {
      const { first } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), {
        initial:
          "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')\nnetwork.WLAN.RSSI_UNSUPPORTED = True",
      });
      expect(first).toContain("'rssi': None");
      expect(first).toContain("'payload': True");
    });

    it("does not connect for an unmanaged config", async () => {
      const { raw } = await runTwice(graph({ pollMs: 1000 }, unmanaged()));
      expect(raw).not.toContain("WLAN_CONNECT");
    });

    it("connects with the config's credentials", async () => {
      const { raw } = await runTwice(graph({ pollMs: 1000 }, [wifiConfig({ ssid: "net", password: "pw" })]));
      expect(raw).toContain("WLAN_CONNECT STA_IF net");
    });

    it("connects with an empty password for an open network", async () => {
      const { raw } = await runTwice(graph({ pollMs: 1000 }, [wifiConfig({ ssid: "Guest", password: "", security: "open" })]));
      expect(raw).toContain("WLAN_CONNECT STA_IF Guest");
    });

    it("defers the connection to mqtt_as when the flow has mqtt nodes (no join off ESP32)", async () => {
      const g = graph(
        { pollMs: 1000 },
        [wifiConfig({ ssid: "net", password: "pw" }), { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "b", port: 1883 } }],
        [{ id: "m1", type: "thingstudio/mqtt_publish", properties: { topic: "t", brokerConfigId: "b1" } }],
      );
      const { raw } = await runTwice(g);
      // pymock reports sys.platform != "esp32", so the ESP32-only first join is skipped entirely.
      expect(raw).not.toContain("WLAN_CONNECT");
      expect(raw).toContain("WLAN_ACTIVE");
    });
  });

  describe("the compiled flow", () => {
    it("uses pollMs as the loop interval and nests the downstream call inside the None guard", async () => {
      const g: GraphData = {
        nodes: [
          { id: "1", type: TYPE, properties: { pollMs: 3000 } },
          { id: "2", type: "thingstudio/debug", properties: {} },
        ],
        links: [[1, "1", 0, "2", 0, "bool"]],
        configs: [wifiConfig({ ssid: "net", password: "pw" })],
      };
      const registry = buildRegistry();
      const hooks = await runCompileHooks(g, registry, runner);
      const { source, warnings } = compile(g, registry, { hookResults: hooks.results, hookWarnings: hooks.warnings });
      expect(source).toContain("asyncio.sleep_ms(3000)");
      expect(source).toContain("if msg is not None:");
      expect(source).toMatch(/def \w*wifi_status_setup\(properties\):/);
      expect(warnings).toEqual([]);
    });

    it("the hook's errors stop the compile", async () => {
      const g = graph({ pollMs: 1000 });
      await expect(runCompileHooks(g, buildRegistry(), runner)).rejects.toThrow(/needs a WiFi network/);
    });
  });

  describe("the helpers the rest of the editor uses", () => {
    it("normalizeWifiConfigs keeps one WiFi config (unchanged)", () => {
      const info = normalizeWifiConfigs(
        [{ type: TYPE, properties: { wifiConfigId: "b" } }],
        [
          { id: "a", type: WIFI, properties: {} },
          { id: "b", type: WIFI, properties: {} },
        ],
      );
      expect(info.configs.map((c) => c.id)).toEqual(["b"]);
    });

    it("computeWifiProvisionMarker still reads the flow's one unmanaged config (unchanged)", () => {
      expect(
        computeWifiProvisionMarker({
          nodes: [node({}, "1")],
          configs: [{ id: "w", type: WIFI, properties: { security: "unmanaged", allowReprovisioning: true } }],
        }),
      ).toEqual({ selfProvision: true, allowReprovision: true });
    });
  });
});

describe("computeWifiProvisionMarker", () => {
  it("returns null when there is no wifi_status node at all", () => {
    expect(computeWifiProvisionMarker({ nodes: [] })).toBeNull();
  });

  it("returns null when the flow has two WiFi configs (ambiguous, left to compile()'s own CompileError)", () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "w1" } }],
      configs: [
        { id: "w1", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } },
        { id: "w2", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } },
      ],
    };
    expect(computeWifiProvisionMarker(graph)).toBeNull();
  });

  it("uses the flow's WiFi config with no wifi_status node, when another node needs WiFi", () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/udp_send", properties: {} }],
      configs: [{ id: "w1", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } }],
    };
    expect(computeWifiProvisionMarker(graph)).toEqual({ selfProvision: true, allowReprovision: false });
  });

  it("returns null when no node in the flow uses WiFi, even with an unmanaged WiFi config left over", () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/debug", properties: {} }],
      configs: [{ id: "w1", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } }],
    };
    expect(computeWifiProvisionMarker(graph)).toBeNull();
  });

  it('returns null when the resolved config\'s security is not "unmanaged"', () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "w1" } }],
      configs: [{ id: "w1", type: "thingstudio/config/wifi", properties: { security: "password", ssid: "home", password: "x" } }],
    };
    expect(computeWifiProvisionMarker(graph)).toBeNull();
  });

  it("returns selfProvision:true, allowReprovision:false for an unmanaged config with the fallback off", () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "w1" } }],
      configs: [{ id: "w1", type: "thingstudio/config/wifi", properties: { security: "unmanaged", allowReprovisioning: false } }],
    };
    expect(computeWifiProvisionMarker(graph)).toEqual({ selfProvision: true, allowReprovision: false });
  });

  it("carries allowReprovision:true through when the config's own field is set", () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "w1" } }],
      configs: [{ id: "w1", type: "thingstudio/config/wifi", properties: { security: "unmanaged", allowReprovisioning: true } }],
    };
    expect(computeWifiProvisionMarker(graph)).toEqual({ selfProvision: true, allowReprovision: true });
  });

  it("returns null when wifiConfigId doesn't resolve to any config (dangling reference)", () => {
    const graph = {
      nodes: [{ id: "1", type: "thingstudio/wifi_status", properties: { wifiConfigId: "no-such-config" } }],
      configs: [],
    };
    expect(computeWifiProvisionMarker(graph)).toBeNull();
  });
});

describe("wifi_status NODE_STATUS (report_status)", () => {
  const connectedPreamble =
    "network.WLAN.CONNECTED = True\nnetwork.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.1', '8.8.8.8')";

  it("reports state connected with the IP as text", async () => {
    const { raw } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), { initial: connectedPreamble });
    expect(raw).toContain("NODE_STATUS node=1 state=connected text=192.168.1.42");
  });

  it("reports state disconnected with no text", async () => {
    const { raw } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), { initial: "network.WLAN.CONNECTED = False" });
    expect(raw).toContain("NODE_STATUS node=1 state=disconnected text=None");
  });

  it("does not report again on a poll with no change", async () => {
    const { raw } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), { initial: "network.WLAN.CONNECTED = False" });
    expect(raw.split("\n").filter((l) => l.startsWith("NODE_STATUS"))).toHaveLength(1);
  });

  it("reports again when the gateway changes while connected (the documented harmless redundancy)", async () => {
    const { raw } = await runTwice(graph({ pollMs: 1000 }, unmanaged()), {
      initial: connectedPreamble,
      between: "network.WLAN.IFCONFIG = ('192.168.1.42', '255.255.255.0', '192.168.1.254', '8.8.8.8')",
    });
    const lines = raw.split("\n").filter((l) => l.startsWith("NODE_STATUS"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("NODE_STATUS node=1 state=connected text=192.168.1.42");
    expect(lines[1]).toBe("NODE_STATUS node=1 state=connected text=192.168.1.42");
  });
});
