// The async compile-hook pre-pass, with a fake runner (the real one is the sandboxed interpreter,
// added separately). Covers ordering, context plumbing, attribution and validation.

import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import type { NodeDefinition } from "../src/compiler/node-definition.js";
import { runCompileHooks, type CompileHookRunner } from "../src/node-library/compile-hooks.js";

function def(type: string, extra: Partial<NodeDefinition> = {}): NodeDefinition {
  return { type, kind: "transform", label: type, paletteId: "custom", ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] }, properties: [], ...extra };
}

const registry = new Map<string, NodeDefinition>([
  ["custom/hooked", def("custom/hooked", { compileHook: "def compile(ctx, properties):\n    return {}\n" })],
  ["custom/plain", def("custom/plain")],
]);

const graph: GraphData = {
  nodes: [
    { id: "a", type: "custom/hooked", properties: { x: 1 } },
    { id: "b", type: "custom/plain", properties: {} },
    { id: "c", type: "custom/hooked", properties: { x: 2 } },
  ],
  links: [],
};

describe("runCompileHooks", () => {
  it("runs only hooked nodes, in graph order, with their own context and properties", async () => {
    const calls: { label: string; nodeId: string; props: Record<string, unknown> }[] = [];
    const runner: CompileHookRunner = {
      async run(_source, ctx, properties, label) {
        calls.push({ label, nodeId: ctx.node.id, props: properties });
        return { properties: { seen: ctx.node.id } };
      },
    };
    const out = await runCompileHooks(graph, registry, runner);
    expect(calls.map((c) => c.nodeId)).toEqual(["a", "c"]);
    expect(calls[0]!.props).toEqual({ x: 1 });
    expect(out.results.get("a")!.properties).toEqual({ seen: "a" });
    expect(out.results.has("b")).toBe(false);
  });

  it("passes the target through to the context", async () => {
    const seen: unknown[] = [];
    await runCompileHooks(
      graph,
      registry,
      { async run(_s, ctx) { seen.push(ctx.target); return null; } },
      { target: null },
    );
    expect(seen).toEqual([null, null]);
  });

  it("stops the pre-pass when the compile budget is exceeded, naming the next node", async () => {
    const runner: CompileHookRunner = {
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return null;
      },
    };
    await expect(runCompileHooks(graph, registry, runner, { compileTimeoutMs: 10 })).rejects.toThrow(
      /custom\/hooked \(node c\): package compile hooks exceeded the 10 ms compile budget/,
    );
  });

  it("collects warnings, attributed to the node", async () => {
    const out = await runCompileHooks(graph, registry, {
      async run(_s, ctx) {
        return ctx.node.id === "a" ? { warnings: ["capped"] } : null;
      },
    });
    expect(out.warnings).toEqual(["custom/hooked (node a): capped"]);
  });

  it("a hook's errors stop the pre-pass, naming the node", async () => {
    await expect(
      runCompileHooks(graph, registry, { async run() { return { errors: ["no bus", "pin 35 input-only"] }; } }),
    ).rejects.toThrow(/custom\/hooked \(node a\): no bus; pin 35 input-only/);
  });

  it("wraps a runner exception and validates the result", async () => {
    await expect(runCompileHooks(graph, registry, { async run() { throw new Error("timeout"); } })).rejects.toThrow(/compile hook failed: timeout/);
    await expect(runCompileHooks(graph, registry, { async run() { return { bogus: true }; } })).rejects.toThrow(CompileError);
    await expect(runCompileHooks(graph, registry, { async run() { return { bogus: true }; } })).rejects.toThrow(/unknown key "bogus"/);
  });
});
