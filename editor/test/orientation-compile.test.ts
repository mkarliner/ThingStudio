import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { resolveOrientation } from "../src/node-library/orientation-shared.js";
import { displaySpiNode } from "../src/node-library/display-spi.js";

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
  properties: { controller: "st7789", sck: 12, mosi: 11, dc: 13, spiBus: 2, baudrate: 40000000, width: 240, height: 320, xstart: -1, ystart: -1, ...props },
});

function code(props: Record<string, unknown>): string {
  const r = displaySpiNode.codegenSink!(spi(props), ctx());
  return (r.statements ?? []).map((s) => s.code).join("\n");
}

describe("display_spi with an orientation", () => {
  it("90 turns the logical size and writes MV|MX", () => {
    const c = code({ orientation: "90", rotation: 0, dataLatchOrder: false, colorOrder: "rgb" });
    expect(c).toContain(", 320, 240,");
    expect(c).toContain("bytes([96])");
  });
  it("starts from the mounting: the default rotation 1 (MX) turned 90 is MV alone", () => {
    expect(code({ orientation: "90", dataLatchOrder: false, colorOrder: "rgb" })).toContain("bytes([32])");
  });
  it("0 keeps the panel size", () => {
    expect(code({ orientation: "0", dataLatchOrder: false })).toContain(", 240, 320,");
  });
  it("without an orientation nothing changes", () => {
    expect(code({})).toContain(", 240, 320,");
  });
  it("refuses a swapped mounting", () => {
    expect(() => code({ orientation: "90", rotation: 4 })).toThrow(/use 0 to 3/);
  });
  it("refuses offsets", () => {
    expect(() => code({ orientation: "90", xstart: 10, ystart: 20 })).toThrow(/panel offset/);
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
