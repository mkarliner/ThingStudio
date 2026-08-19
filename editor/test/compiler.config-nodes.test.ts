// SPDX-License-Identifier: Apache-2.0
// editor/test/compiler.config-nodes.test.ts
//
// Off-device tests for compile.ts's config-node resolution mechanism
// (config-node-and-palette-implementation-briefing.md) -- deliberately
// generic, not coupled to any real node-library type, so this exercises
// compile.ts's own contract in isolation: `GraphData.configs` (graph.ts)
// resolved into `CodegenContext.resolveConfig()` (node-definition.ts), a
// config never entering `nodesById`/`childrenOf`/`sources`/`reachable`
// the way a real GraphNode does. wifi-status.ts/udp-send.ts/udp-receive.ts's
// own test files cover the real-world call site (a `wifiConfigId`
// property); this file covers the compiler mechanism those all sit on top
// of.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import type { NodeDefinition } from "../src/compiler/node-definition.js";

/** A minimal source node type whose only job is to call ctx.resolveConfig()
 * and embed the result into its buildMsg as a nested dict literal (JSON's
 * double-quoted object syntax is also valid Python dict syntax), so a test
 * can assert on what resolution actually returned without needing any
 * real node-library type's own domain logic. */
const configReaderSource: NodeDefinition = {
  type: "test/config-reader-source",
  kind: "source",
  codegenSource(node, ctx) {
    const configId = String(node.properties.configId);
    const resolved = ctx.resolveConfig(configId);
    return {
      buildMsg: `msg = {'payload': ${JSON.stringify(resolved)}, 'topic': ''}`,
      repeatMs: 0,
    };
  },
};

function registry(): Map<string, NodeDefinition> {
  const m = new Map<string, NodeDefinition>();
  m.set(configReaderSource.type, configReaderSource);
  return m;
}

describe("compiler: config node resolution", () => {
  it("resolves a referenced config's properties by id", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "cfg1" } }],
      links: [],
      configs: [{ id: "cfg1", type: "test/anything", properties: { foo: "bar" } }],
    };
    const { source } = compile(graph, registry());
    expect(source).toContain('{"foo":"bar"}');
  });

  it("throws CompileError naming the missing id when a config reference doesn't resolve", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "missing" } }],
      links: [],
    };
    expect(() => compile(graph, registry())).toThrow(CompileError);
    expect(() => compile(graph, registry())).toThrow(/referenced config "missing" not found/);
  });

  it("rejects duplicate config ids up front, same as duplicate node ids", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "cfg1" } }],
      links: [],
      configs: [
        { id: "cfg1", type: "test/anything", properties: { foo: "a" } },
        { id: "cfg1", type: "test/anything", properties: { foo: "b" } },
      ],
    };
    expect(() => compile(graph, registry())).toThrow(/duplicate config id "cfg1"/);
  });

  it("an orphan config (referenced by nothing) doesn't affect reachability or disconnected-node checks", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "cfg1" } }],
      links: [],
      configs: [
        { id: "cfg1", type: "test/anything", properties: { foo: "bar" } },
        { id: "orphan", type: "test/anything", properties: { unused: true } },
      ],
    };
    expect(() => compile(graph, registry())).not.toThrow();
  });

  it("a config's own `type` string is never looked up against the node registry -- configs never enter the compiler's node bookkeeping", () => {
    // "totally/unregistered/type" below is never registered in registry()
    // -- if configs were folded into nodesById the way real graph nodes
    // are, compile() would reject this with "unknown node type" the same
    // way it rejects an unregistered GraphNode.type. It doesn't, because
    // configs are deliberately never checked against the registry at all
    // (compile.ts's own header comment, "never register configs in
    // nodesById/childrenOf/sources/reachable").
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "cfg1" } }],
      links: [],
      configs: [{ id: "cfg1", type: "totally/unregistered/type", properties: { foo: "bar" } }],
    };
    expect(() => compile(graph, registry())).not.toThrow();
  });

  it("a config's string id doesn't collide with a GraphNode's separate numeric id space", () => {
    // graph.ts's own header: configs deliberately use a string ID space,
    // not the numeric one GraphNode.id uses, specifically so there's no
    // accidental collision check needed between the two. A config id that
    // happens to look like a node id ("1") should resolve independently.
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "1" } }],
      links: [],
      configs: [{ id: "1", type: "test/anything", properties: { note: "not node id 1" } }],
    };
    const { source } = compile(graph, registry());
    expect(source).toContain("not node id 1");
  });

  it("compiling with no configs array at all still works right up until an actual reference is resolved", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "test/config-reader-source", properties: { configId: "unused" } }],
      links: [],
    };
    // No configs at all -> resolveConfig("unused") still throws (nothing
    // to resolve), but the graph itself parses/walks fine up to that
    // point -- confirms `graphData.configs ?? []` handles the field being
    // entirely absent, not just present-and-empty.
    expect(() => compile(graph, registry())).toThrow(/referenced config "unused" not found/);
  });
});
