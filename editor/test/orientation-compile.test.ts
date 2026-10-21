// Display orientation: the display_spi hook computes the turned size and MADCTL (2026-10-21, moved from codegen);
// gui screens still follow their wired display through resolveOrientation.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { resolveOrientation } from "../src/node-library/orientation-shared.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const registry = buildRegistry();

function ctx(): CodegenContext {
  let n = 0;
  return {
    uniqueName: (h) => `_${h}_${++n}`,
    resolveConfig: (id) => {
      throw new Error(`no config ${id}`);
    },
  } as CodegenContext;
}

const spi = (props: Record<string, unknown>): GraphNode => ({
  id: "1",
  type: "thingstudio/display_spi",
  properties: {
    controller: "st7789", frameFormat: "rgb565", spiBus: 2, baudrate: 40000000,
    sck: 12, mosi: 11, dc: 13, cs: -1, reset: -1, backlight: -1,
    width: 240, height: 320, rotation: 1, xstart: -1, ystart: -1,
    colorOrder: "bgr", invertColors: false, dataLatchOrder: true,
    palette: [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0x07ff, 0xf81f, 0x8410, 0x4208, 0xc618, 0xfd20, 0x8000, 0x0400, 0x0010, 0x0410],
    ...props,
  },
});

async function code(props: Record<string, unknown>): Promise<{ width: number; height: number; madctl: number }> {
  const graph = { nodes: [spi(props)], links: [] };
  const hooks = await runCompileHooks(graph, registry, runner);
  return hooks.results.get("1")!.properties as { width: number; height: number; madctl: number };
}

async function hookError(props: Record<string, unknown>): Promise<string | undefined> {
  try {
    await code(props);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("display_spi with an orientation", () => {
  it("90 turns the logical size and gives MV|MX", async () => {
    const p = await code({ orientation: "90", rotation: 0, dataLatchOrder: false, colorOrder: "rgb" });
    expect([p.width, p.height]).toEqual([320, 240]);
    expect(p.madctl).toBe(96);
  });
  it("starts from the mounting: default rotation 1 turned 90 is MV alone", async () => {
    expect((await code({ orientation: "90", dataLatchOrder: false, colorOrder: "rgb" })).madctl).toBe(32);
  });
  it("0 keeps the panel size", async () => {
    const p = await code({ orientation: "0", dataLatchOrder: false });
    expect([p.width, p.height]).toEqual([240, 320]);
  });
  it("without an orientation nothing changes", async () => {
    const p = await code({});
    expect([p.width, p.height]).toEqual([240, 320]);
  });
  it("refuses a swapped mounting", async () => {
    expect(await hookError({ orientation: "90", rotation: 4 })).toMatch(/use 0 to 3/);
  });
  it("refuses offsets", async () => {
    expect(await hookError({ orientation: "90", xstart: 10, ystart: 20 })).toMatch(/panel offset/);
  });
});

describe("a gui screen follows the display it is wired to", () => {
  const screen: GraphNode = { id: "s", type: "thingstudio/gui_screen", properties: {} };
  const wired = (targets: GraphNode[]): CodegenContext => ({ ...ctx(), findWiredTargets: () => targets }) as CodegenContext;
  it("takes the angle from its display", () => {
    expect(resolveOrientation(wired([spi({ orientation: "270" })]), screen, "gui_screen")).toBe(270);
  });
  it("is raw when the display has none, or no display is wired", () => {
    expect(resolveOrientation(wired([spi({ orientation: "" })]), screen, "gui_screen")).toBeNull();
    expect(resolveOrientation(wired([]), screen, "gui_screen")).toBeNull();
  });
  it("rejects a bad angle", () => {
    expect(() => resolveOrientation(ctx(), spi({ orientation: "45" }), "display_spi")).toThrow(/must be 0, 90/);
  });
});
