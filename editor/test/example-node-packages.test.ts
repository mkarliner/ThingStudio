// SPDX-License-Identifier: Apache-2.0
// editor/test/example-node-packages.test.ts
//
// The example custom node packages shipped in backend/src/thingstudio_backend/example_nodes/ (copied
// into ~/.thingstudio/custom-nodes/ on first run) must validate against the format and compile through
// the generic codegen -- a typo in one would otherwise ship a broken example. The interrupt-driven IMU
// example is the proof that a custom node can be a hardware-interrupt source.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildCustomNodeDefinition, mergeCustomNodeRegistry, validateCustomNodeDescriptor } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const dir = new URL("../../backend/src/thingstudio_backend/example_nodes/", import.meta.url);
const descriptorOf = (name: string) => validateCustomNodeDescriptor(JSON.parse(readFileSync(new URL(`${name}.node.json`, dir), "utf8")));
const sourceOf = (name: string) => readFileSync(new URL(`${name}.node.py`, dir), "utf8");

function bareCtx(): CodegenContext {
  let n = 0;
  return {
    uniqueName: (hint: string) => `_${hint}_${n++}`,
    resolveConfig: () => {
      throw new Error("no example node reads a config");
    },
  };
}

describe("shipped example node packages", () => {
  it("every example .node.json validates against the format", () => {
    for (const name of ["doubler", "dht22", "lsm6ds3", "lsm6ds3_int"]) {
      expect(descriptorOf(name).type, name).toContain("/");
    }
  });

  it("the IMU interrupt example is an event source that sets up a hardware IRQ", () => {
    const descriptor = descriptorOf("lsm6ds3_int");
    expect(descriptor.kind).toBe("source");
    expect(descriptor.eventSource).toBe(true);
    const def = buildCustomNodeDefinition(descriptor, sourceOf("lsm6ds3_int"));
    expect(def.codegenEventSource).toBeTypeOf("function");
    const result = def.codegenEventSource!({ id: "1", type: descriptor.type, properties: {} }, bareCtx());
    const code = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(code).toContain(".irq(trigger=machine.Pin.IRQ_RISING");
    expect(result.waitStatement).toMatch(/await /);

    // The whole flow compiles and the generated Python parses.
    const registry = mergeCustomNodeRegistry(buildRegistry(), [def]);
    const graph: GraphData = { nodes: [{ id: "1", type: descriptor.type, properties: {} }], links: [] };
    const { source } = compile(graph, registry);
    expect(source).toContain("threadsafe_event");
    execFileSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: source });
  });
});
