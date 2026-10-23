// touch_i2c as a core package (2026-10-21): the hook resolves the touch-panel config and its nested I2C bus, the
// generic resource codegen claims the bus, and the Python polls the real vendored FT6336U driver against pymock's
// fake I2C bus.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { I2C_BUS_CONFIG_TYPE } from "../src/node-library/i2c-shared.js";
import { TOUCH_PANEL_CONFIG_TYPE } from "../src/node-library/touch-panel-shared.js";
import { orientedTouch } from "../src/node-library/orientation-shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const registry = buildRegistry();
const TYPE = "thingstudio/touch_i2c";
const PYMOCK = join(__dirname, "fixtures", "pymock");
const VENDOR = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "ft6336u");

const BUS0 = { id: "bus0", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: 15, sda: 16, freq: 400000 } };
const PANEL_DEFAULTS = { controller: "ft6336u", i2cConfigId: "bus0", address: "0x38", rstPin: "", pollMs: 20, width: 320, height: 480, swapXY: false, flipX: false, flipY: false };

function node(panel = "panel0", extra: Record<string, unknown> = {}): GraphNode {
  return { id: "t1", type: TYPE, properties: { touchPanelConfigId: panel, ...extra } };
}

function graph(panelProps: Record<string, unknown> = {}, others: GraphData["nodes"] = [], nodeProps: Record<string, unknown> = {}): GraphData {
  return {
    nodes: [node("panel0", nodeProps), ...others],
    links: [],
    configs: [
      BUS0,
      { id: "panel0", type: TOUCH_PANEL_CONFIG_TYPE, properties: { ...PANEL_DEFAULTS, ...panelProps } },
    ],
  };
}

async function hookError(panelProps: Record<string, unknown> = {}, others: GraphData["nodes"] = [], panel = "panel0", nodeProps: Record<string, unknown> = {}): Promise<string | undefined> {
  const g = graph(panelProps, others, nodeProps);
  g.nodes[0] = node(panel, nodeProps);
  try {
    await runCompileHooks(g, registry, runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const indent = (code: string) => code.split("\n").map((l) => (l.length ? "    " + l : l)).join("\n");

async function run(panelProps: Record<string, unknown>, steps: string[]): Promise<string[]> {
  const g = graph(panelProps);
  const hooks = await runCompileHooks(g, registry, runner);
  const def = registry.get(TYPE)!;
  const used = new Set<string>();
  const ctx: CodegenContext = {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    hookResult: (id: string) => hooks.results.get(id),
    resolveConfig: (id: string) => {
      const c = (g.configs ?? []).find((x) => x.id === id);
      if (!c) throw new Error(`no config ${id}`);
      return c.properties;
    },
    findConfigsOfType: (t: string) => (g.configs ?? []).filter((c) => c.type === t),
    findNodesOfType: (t: string) => g.nodes.filter((n) => n.type === t),
  };
  const r = def.codegenSource!(g.nodes[0]!, ctx);
  const reads = steps.map((s) => `    ${s || "pass"}\n    print(repr(await _read()))`).join("\n");
  const lines = [
    "import runtime",
    "from fake_ft6336u_i2c import FakeI2C",
    "_fake = FakeI2C()",
    "runtime._singletons[('i2c', 0)] = ((15, 16, 400000), _fake)",
    ...(r.imports ?? []),
    ...(r.statements ?? []).map((s) => s.code),
    "_bus = _fake",
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
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-touch-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: `${PYMOCK}:${VENDOR}` }, encoding: "utf8" });
  return out.trim().split("\n").filter((l) => !l.startsWith("I2C_INIT") && !l.startsWith("PIN_INIT"));
}

const CONNECTED = "NODE_STATUS node=t1 state=connected text=FT6336U";

describe("thingstudio/touch_i2c package", () => {
  it("sends down once and up at the last position", async () => {
    const out = await run({}, ["", "_bus.touch = (100, 200)", "_bus.touch = (101, 202)", "_bus.touch = None", ""]);
    expect(out).toEqual([
      CONNECTED,
      "None",
      "{'payload': {'x': 100, 'y': 200}, 'topic': 'down'}",
      "None",
      "{'payload': {'x': 101, 'y': 202}, 'topic': 'up'}",
      "None",
    ]);
  });

  it("rotates coordinates with swap and flip", async () => {
    const out = await run({ swapXY: true, flipX: true }, ["_bus.touch = (10, 20)"]);
    expect(out[1]).toBe("{'payload': {'x': 459, 'y': 10}, 'topic': 'down'}");
  });

  it("an unplugged panel reports disconnected and recovers", async () => {
    const out = await run({}, ["_bus.present = False", "_bus.present = True; _bus.touch = (5, 6)"]);
    expect(out).toEqual([
      "NODE_STATUS node=t1 state=disconnected text=no reply from FT6336U at 0x38 on I2C bus 0",
      "None",
      CONNECTED,
      "{'payload': {'x': 5, 'y': 6}, 'topic': 'down'}",
    ]);
  });

  it("rejects bad settings, a missing bus and a missing panel", async () => {
    expect(await hookError({ pollMs: 1 })).toMatch(/poll interval/);
    expect(await hookError({ address: "0x90" })).toMatch(/0x08 to 0x77/);
    expect(await hookError({ i2cConfigId: "" })).toMatch(/has no I2C bus/);
    expect(await hookError({ controller: "gt911" })).toMatch(/FT6336U only/);
    expect(await hookError({}, [], "")).toMatch(/has no touch panel/);
  });

  it("turns coordinates with orientation, matching orientation-shared.ts for every base flag set", async () => {
    // The hook runs in Python (WASI) and the gui screen's rotation is TS, so the compose step exists twice. This is
    // the check that the two cannot drift: same angles, same panel flags, same result.
    const angles = [0, 90, 180, 270] as const;
    for (const swapXY of [false, true]) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          for (const angle of angles) {
            const g = graph({ swapXY, flipX, flipY, width: 320, height: 480 }, [], { orientation: String(angle) });
            const hooks = await runCompileHooks(g, registry, runner);
            const got = hooks.results.get("t1")?.properties as Record<string, unknown> | undefined;
            const want = orientedTouch({ swapXY, flipX, flipY }, angle, 320, 480);
            expect(
              got && { swapXY: got.swapXY, flipX: got.flipX, flipY: got.flipY },
              `base ${JSON.stringify({ swapXY, flipX, flipY })} at ${angle} degrees`,
            ).toEqual(want);
          }
        }
      }
    }
  });

  it("leaves the panel's own axes alone with no orientation", async () => {
    const g = graph({ swapXY: true, flipY: true }, [], { orientation: "" });
    const hooks = await runCompileHooks(g, registry, runner);
    const got = hooks.results.get("t1")!.properties as Record<string, unknown>;
    expect([got.swapXY, got.flipX, got.flipY]).toEqual([true, false, true]);
  });

  it("rejects an orientation that is not a quarter turn", async () => {
    expect(await hookError({}, [], "panel0", { orientation: "45" })).toMatch(/must be 0, 90, 180 or 270/);
  });

  it("refuses a panel shared with another touch node or a gui screen", async () => {
    const other = { id: "t2", type: TYPE, properties: { touchPanelConfigId: "panel0" } };
    expect(await hookError({}, [other])).toMatch(/both use the same touch panel/);
    const screen = { id: "s1", type: "thingstudio/gui_screen", properties: { touchPanelConfigId: "panel0" } };
    expect(await hookError({}, [screen])).toMatch(/both use the same touch panel/);
  });
});
