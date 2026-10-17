// encoder as a core package (editor/src/node-library/core-packages/encoder.ts) codegen. Text-level: the driver's
// own behaviour is Peter Hinch's (device-runtime/src/vendor/primitives_encoder/), not re-tested here.

import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { descriptor as encoderDescriptor, python as encoderPython } from "../src/node-library/core-packages/encoder.js";
import { buildCoreNodeDefinition } from "../src/node-library/custom-node.js";

const encoderNode = buildCoreNodeDefinition(encoderDescriptor, encoderPython);

// A ctx with compile.ts's claim rule, so the two pin resources' claims are checked (the same-pin guard is now a
// claim conflict).
function ctx(): CodegenContext {
  const used = new Set<string>();
  const claims = new Map<string, string>();
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
    claimResource(resource, use, who) {
      const prev = claims.get(resource);
      if (prev === undefined) claims.set(resource, use);
      else if (prev !== use) throw new Error(`${resource}: ${who} sets it up as ${use}, but already as ${prev}.`);
    },
  };
}

function node(properties: Record<string, unknown>, id = "e1"): GraphNode {
  return { id, type: "thingstudio/encoder", properties };
}

describe("thingstudio/encoder node", () => {
  it("rejects the same pin for x and y (a claim conflict)", () => {
    expect(() => encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 10 }), ctx())).toThrow(/GPIO 10/);
  });

  it("rejects div below 1", () => {
    expect(() => encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11, div: 0 }), ctx())).toThrow(/div/);
  });

  it("generates one output, value in payload and delta alongside", () => {
    const r = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("from encoder import Encoder");
    expect(code).toContain("return {'payload': _enc_val, 'topic': '', 'delta': _enc_delta}");
    expect(r.waitStatement).toContain("await");
    expect(encoderNode.ports?.outputs?.[0]?.type).toBe("number");
  });

  it("shares both pins and the driver through runtime.shared", () => {
    const r = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("runtime.shared('pin', _pin_x, ('in', 'up')");
    expect(code).toContain("runtime.shared('pin', _pin_y, ('in', 'up')");
    expect(code).toContain("runtime.shared('encoder', (_pin_x, _pin_y)");
  });

  it("passes vmin/vmax/mod only when set (blank -> None)", () => {
    const r = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11, vmin: 0, vmax: 100, mod: 10 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain('"vmin": 0');
    expect(code).toContain('"vmax": 100');
    expect(code).toContain('"mod": 10');
    const bare = encoderNode.codegenEventSource!(node({ pinX: 10, pinY: 11 }), ctx());
    expect((bare.statements ?? []).map((s) => s.code).join("\n")).toContain('"vmin": None');
  });
});
