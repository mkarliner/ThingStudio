// A package compile hook's validated result reaching the synchronous compiler: extra/overridden
// properties, hardware claims, and warnings (interfaces/node-compile-context/SPEC.md draft).

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import type { CompileHookResult, NodeDefinition } from "../src/compiler/node-definition.js";
import { buildCustomNodeDefinition, type CustomNodeDescriptor } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const descriptor: CustomNodeDescriptor = {
  type: "custom/hooked",
  kind: "source",
  label: "hooked",
  properties: [
    { name: "intervalMs", label: "interval (ms)", kind: "number", default: 1000 },
    { name: "value", label: "value", kind: "number", default: 0 },
  ],
  ports: { outputs: [{ name: "msg", type: "any" }] },
};

const python = `async def emit(properties):
    return {'payload': properties.get('computed', properties.get('value')), 'topic': ''}
`;

function registry(): Map<string, NodeDefinition> {
  const def = buildCustomNodeDefinition(descriptor, python);
  def.compileHook = "def compile(ctx, properties):\n    return {}\n";
  return new Map([...buildRegistry(), ["custom/hooked", def]]);
}

function graph(extraNode = false): GraphData {
  const nodes = [
    { id: "h1", type: "custom/hooked", properties: {} },
    { id: "d1", type: "thingstudio/debug", properties: {} },
  ];
  const links: GraphData["links"] = [[1, "h1", 0, "d1", 0, "any"]];
  if (extraNode) {
    nodes.push({ id: "h2", type: "custom/hooked", properties: {} });
    links.push([2, "h2", 0, "d1", 0, "any"]);
  }
  return { nodes, links };
}

function hookResult(partial: Partial<CompileHookResult>): CompileHookResult {
  return { properties: {}, claims: [], warnings: [], errors: [], ...partial };
}

describe("compile() with package hook results", () => {
  it("adds properties the descriptor does not declare, for the package's Python", () => {
    const results = new Map([["h1", hookResult({ properties: { computed: 42 } })]]);
    const { source } = compile(graph(), registry(), { hookResults: results });
    expect(source).toContain('"computed": 42');
  });

  it("lets a hook override a declared field's resolved value", () => {
    const results = new Map([["h1", hookResult({ properties: { value: 7 } })]]);
    const { source } = compile(graph(), registry(), { hookResults: results });
    expect(source).toContain('"value": 7');
    expect(source).toContain('*{"value": 7}');
  });

  it("applies hook claims through the same resource-claim machinery", () => {
    const results = new Map([
      ["h1", hookResult({ claims: [{ resource: "GPIO 22", use: "display DC" }] })],
      ["h2", hookResult({ claims: [{ resource: "GPIO 22", use: "display CS" }] })],
    ]);
    expect(() => compile(graph(true), registry(), { hookResults: results })).toThrow(CompileError);
    expect(() => compile(graph(true), registry(), { hookResults: results })).toThrow(/GPIO 22/);
  });

  it("includes the pre-pass warnings in the compile result", () => {
    const { warnings } = compile(graph(), registry(), { hookWarnings: ["custom/hooked (node h1): capped"] });
    expect(warnings).toEqual(["custom/hooked (node h1): capped"]);
  });

  it("a package without a hook is unaffected", () => {
    const def = buildCustomNodeDefinition(descriptor, python);
    const plain = new Map<string, NodeDefinition>([...buildRegistry(), ["custom/hooked", def]]);
    const { source } = compile(graph(), plain);
    expect(source).toContain("custom_hooked");
    expect(source).not.toContain("**");
  });
});
