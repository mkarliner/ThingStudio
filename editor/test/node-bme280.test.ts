// bme280 (editor/src/node-library/bme280.ts) and the shared I2C bus config (i2c-shared.ts). The generated
// read runs in real CPython against the real vendored driver (device-runtime/src/vendor/bme280/) and a fake
// I2C bus holding the Bosch datasheet's worked example (fixtures/pymock/fake_bme280_i2c.py).

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
import { bme280Node } from "../src/node-library/bme280.js";
import { I2C_BUS_CONFIG_TYPE, migrateI2cBusConfigs } from "../src/node-library/i2c-shared.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYMOCK = join(__dirname, "fixtures", "pymock");
const VENDOR = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "bme280");

const BUS0 = { id: "bus0", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: 22, sda: 21, freq: 100000 } };

function ctxWith(configs: { id: string; type: string; properties: Record<string, unknown> }[] = [BUS0], nodes: GraphNode[] = []): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    resolveConfig(id: string): Record<string, unknown> {
      const c = configs.find((x) => x.id === id);
      if (!c) throw new CompileError(`referenced config "${id}" not found`);
      return c.properties;
    },
    findNodesOfType: (type) => nodes.filter((n) => n.type === type),
    findConfigsOfType: (type) => configs.filter((c) => c.type === type),
  };
}

function node(properties: Record<string, unknown>, id = "b1"): GraphNode {
  return { id, type: "thingstudio/bme280", properties: { i2cConfigId: "bus0", ...properties } };
}

function indent(code: string): string {
  return code
    .split("\n")
    .map((l) => (l.length ? "    " + l : l))
    .join("\n");
}

/** Runs the node's read `steps.length` times. Each step is Python run first against the fake bus `_bus`
 * (e.g. "_bus.present = False"); prints the msg (or None) after each read, plus any status lines. */
function run(properties: Record<string, unknown>, steps: string[], chipId = 0x60): string[] {
  const r = bme280Node.codegenSource!(node(properties), ctxWith());
  const reads = steps.map((s) => `    ${s || "pass"}\n    print(repr(await _read()))`).join("\n");
  const lines = [
    "import builtins",
    "builtins.const = lambda x: x", // MicroPython builtin the driver uses
    "import sys",
    "import runtime",
    "sys.modules['uasyncio'] = runtime.asyncio", // has sleep_ms, unlike CPython's asyncio
    ...(r.imports ?? []),
    ...(r.statements ?? []).map((s) => s.code),
    "from fake_bme280_i2c import FakeI2C",
    `_bus = FakeI2C(chip_id=${chipId})`,
    "_i2c_bus_0 = _bus",
    "",
    "async def _read():",
    indent(r.buildMsg),
    "    return msg",
    "",
    "async def _main():",
    reads,
    "",
    "runtime.asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-bme280-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: `${PYMOCK}:${VENDOR}` }, encoding: "utf8" });
  return out
    .trim()
    .split("\n")
    .filter((l) => !l.startsWith("I2C_INIT") && !l.startsWith("PIN_INIT"));
}

const READING = "{'payload': {'temperature': 25.08, 'humidity':";

describe("thingstudio/bme280 node", () => {
  it("reads the sensor into a dict payload and reports connected once", () => {
    const out = run({}, ["", ""]);
    expect(out[0]).toBe("NODE_STATUS node=b1 state=connected text=BME280");
    expect(out[1]).toContain(READING);
    expect(out[1]).toContain("'pressure': 1006.53}");
    expect(out[1]).toContain("'topic': ''");
    expect(out[2]).toContain(READING); // second read: no repeated status line
    expect(out).toHaveLength(3);
  });

  it("a BMP280 works, with humidity None", () => {
    const out = run({}, [""], 0x58);
    expect(out[0]).toBe("NODE_STATUS node=b1 state=connected text=BMP280");
    expect(out[1]).toContain("'humidity': None");
  });

  it("an unplugged sensor sends nothing, shows disconnected, and recovers when it's back", () => {
    const out = run({}, ["", "_bus.present = False", "", "_bus.present = True"]);
    expect(out).toEqual([
      "NODE_STATUS node=b1 state=connected text=BME280",
      expect.stringContaining(READING),
      "NODE_STATUS node=b1 state=disconnected text=no reply at 0x76 on I2C bus 0",
      "None",
      "None",
      "NODE_STATUS node=b1 state=connected text=BME280",
      expect.stringContaining(READING),
    ]);
  });

  it("the wrong chip is an error status with the chip id, and the flow keeps going", () => {
    const out = run({}, ["", ""], 0x55);
    expect(out).toEqual(["NODE_STATUS node=b1 state=error text=no BME280/BMP280 at 0x76 (chip id 0x55)", "None", "None"]);
  });

  it("the wrong address shows disconnected", () => {
    expect(run({ address: 0x77 }, [""])[0]).toBe("NODE_STATUS node=b1 state=disconnected text=no reply at 0x77 on I2C bus 0");
  });

  it("rejects a bad address or interval, and a missing bus", () => {
    expect(() => bme280Node.codegenSource!(node({ address: 0x50 }), ctxWith())).toThrow(/0x76/);
    expect(() => bme280Node.codegenSource!(node({ intervalMs: 10 }), ctxWith())).toThrow(/100 or more/);
    expect(() => bme280Node.codegenSource!(node({ i2cConfigId: "" }), ctxWith())).toThrow(/has no I2C bus/);
  });
});

describe("shared I2C bus", () => {
  const bmeNode = { id: "b1", type: "thingstudio/bme280", properties: { i2cConfigId: "bus0", intervalMs: 1000 } };
  const displayNode = { id: "d1", type: "thingstudio/display_i2c", properties: { i2cConfigId: "bus0", width: 16, height: 8 } };

  it("a display and a sensor on one bus share one machine.I2C", () => {
    const graph: GraphData = { nodes: [bmeNode, displayNode], links: [[1, "b1", 0, "d1", 0, "any"]], configs: [BUS0] } as GraphData;
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/machine\.I2C\(/g)).toHaveLength(1);
    expect(source).toContain(
      "_i2c_bus_0 = runtime.shared('i2c', 0, (22, 21, 100000), lambda: machine.I2C(0, scl=machine.Pin(22), sda=machine.Pin(21), freq=100000))",
    );
  });

  it("two in-use configs claiming the same bus are a compile error", () => {
    const other = { id: "bus0b", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: 5, sda: 4, freq: 100000 } };
    const d = { ...displayNode, properties: { ...displayNode.properties, i2cConfigId: "bus0b" } };
    const graph: GraphData = { nodes: [bmeNode, d], links: [[1, "b1", 0, "d1", 0, "any"]], configs: [BUS0, other] } as GraphData;
    expect(() => compile(graph, buildRegistry())).toThrow(/both say bus 0/);
  });

  it("names a missing pin", () => {
    const noPins = { id: "bus0", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: null, sda: 21 } };
    expect(() => bme280Node.codegenSource!(node({}), ctxWith([noPins]))).toThrow(/I2C bus 0 has no SCL pin set/);
  });

  it("migrates an old display_i2c's own pins into a bus config, reusing one for the same bus", () => {
    const old = (id: string, scl: number) => ({ id, type: "thingstudio/display_i2c", properties: { i2cBus: 0, scl, sda: 21, freq: 400000, addr: 60 } });
    let n = 0;
    const r = migrateI2cBusConfigs([old("d1", 22), old("d2", 23)], [], () => `new${n++}`);
    expect(r.moved).toBe(2);
    expect(r.configs).toEqual([{ id: "new0", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: 22, sda: 21, freq: 400000 } }]);
    expect(r.nodes.map((x) => x.properties)).toEqual([
      { addr: 60, i2cConfigId: "new0" },
      { addr: 60, i2cConfigId: "new0" },
    ]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain("SCL 23");
  });

  it("leaves nodes that already use a bus config alone", () => {
    const r = migrateI2cBusConfigs([displayNode], [BUS0], () => "x");
    expect(r.moved).toBe(0);
    expect(r.nodes[0]).toBe(displayNode);
  });
});
