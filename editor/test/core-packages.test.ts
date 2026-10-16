// SPDX-License-Identifier: Apache-2.0
// editor/test/core-packages.test.ts
//
// Phase-4 proof (node-format-parity, option A): a built-in expressed as a package compiles through the same
// generic codegen a custom node does. The i2c built-in's device behaviour is ported to a `.node.py`
// (node-library/core-packages/i2c.ts); its definition is built with buildCoreNodeDefinition, dropped into the
// registry in place of the TypeScript one, and a real flow is compiled -- sharing the bus through
// runtime.shared and reporting status through the nodeId field, like the built-in does.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { descriptor, python } from "../src/node-library/core-packages/i2c.js";
import { buildCoreNodeDefinition } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

function searchableFlow(operation: string): GraphData {
  return {
    nodes: [
      { id: "1", type: "thingstudio/inject", properties: {} },
      { id: "2", type: "thingstudio/i2c", properties: { i2cConfigId: "bus1", operation } },
      { id: "3", type: "thingstudio/debug", properties: {} },
    ],
    configs: [{ id: "bus1", type: "thingstudio/config/i2c-bus", properties: { bus: 0, scl: 22, sda: 21, freq: 100000 } }],
    links: [
      [1, "1", 0, "2", 0, "any"],
      [2, "2", 0, "3", 0, "any"],
    ],
  };
}

describe("core package: i2c (phase 4 proof)", () => {
  const def = buildCoreNodeDefinition(descriptor, python);

  it("keeps the full descriptor, unlike a custom node's subset", () => {
    expect(def.paletteId).toBe("i2c");
    expect(def.label).toBe("i2c device");
    expect(def.group).toBe("hardware");
    expect(def.codegenTransform).toBeTypeOf("function");
  });

  it("compiles a read flow: shared bus, transfer, and a status report", () => {
    const registry = buildRegistry();
    registry.set(def.type, def); // the core package replaces the built-in, one producer
    const graph = searchableFlow("read");
    graph.nodes[1]!.properties.address = "0x29";
    graph.nodes[1]!.properties.length = 2;

    const { source } = compile(graph, registry);
    expect(source).toContain("runtime.shared('i2c'");
    expect(source).toContain(".readfrom(address, length)"); // address/length are runtime-checked in the package
    expect(source).toContain('"nodeId": "2"'); // the nodeId field is inlined
    expect(source).toContain("runtime.report_status(_node_id");
    execFileSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: source });
  });

  it("compiles a write flow unchanged from a user package's shape", () => {
    const registry = buildRegistry();
    registry.set(def.type, def);
    const graph = searchableFlow("write");
    graph.nodes[1]!.properties.address = "0x29";
    const { source } = compile(graph, registry);
    expect(source).toContain(".writeto(address, buf)");
    execFileSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], { input: source });
  });
});
