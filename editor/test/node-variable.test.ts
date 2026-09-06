// Tier 1 software-only nodes: variable_get / variable_set
// (editor/src/node-library/variable-get.ts, variable-set.ts). See
// node-boolean.test.ts's header for why this runs against pymock.
//
// The interesting case here is cross-chain sharing: a value set by one
// independently-spawned chain, read back by variable_get in a SEPARATE
// chain. pymock's spawn() runs each source's chain to completion via
// asyncio.run(), sequentially, in the order spawn() is called
// (compiler.fault-isolation.test.ts's header) -- which is source order in
// the generated module, which is node array order (compile.ts's
// `sources.forEach`). So as long as the "set" chain's source node comes
// before the "get" chain's source node in the graph's nodes array, the
// set has already happened by the time the get chain runs.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { variableGetNode } from "../src/node-library/variable-get.js";
import { variableSetNode } from "../src/node-library/variable-set.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

function crossChainGraph(setValue: string): GraphData {
  return {
    nodes: [
      // chain A: inject -> variable_set("counter") -> debug (node 3)
      { id: "1", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: setValue, repeat: "manual" } },
      { id: "2", type: "thingstudio/variable_set", properties: { name: "counter" } },
      { id: "3", type: "thingstudio/debug", properties: {} },
      // chain B: inject -> variable_get("counter") -> debug (node 6)
      { id: "4", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
      { id: "5", type: "thingstudio/variable_get", properties: { name: "counter", payloadType: "number", default: "0" } },
      { id: "6", type: "thingstudio/debug", properties: {} },
    ],
    links: [
      [1, "1", 0, "2", 0, "number"],
      [2, "2", 0, "3", 0, "number"],
      [3, "4", 0, "5", 0, "bool"],
      [4, "5", 0, "6", 0, "number"],
    ],
  };
}

describe("thingstudio/variable_get and thingstudio/variable_set", () => {
  it("a value set by one chain is read by variable_get in a later independent chain", () => {
    const { source } = compile(crossChainGraph("42"), registry);
    const output = runGenerated(source);
    const getChainLine = output.split("\n").find((l) => l.includes("node=6"));
    expect(getChainLine).toContain("payload=42");
  });

  it("variable_get falls back to its configured default when nothing has been set yet", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/variable_get", properties: { name: "never_set", payloadType: "number", default: "99" } },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "number"],
      ],
    };
    const { source } = compile(graph, registry);
    expect(runGenerated(source)).toContain("payload=99");
  });

  it("the shared store dict is declared exactly once even with both a set and a get node in the flow", () => {
    const { source } = compile(crossChainGraph("1"), registry);
    expect(source.match(/^_flow_vars = \{\}$/gm)?.length).toBe(1);
  });

  it("two different variable names don't collide in the shared store", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "1", repeat: "manual" } },
        { id: "2", type: "thingstudio/variable_set", properties: { name: "a" } },
        { id: "3", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "2", repeat: "manual" } },
        { id: "4", type: "thingstudio/variable_set", properties: { name: "b" } },
        { id: "5", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "6", type: "thingstudio/variable_get", properties: { name: "a", payloadType: "number", default: "-1" } },
        { id: "7", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "number"],
        [2, "3", 0, "4", 0, "number"],
        [3, "5", 0, "6", 0, "bool"],
        [4, "6", 0, "7", 0, "number"],
      ],
    };
    const { source } = compile(graph, registry);
    const output = runGenerated(source);
    const getLine = output.split("\n").find((l) => l.includes("node=7"));
    expect(getLine).toContain("payload=1"); // "a", not "b"'s 2
  });

  it("rejects an empty variable_set name", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "1", repeat: "manual" } },
        { id: "2", type: "thingstudio/variable_set", properties: { name: "  " } },
      ],
      links: [[1, "1", 0, "2", 0, "number"]],
    };
    expect(() => compile(graph, registry)).toThrow(CompileError);
    expect(() => compile(graph, registry)).toThrow(/empty/);
  });

  it("rejects an empty variable_get name", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/variable_get", properties: { name: "", payloadType: "bool", default: "false" } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    expect(() => compile(graph, registry)).toThrow(/empty/);
  });

  // Canvas presence given 2026-09-06 (outstanding-items/canvas-presence-
  // gaps.md) -- confirms the ports declarations exist and, for
  // variable_get, retype correctly with payloadType (nodes.ts's
  // VariableGetNode.retypeOutput() reads these same declarations).
  it("variable_get declares an any input and a payloadType-dependent output", () => {
    expect(variableGetNode.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    const outputs = variableGetNode.ports?.outputs;
    expect(outputs).toHaveLength(1);
    expect(outputs?.[0]?.name).toBe("msg");
    const resolve = outputs?.[0]?.type;
    expect(typeof resolve).toBe("function");
    if (typeof resolve === "function") {
      expect(resolve({})).toBe("bool"); // default when unconfigured
      expect(resolve({ payloadType: "number" })).toBe("number");
    }
  });

  it("variable_set declares matching any input and output ports", () => {
    expect(variableSetNode.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(variableSetNode.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
  });
});
