import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { displaySpiNode } from "../src/node-library/display-spi.js";

function ctx(angle: string | null): CodegenContext {
  let n = 0;
  return {
    uniqueName: (h) => `_${h}_${++n}`,
    resolveConfig: (id) => {
      if (id === "o" && angle !== null) return { angle };
      throw new Error(`no config ${id}`);
    },
  } as CodegenContext;
}

const spi = (props: Record<string, unknown>): GraphNode => ({
  id: "1",
  type: "thingstudio/display_spi",
  properties: { controller: "st7789", sck: 12, mosi: 11, dc: 13, spiBus: 2, baudrate: 40000000, width: 240, height: 320, xstart: -1, ystart: -1, ...props },
});

function code(props: Record<string, unknown>, angle: string | null = "90"): string {
  const r = displaySpiNode.codegenSink!(spi(props), ctx(angle));
  return (r.statements ?? []).map((s) => s.code).join("\n");
}

describe("display_spi with an orientation", () => {
  it("90 turns the logical size and writes MV|MX", () => {
    const c = code({ orientationConfigId: "o", rotation: 0, dataLatchOrder: false, colorOrder: "rgb" });
    expect(c).toContain(", 320, 240,");
    expect(c).toContain("bytes([96])");
  });
  it("starts from the mounting: the default rotation 1 (MX) turned 90 is MV alone", () => {
    expect(code({ orientationConfigId: "o", dataLatchOrder: false, colorOrder: "rgb" })).toContain("bytes([32])");
  });
  it("0 keeps the panel size", () => {
    expect(code({ orientationConfigId: "o", dataLatchOrder: false }, "0")).toContain(", 240, 320,");
  });
  it("without an orientation nothing changes", () => {
    expect(code({}, null)).toContain(", 240, 320,");
  });
  it("refuses a swapped mounting", () => {
    expect(() => code({ orientationConfigId: "o", rotation: 4 })).toThrow(/use 0 to 3/);
  });
  it("refuses offsets", () => {
    expect(() => code({ orientationConfigId: "o", xstart: 10, ystart: 20 })).toThrow(/panel offset/);
  });
});
