// display_spi as a core package (2026-10-21): the hook computes geometry/MADCTL and the Python drives the real
// vendored ST77xx driver against pymock's SPI. Runs a full RGB565 frame and an odd-width gs4 frame end to end.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphData } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const registry = buildRegistry();
const TYPE = "thingstudio/display_spi";
const pymockDir = join(__dirname, "fixtures", "pymock");
const vendor7789 = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "st7789py_mpy");
const vendor7796 = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "st7796py");

const BASE: Record<string, unknown> = {
  controller: "st7789", frameFormat: "rgb565", spiBus: 2, baudrate: 40000000,
  sck: 12, mosi: 11, dc: 13, cs: -1, reset: -1, backlight: -1,
  width: 135, height: 240, rotation: 1, colorOrder: "bgr", invertColors: false,
  dataLatchOrder: true, xstart: -1, ystart: -1,
  palette: [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0x07ff, 0xf81f, 0x8410, 0x4208, 0xc618, 0xfd20, 0x8000, 0x0400, 0x0010, 0x0410],
};

function graph(properties: Record<string, unknown>): GraphData {
  return { nodes: [{ id: "1", type: TYPE, properties: { ...BASE, ...properties } }], links: [] };
}

async function hookError(properties: Record<string, unknown>): Promise<string | undefined> {
  try {
    await runCompileHooks(graph(properties), registry, runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function ctx(hookResult?: (id: string) => unknown): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    hookResult: hookResult as CodegenContext["hookResult"],
    resolveConfig: () => ({}),
    findNodesOfType: () => [],
    findConfigsOfType: () => [],
  };
}

async function sinkFor(properties: Record<string, unknown>) {
  const g = graph(properties);
  const hooks = await runCompileHooks(g, registry, runner);
  return registry.get(TYPE)!.codegenSink!(g.nodes[0]!, ctx((id) => hooks.results.get(id)));
}

async function runSink(properties: Record<string, unknown>, payloadHex: string, y?: number): Promise<string> {
  const result = await sinkFor(properties);
  const lines = [
    "import time",
    "import sys",
    "import machine",
    "import time_mock",
    "sys.modules['time'] = time_mock",
    "import runtime",
    "asyncio = runtime.asyncio",
    "ptr8 = ptr16 = ptr32 = int",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    `_spi_obj = runtime._singletons[('spi', ${Number(properties.spiBus ?? 2)})][1]`,
    "_before = len(_spi_obj.writes)",
    `async def ${result.functionName}(msg):`,
    ...result.functionBody.split("\n").map((l) => `    ${l}`),
    "",
    `msg = {'payload': bytes.fromhex('${payloadHex}'), 'topic': ''${y === undefined ? "" : `, 'y': ${y}`}}`,
    `asyncio.run(${result.functionName}(msg))`,
    `print('PAYLOAD_WRITES', ' '.join(w.hex() for w in _spi_obj.writes[_before:]))`,
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-display-spi-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: `${pymockDir}${delimiter}${vendor7789}${delimiter}${vendor7796}` },
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("thingstudio/display_spi package", () => {
  it("defaults to CYD's confirmed config: bgr, latch order, rotation 1, MADCTL 0x4c", async () => {
    const hooks = await runCompileHooks(graph({}), registry, runner);
    const props = hooks.results.get("1")!.properties as { madctl: number; width: number; height: number };
    expect(props.madctl).toBe(0x4c);
    expect(props.width).toBe(135);
    expect(props.height).toBe(240);
  });

  it("reproduces TiDAL's explicit rgb/invert/false/latch-0/rotation-0 config", async () => {
    const hooks = await runCompileHooks(
      graph({ colorOrder: "rgb", invertColors: true, dataLatchOrder: false, rotation: 0, xstart: 52, ystart: 40, width: 135, height: 240 }),
      registry,
      runner,
    );
    const props = hooks.results.get("1")!.properties as { madctl: number };
    expect(props.madctl).toBe(0);
  });

  it("builds the driver, writes MADCTL and expands an odd-width gs4 frame correctly", async () => {
    const output = await runSink({ sck: 12, mosi: 11, dc: 13, width: 3, height: 2, xstart: 0, ystart: 0, frameFormat: "gs4" }, "012f345f");
    const writes = output.match(/PAYLOAD_WRITES (.+)/)?.[1]?.trim().split(" ") ?? [];
    expect(writes[writes.length - 1]).toBe("0000fffff80007e0001fffe0");
    expect(output).toContain("SPI_INIT");
  });

  it("blits a full RGB565 frame", async () => {
    const output = await runSink({ sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, "00".repeat(32));
    expect(output).toContain("PAYLOAD_WRITES");
  });

  it("rejects a wrong-length full frame with the real row-padded byte count", async () => {
    await expect(runSink({ sck: 12, mosi: 11, dc: 13, width: 3, height: 2, xstart: 0, ystart: 0, frameFormat: "gs4" }, "010203")).rejects.toThrow(/expected 4 bytes/);
  });

  it("rejects unknown controller/format, a bad palette and an orientation with offsets", async () => {
    expect(await hookError({ controller: "ili9341" })).toMatch(/st7789 or st7796/);
    expect(await hookError({ frameFormat: "rgb888" })).toMatch(/rgb565, gs4, gs2 or mono/);
    expect(await hookError({ frameFormat: "gs4", palette: [0] })).toMatch(/exactly 16/);
    expect(await hookError({ orientation: "90", xstart: 0 })).toMatch(/isn't supported with a panel offset/);
  });

  it("declares one bytes frame input, no outputs", () => {
    const def = registry.get(TYPE)!;
    expect(def.ports?.inputs).toEqual([{ name: "frame", type: "bytes" }]);
    expect(def.ports?.outputs).toBeUndefined();
  });
});
