// editor/src/node-library/encoder.ts codegen. Text-level: the driver's own behaviour is Peter Hinch's
// (device-runtime/src/vendor/primitives_encoder/), not re-tested here.

import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { encoderNode } from "../src/node-library/encoder.js";

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

function node(properties: Record<string, unknown>, id = "e1"): GraphNode {
  return { id, type: "thingstudio/encoder", properties };
}

describe("thingstudio/encoder node", () => {
  it("rejects the same pin for x and y", () => {
    expect(() => encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 10 }), ctx())).toThrow(/must differ/);
  });

  it("rejects div below 1 and a value outside vmin/vmax", () => {
    expect(() => encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11, div: 0 }), ctx())).toThrow(/div/);
    expect(() => encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11, vmin: 5 }), ctx())).toThrow(/outside/);
  });

  it("generates one output, value in payload and delta alongside", () => {
    const r = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(r.imports).toContain("from encoder import Encoder");
    expect(code).toContain("Encoder(_gpio_10, _gpio_11, v=0, div=1, delay=100)");
    expect(r.waitStatement).toContain(".__anext__()");
    expect(r.buildMsg).toContain("'payload': _enc_val");
    expect(r.buildMsg).toContain("'delta': _enc_delta");
    expect(encoderNode.ports?.outputs?.[0]?.type).toBe("number");
  });

  it("shares both pins through runtime.shared", () => {
    const r = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("_gpio_10 = runtime.shared('pin', 10, ('in', 'up'), lambda: machine.Pin(10, machine.Pin.IN, machine.Pin.PULL_UP))");
    expect(code).toContain("_gpio_11 = runtime.shared('pin', 11, ('in', 'up'), lambda: machine.Pin(11, machine.Pin.IN, machine.Pin.PULL_UP))");
    expect(code).not.toMatch(/machine\.Pin\(10, machine\.Pin\.IN, machine\.Pin\.PULL_UP\)\n_encoder/);
  });

  it("passes vmin/vmax/mod only when set", () => {
    const r = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11, vmin: 0, vmax: 100, mod: 10 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("vmin=0");
    expect(code).toContain("vmax=100");
    expect(code).toContain("mod=10");
    const bare = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11 }), ctx());
    expect((bare.statements ?? []).map((s) => s.code).join("\n")).not.toContain("vmin=");
  });
});
