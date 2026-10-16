// neopixel as a core package (editor/src/node-library/core-packages/neopixel.ts) codegen.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { descriptor as neopixelDescriptor, python as neopixelPython } from "../src/node-library/core-packages/neopixel.js";
import { buildCoreNodeDefinition } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const neopixelNode = buildCoreNodeDefinition(neopixelDescriptor, neopixelPython);

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
  it("rejects a bad count and order", () => {
    expect(() => neopixelNode.codegenSink!(node({ pin: 13, count: 0 }), ctx())).toThrow(/count/);
    expect(() => neopixelNode.codegenSink!(node({ pin: 13, order: "BGR" }), ctx())).toThrow(/order/);
  });

  it("is a sink with one any input and no output", () => {
    expect(neopixelNode.kind).toBe("sink");
    expect(neopixelNode.ports?.inputs?.[0]).toMatchObject({ name: "msg", type: "any" });
    expect(neopixelNode.ports?.outputs).toBeUndefined();
  });

  it("builds the strip with bpp from the order, and a colour helper in that order", () => {
    const grb = neopixelNode.codegenSink!(node({ pin: 13, count: 4, order: "GRB" }), ctx());
    const grbCode = (grb.statements ?? []).map((s) => s.code).join("\n");
    expect(grbCode).toContain("import neopixel");
    expect(grbCode).toContain("neopixel.NeoPixel(_gpio, _count, bpp=_bpp)");
    // bpp follows the order (a package reads it at setup, so the value is not inlined)
    expect(grbCode).toContain("_bpp = 4 if _order.endswith('W') else 3");
    // GRB: green (>>8) comes first in the tuple
    expect(grbCode).toContain("return (_g, _r, _b)");
    const rgbw = neopixelNode.codegenSink!(node({ pin: 13, order: "RGBW" }), ctx());
    const rgbwCode = (rgbw.statements ?? []).map((s) => s.code).join("\n");
    expect(rgbwCode).toContain("return (_r, _g, _b, _w)"); // white channel
  });

  it("shares the data pin through runtime.shared", () => {
    const r = neopixelNode.codegenSink!(node({ pin: 13, count: 4, order: "GRB" }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("runtime.shared('pin', _pin, ('out', 'none'), lambda: machine.Pin(_pin, machine.Pin.OUT))");
  });

  it("writes the strip and reports a bad payload instead of raising", () => {
    const r = neopixelNode.codegenSink!(node({ pin: 13, count: 3 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain(".write()");
    expect(code).toContain("isinstance(_p, dict)");
    expect(code).toContain("except Exception as _e:");
    expect(code).toContain("runtime.report_status");
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
    expect(source).toContain("neopixel.NeoPixel(_gpio, _count, bpp=_bpp)");
    expect(source).toContain(".write()");
  });
});
