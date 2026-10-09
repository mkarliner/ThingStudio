// A sink that also defines codegenEventSource is two-faced: an input face (sink call) and an output face (its own
// event-source coroutine). First users: gui_button and gui_modal. See node-definition.ts's codegenEventSource.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import type { CodegenContext, NodeDefinition } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";

const TWO = "test/two_faced";

function registryWith(extra: Partial<NodeDefinition> = {}, seen?: { wiredIn?: boolean; wiredOut?: boolean }) {
  const reg = buildRegistry();
  reg.set(TWO, {
    type: TWO,
    kind: "sink",
    codegenSink(_node, ctx) {
      return { functionName: ctx.uniqueName("two_in"), functionBody: `print("TWO_IN", msg.get('payload'))` };
    },
    codegenEventSource(node: any, ctx: CodegenContext) {
      if (seen) {
        seen.wiredIn = ctx.isInputWired?.(node.id);
        seen.wiredOut = ctx.isOutputWired?.(node.id);
      }
      return {
        waitStatement: "await asyncio.sleep_ms(1000)",
        buildMsg: `msg = {'payload': 'fired', 'topic': 'two'}`,
      };
    },
    ...extra,
  });
  return reg;
}

const inject = { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } };
const two = { id: "2", type: TWO, properties: {} };
const out = { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } };

describe("two-faced sink nodes", () => {
  it("compiles to a sink function plus a spawned coroutine for the output face", () => {
    const graph: GraphData = { nodes: [inject, two, out], links: [[1, "1", 0, "2", 0, "any"], [2, "2", 0, "3", 0, "bool"]] };
    const { source } = compile(graph, registryWith());
    expect(source).toMatch(/async def _two_in\(msg\):/);
    expect(source.match(/^runtime\.spawn\(/gm)?.length).toBe(2); // inject chain + the two-faced node's output face
    expect(source).toContain(`runtime.spawn(_flow_1(), "2")`); // faults in the output face blame the node
    expect(source).toContain("await asyncio.sleep_ms(1000)");
    expect(source).toMatch(/_gpio_out\w*\(msg\)/); // output face's wire reaches the downstream node
  });

  it("an output wired back round to the node's own input is not a cycle", () => {
    const fn = { id: "4", type: "thingstudio/function", properties: { code: "return msg\n" } };
    const graph: GraphData = {
      nodes: [two, fn],
      links: [[1, "2", 0, "4", 0, "any"], [2, "4", 0, "2", 0, "any"]],
    };
    expect(() => compile(graph, registryWith())).not.toThrow();
  });

  it("is a root with nothing wired, so it is not 'disconnected'", () => {
    const { source } = compile({ nodes: [two], links: [] }, registryWith());
    expect(source).toContain(`runtime.spawn(_flow_0(), "2")`);
  });

  it("tells codegen whether its input and output are wired", () => {
    const seen: { wiredIn?: boolean; wiredOut?: boolean } = {};
    compile({ nodes: [inject, two, out], links: [[1, "1", 0, "2", 0, "any"], [2, "2", 0, "3", 0, "bool"]] }, registryWith({}, seen));
    expect(seen).toEqual({ wiredIn: true, wiredOut: true });
    const alone: { wiredIn?: boolean; wiredOut?: boolean } = {};
    compile({ nodes: [two], links: [] }, registryWith({}, alone));
    expect(alone).toEqual({ wiredIn: false, wiredOut: false });
  });

  it("a plain sink with an outgoing wire is still rejected", () => {
    const graph: GraphData = { nodes: [inject, out, { id: "4", type: "thingstudio/gpio_out", properties: { pin: 13 } }], links: [[1, "1", 0, "3", 0, "bool"], [2, "3", 0, "4", 0, "bool"]] };
    expect(() => compile(graph, buildRegistry())).toThrow(/sink but has an outgoing connection/);
  });

  it("a source with an incoming wire is still rejected", () => {
    const graph: GraphData = { nodes: [inject, { ...inject, id: "5" }], links: [[1, "1", 0, "5", 0, "bool"]] };
    expect(() => compile(graph, buildRegistry())).toThrow(/sources take no input/);
  });

  it("a transform defining codegenEventSource is refused", () => {
    const reg = registryWith({ kind: "transform" });
    expect(() => compile({ nodes: [inject, two], links: [[1, "1", 0, "2", 0, "any"]] }, reg)).toThrow(CompileError);
  });

  it("flows with no two-faced node compile exactly as before", () => {
    const graph: GraphData = { nodes: [inject, out], links: [[1, "1", 0, "3", 0, "bool"]] };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/^runtime\.spawn\(/gm)?.length).toBe(1);
  });
});
