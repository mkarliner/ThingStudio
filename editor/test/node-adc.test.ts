// adc as a core package (2026-10-21): the hook validates the mode/bounds/poll, the descriptor's pin resource carries
// the classic-ESP32 ADC2+WiFi refusal, and the Python wraps AADC over a shared ADC. Text-level codegen; the AADC
// driver itself is vendored and covered by the hardware pass.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphData } from "../src/compiler/graph.js";
import type { ProcessorDef } from "../src/definitions/definitions.js";
import type { Target } from "../src/definitions/target.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { compileWithHooks } from "./compile-with-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const registry = buildRegistry();
const TYPE = "thingstudio/adc";

function target(): Target {
  const gpio = new Set<number>();
  for (let i = 0; i <= 48; i++) gpio.add(i);
  const processor: ProcessorDef = {
    id: "esp32",
    name: "ESP32",
    match: [],
    nativeArch: "xtensawin",
    nativeArchConfirmed: true,
    capabilities: new Set(),
    gpio,
    inputOnly: new Set(),
    noPull: new Set(),
    adc2: new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27]),
    reserved: new Map(),
    avoid: new Map(),
    spi: null,
    i2c: null,
    notes: "",
    flash: null,
  };
  return {
    processor, board: null, label: "ESP32", gpio, inputOnly: new Set(), noPull: new Set(),
    reserved: new Map(), avoid: new Map(), pinLabels: new Map(), capabilities: new Set(),
  };
}

function graph(properties: Record<string, unknown>, wifi = false): GraphData {
  const nodes: GraphData["nodes"] = [{ id: "a1", type: TYPE, properties }];
  const configs = wifi ? [{ id: "w1", type: "thingstudio/config/wifi", properties: { ssid: "net", password: "pw" } }] : [];
  if (wifi) nodes.push({ id: "w", type: "thingstudio/wifi_status", properties: { wifiConfigId: "w1" } });
  return { nodes, links: [], configs };
}

async function hookError(properties: Record<string, unknown>): Promise<string | undefined> {
  try {
    await runCompileHooks(graph(properties), registry, runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function sourceFor(properties: Record<string, unknown>, options: Parameters<typeof compileWithHooks>[2] = {}): Promise<string> {
  return (await compileWithHooks(graph(properties), registry, options)).source;
}

describe("thingstudio/adc package", () => {
  it("rejects a bad mode, an inverted range and a non-positive delta", async () => {
    expect(await hookError({ pin: 34, mode: "sideways" })).toMatch(/relative or absolute/);
    expect(await hookError({ pin: 34, mode: "absolute", lower: 10, upper: 5 })).toMatch(/less than/);
    expect(await hookError({ pin: 34, mode: "relative", delta: 0 })).toMatch(/more than 0/);
  });

  it("shares the ADC channel through runtime.shared and wraps AADC", async () => {
    const source = await sourceFor({ pin: 34 });
    expect(source).toContain("from aadc import AADC");
    expect(source).toContain("runtime.shared('adc'");
    expect(source).toContain('"pin": 34');
    expect(source).toContain("AADC(");
  });

  it("emits a dict payload with raw, volts and percent", async () => {
    const source = await sourceFor({ pin: 34 });
    expect(source).toContain("'raw'");
    expect(source).toContain("'volts'");
    expect(source).toContain("'percent'");
  });

  it("passes absolute bounds, and a poll timeout when pollMs is set", async () => {
    const abs = await sourceFor({ pin: 34, mode: "absolute", lower: 1000, upper: 50000 });
    expect(abs).toContain("await _aadc(_lower, _upper)");
    const polled = await sourceFor({ pin: 34, mode: "relative", delta: 2000, pollMs: 500 });
    expect(polled).toContain("asyncio.wait_for(_bounds(), _poll / 1000)");
    expect(polled).toContain("asyncio.TimeoutError");
  });

  it("sets AADC sense(False) for sense=inside", async () => {
    const source = await sourceFor({ pin: 34, sense: "inside" });
    expect(source).toContain('"senseInside": True');
    expect(source).toContain("_normal = not properties['senseInside']");
  });

  it("refuses an ESP32 ADC2 pin when the flow uses WiFi, and allows ADC1 or no WiFi", async () => {
    const targetDef = target();
    await expect(compileWithHooks(graph({ pin: 25 }, true), registry, { target: targetDef })).rejects.toThrow(/ADC2 pin/);
    await expect(compileWithHooks(graph({ pin: 25 }), registry, { target: targetDef })).resolves.toBeDefined();
    await expect(compileWithHooks(graph({ pin: 34 }, true), registry, { target: targetDef })).resolves.toBeDefined();
  });

  // Runs the generated flow in CPython against pymock's ADC and AADC stand-ins: the reading follows a script, and the
  // debug lines show what the node sent.
  async function runAdc(properties: Record<string, unknown>, script: [number, number][]): Promise<string> {
    const g: GraphData = {
      nodes: [{ id: "a1", type: TYPE, properties }, { id: "d1", type: "thingstudio/debug", properties: {} }],
      links: [[1, "a1", 0, "d1", 0, "any"]],
      configs: [],
    };
    const source = (await compileWithHooks(g, registry, {})).source.split("\n").filter((l) => !l.startsWith("runtime.spawn(")).join("\n");
    const driver = `
import asyncio, machine
SCRIPT = ${JSON.stringify(script)}
async def _drive():
    for ms, v in SCRIPT:
        machine.ADC.value = v
        await asyncio.sleep(ms / 1000)
async def _main():
    t = asyncio.create_task(_flow_0())
    await _drive()
    t.cancel()
asyncio.run(_main())
`;
    const dir = mkdtempSync(join(tmpdir(), "thingstudio-adc-"));
    const file = join(dir, "_flow.py");
    writeFileSync(file, source + "\n" + driver);
    return execFileSync("python3", [file], { env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") }, encoding: "utf8", timeout: 15_000 });
  }

  it("absolute mode sends once per crossing, not on every poll while the reading stays outside", async () => {
    const out = await runAdc({ pin: 34, mode: "absolute", lower: 100, upper: 200 }, [[50, 150], [100, 300], [50, 150], [100, 50], [50, 150]]);
    const sent = out.split("\n").filter((l) => l.startsWith("DEBUG")).map((l) => /'raw': (\d+)/.exec(l)![1]);
    expect(sent).toEqual(["300", "50"]);
  });

  it("absolute mode with sense inside sends once each time the reading comes back", async () => {
    const out = await runAdc({ pin: 34, mode: "absolute", lower: 100, upper: 200, sense: "inside" }, [[50, 300], [100, 150], [50, 300], [100, 120], [50, 300]]);
    const sent = out.split("\n").filter((l) => l.startsWith("DEBUG")).map((l) => /'raw': (\d+)/.exec(l)![1]);
    expect(sent).toEqual(["150", "120"]);
  });
});
