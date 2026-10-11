// editor/src/node-library/neopixel.ts codegen.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { neopixelNode } from "../src/node-library/neopixel.js";
import { buildRegistry } from "../src/node-library/registry.js";

function ctx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    resolveConfig(): Record<string, unknown> {
      throw new Error("no configs");
    },
  };
}

function node(properties: Record<string, unknown>, id = "n1"): GraphNode {
  return { id, type: "thingstudio/neopixel", properties };
}

describe("thingstudio/neopixel node", () => {
  it("rejects a bad count, order and brightness", () => {
    expect(() => neopixelNode.codegenSink!(node({ pin: 13, count: 0 }), ctx())).toThrow(/count/);
    expect(() => neopixelNode.codegenSink!(node({ pin: 13, order: "BGR" }), ctx())).toThrow(/order/);
    expect(() => neopixelNode.codegenSink!(node({ pin: 13, brightness: 300 }), ctx())).toThrow(/brightness/);
  });

  it("is a sink with one any input and no output", () => {
    expect(neopixelNode.kind).toBe("sink");
    expect(neopixelNode.ports?.inputs?.[0]).toMatchObject({ name: "msg", type: "any" });
    expect(neopixelNode.ports?.outputs).toBeUndefined();
  });

  it("builds the strip with bpp from the order, and a colour helper in that order", () => {
    const grb = neopixelNode.codegenSink!(node({ pin: 13, count: 4, order: "GRB" }), ctx());
    expect(grb.imports).toContain("import neopixel");
    expect(grb.statements?.[0]?.code).toContain("neopixel.NeoPixel(machine.Pin(13), 4, bpp=3)");
    // GRB: green (>>8) comes first in the tuple
    expect(grb.statements?.[1]?.code).toMatch(/return \(\(\(_c >> 8\)/);
    const rgbw = neopixelNode.codegenSink!(node({ pin: 13, order: "RGBW" }), ctx());
    expect(rgbw.statements?.[0]?.code).toContain("bpp=4");
    expect(rgbw.statements?.[1]?.code).toContain(">> 24"); // white channel
  });

  it("writes the strip and reports a bad payload instead of raising", () => {
    const r = neopixelNode.codegenSink!(node({ pin: 13, count: 3 }), ctx());
    expect(r.functionBody).toContain(".write()");
    expect(r.functionBody).toContain("isinstance(_p, dict)");
    expect(r.functionBody).toContain("except Exception as _e:");
    expect(r.functionBody).toContain("runtime.report_status");
  });

  it("compiles through a flow (inject -> neopixel)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: {} },
        { id: "2", type: "thingstudio/neopixel", properties: { pin: 13, count: 4, order: "GRB" } },
      ],
      links: [[1, "1", 0, "2", 0, "any"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("neopixel.NeoPixel(machine.Pin(13), 4, bpp=3)");
    expect(source).toContain(".write()");
  });
});
