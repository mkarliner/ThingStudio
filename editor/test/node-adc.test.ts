// adc as a core package (2026-10-21): the hook validates the mode/bounds/poll, the descriptor's pin resource carries
// the classic-ESP32 ADC2+WiFi refusal, and the Python wraps AADC over a shared ADC. Text-level codegen; the AADC
// driver itself is vendored and covered by the hardware pass.

import { readFileSync } from "node:fs";
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
    expect(source).toContain("_aadc.sense(False)");
  });

  it("refuses an ESP32 ADC2 pin when the flow uses WiFi, and allows ADC1 or no WiFi", async () => {
    const targetDef = target();
    await expect(compileWithHooks(graph({ pin: 25 }, true), registry, { target: targetDef })).rejects.toThrow(/ADC2 pin/);
    await expect(compileWithHooks(graph({ pin: 25 }), registry, { target: targetDef })).resolves.toBeDefined();
    await expect(compileWithHooks(graph({ pin: 34 }, true), registry, { target: targetDef })).resolves.toBeDefined();
  });
});
