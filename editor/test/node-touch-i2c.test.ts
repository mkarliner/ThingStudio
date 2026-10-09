// touch_i2c (editor/src/node-library/touch-i2c.ts) and the touch panel config it reads (touch-panel-shared.ts): the
// generated poll runs in real CPython against the real vendored driver (device-runtime/src/vendor/ft6336u/) and a
// fake I2C bus (fixtures/pymock/fake_ft6336u_i2c.py).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { I2C_BUS_CONFIG_TYPE } from "../src/node-library/i2c-shared.js";
import { touchI2cNode } from "../src/node-library/touch-i2c.js";
import { TOUCH_PANEL_CONFIG_TYPE } from "../src/node-library/touch-panel-shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYMOCK = join(__dirname, "fixtures", "pymock");
const VENDOR = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "ft6336u");

const BUS0 = { id: "bus0", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: 15, sda: 16, freq: 400000 } };

const PANEL_DEFAULTS = { controller: "ft6336u", i2cConfigId: "bus0", address: "0x38", rstPin: "", pollMs: 20, width: 320, height: 480, swapXY: false, flipX: false, flipY: false };

/** `panelProps` override the touch panel config; `others` are other nodes in the flow (for the sharing check). */
function ctx(panelProps: Record<string, unknown> = {}, others: GraphNode[] = []): CodegenContext {
  const used = new Set<string>();
  const panel = { id: "panel0", type: TOUCH_PANEL_CONFIG_TYPE, properties: { ...PANEL_DEFAULTS, ...panelProps } };
  const nodes = [node(), ...others];
  return {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    resolveConfig(id: string): Record<string, unknown> {
      if (id === "bus0") return BUS0.properties;
      if (id === "panel0") return panel.properties;
      throw new CompileError(`referenced config "${id}" not found`);
    },
    findNodesOfType: (t) => nodes.filter((n) => n.type === t),
    findConfigsOfType: (t) => (t === I2C_BUS_CONFIG_TYPE ? [BUS0] : t === TOUCH_PANEL_CONFIG_TYPE ? [panel] : []),
  };
}

function node(properties: Record<string, unknown> = {}): GraphNode {
  return { id: "t1", type: "thingstudio/touch_i2c", properties: { touchPanelConfigId: "panel0", ...properties } };
}

const indent = (code: string) => code.split("\n").map((l) => (l.length ? "    " + l : l)).join("\n");

/** Runs the poll once per step; each step is Python run first against the fake bus `_bus`. Prints the msg. */
function run(panelProps: Record<string, unknown>, steps: string[]): string[] {
  const r = touchI2cNode.codegenSource!(node(), ctx(panelProps));
  const reads = steps.map((s) => `    ${s || "pass"}\n    print(repr(await _read()))`).join("\n");
  const lines = [
    "import sys",
    "import runtime",
    ...(r.imports ?? []),
    ...(r.statements ?? []).map((s) => s.code),
    "from fake_ft6336u_i2c import FakeI2C",
    "_bus = FakeI2C()",
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
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-touch-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: `${PYMOCK}:${VENDOR}` }, encoding: "utf8" });
  return out.trim().split("\n").filter((l) => !l.startsWith("I2C_INIT") && !l.startsWith("PIN_INIT"));
}

const CONNECTED = "NODE_STATUS node=t1 state=connected text=FT6336U";

describe("thingstudio/touch_i2c node", () => {
  it("sends down once when a finger lands and up, at the last position, when it lifts", () => {
    const out = run({}, ["", "_bus.touch = (100, 200)", "_bus.touch = (101, 202)", "_bus.touch = None", ""]);
    expect(out).toEqual([
      CONNECTED,
      "None", // nothing touching
      "{'payload': {'x': 100, 'y': 200}, 'topic': 'down'}",
      "None", // still down, moving: no event (down and up only)
      "{'payload': {'x': 101, 'y': 202}, 'topic': 'up'}",
      "None",
    ]);
  });

  it("rotates coordinates with swap and flip", () => {
    const out = run({ swapXY: true, flipX: true }, ["_bus.touch = (10, 20)"]);
    expect(out[1]).toBe("{'payload': {'x': 459, 'y': 10}, 'topic': 'down'}");
  });

  it("an unplugged panel sends nothing and shows disconnected; it recovers; a lift while unplugged is not lost", () => {
    const out = run({}, ["_bus.present = False", "_bus.present = True; _bus.touch = (5, 6)"]);
    expect(out).toEqual([
      "NODE_STATUS node=t1 state=disconnected text=no reply from FT6336U at 0x38 on I2C bus 0",
      "None",
      CONNECTED,
      "{'payload': {'x': 5, 'y': 6}, 'topic': 'down'}",
    ]);
  });

  it("rejects bad settings, a missing bus and a missing panel", () => {
    expect(() => touchI2cNode.codegenSource!(node(), ctx({ pollMs: 1 }))).toThrow(/poll interval/);
    expect(() => touchI2cNode.codegenSource!(node(), ctx({ address: "0x90" }))).toThrow(/0x08 to 0x77/);
    expect(() => touchI2cNode.codegenSource!(node(), ctx({ i2cConfigId: "" }))).toThrow(/has no I2C bus/);
    expect(() => touchI2cNode.codegenSource!(node(), ctx({ controller: "gt911" }))).toThrow(/FT6336U only/);
    expect(() => touchI2cNode.codegenSource!(node({ touchPanelConfigId: "" }), ctx())).toThrow(/has no touch panel/);
  });

  it("drives the reset pin when one is set", () => {
    const r = touchI2cNode.codegenSource!(node(), ctx({ rstPin: 18 }));
    expect(r.buildMsg).toContain("machine.Pin(18, machine.Pin.OUT)");
    expect(r.repeatMs).toBe(20);
    expect(r.imports).toContain("import ft6336u");
  });

  it("refuses a panel a gui screen or a second touch node also uses, naming both", () => {
    const screen: GraphNode = { id: "s1", type: "thingstudio/gui_screen", properties: { name: "tft", touchPanelConfigId: "panel0" } };
    expect(() => touchI2cNode.codegenSource!(node(), ctx({}, [screen]))).toThrow(/touch t1.*"tft"|"tft".*touch t1|t1.*"tft"/);
    const other: GraphNode = { id: "t2", type: "thingstudio/touch_i2c", properties: { touchPanelConfigId: "panel0" } };
    expect(() => touchI2cNode.codegenSource!(node(), ctx({}, [other]))).toThrow(/same touch panel/);
    const unrelated: GraphNode = { id: "s2", type: "thingstudio/gui_screen", properties: { touchPanelConfigId: "someone-else" } };
    expect(() => touchI2cNode.codegenSource!(node(), ctx({}, [unrelated]))).not.toThrow();
  });
});
