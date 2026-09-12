// Tier 1 software-only node: function (editor/src/node-library/function-node.ts).
// The `context`/`flow` scopes added per mvp-feature-priorities.md's
// 2026-08-14 addendum ("stateful nodes and cross-message
// synchronization") -- exposing Node-RED-style context/flow get/set
// directly inside a function node's own generated code, the general fix
// for the "why doesn't inject -> invert -> gpio_out flash the LED" case
// the `timer` node worked around one-off (editor-hands-on-briefing.md).
//
// Two things tested separately, matching the two scopes' different
// sharing rules:
//  - `context`: private to ONE function node instance, persists across
//    repeated calls to that same instance -- tested here by calling the
//    generated function directly, multiple times in a row (same pattern
//    node-timer.test.ts uses for its own per-instance counter), since a
//    single "manual" one-shot compiled flow (this codebase's usual
//    integration-test shape, see node-variable.test.ts) only invokes any
//    one node once and can't exercise "persists across separate trigger
//    events" on its own.
//  - `flow`: shared flow-wide, backed by the SAME dict
//    variable_get/variable_set already read/write (FLOW_VARS_DICT) --
//    tested via the full compiler + pymock, the way node-variable.test.ts
//    tests cross-chain sharing between variable_set and variable_get,
//    just with a function node standing in for one side of that pair.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { functionNode } from "../src/node-library/function-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();
const pymockDir = join(__dirname, "fixtures", "pymock");

function runFile(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

function freshCtx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    // resolveConfig isn't exercised here -- the function node doesn't
    // read config nodes. Stub throws if ever called, matching every other
    // node test file's updated ctx.
    resolveConfig(id: string): Record<string, unknown> {
      throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
    },
  };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

function node(id: number, code: string): GraphNode {
  return { id: String(id), type: "thingstudio/function", properties: { code } };
}

const COUNTER_CODE = "n = context.get('count', 0) + 1\ncontext.set('count', n)\nmsg['payload'] = n\nreturn msg";

/** Compiles `nodeCodes` directly via codegenTransform (bypassing the full
 * compile()/asyncio machinery, same reasoning node-timer.test.ts's
 * runIterations gives for doing the same with codegenSource), wraps each
 * as a plain sync `def`, then calls every node's function once per
 * "round", `callsPerNode` rounds -- so the printed output interleaves
 * node A's call 1, node B's call 1, node A's call 2, ... letting a test
 * assert both "persists across calls" and "independent per instance" from
 * one run. */
function runCallsForNodes(nodeCodes: string[], callsPerNode: number): string[] {
  const ctx = freshCtx();
  const results = nodeCodes.map((code, i) => functionNode.codegenTransform!(node(i + 1, code), ctx));

  const lines: string[] = [];
  const seenStatementKeys = new Set<string>();
  for (const r of results) {
    for (const stmt of r.statements ?? []) {
      if (!seenStatementKeys.has(stmt.key)) {
        seenStatementKeys.add(stmt.key);
        lines.push(stmt.code);
      }
    }
  }
  for (const r of results) {
    lines.push(`def ${r.functionName}(msg):\n${indent(r.functionBody, 4)}`);
  }
  for (let round = 0; round < callsPerNode; round++) {
    for (const r of results) {
      lines.push(`print(${r.functionName}({'payload': None, 'topic': ''})['payload'])`);
    }
  }
  return runFile(lines).trim().split("\n");
}

describe("thingstudio/function node -- context scope", () => {
  it("persists across repeated calls to the same node instance", () => {
    const output = runCallsForNodes([COUNTER_CODE], 3);
    expect(output).toEqual(["1", "2", "3"]);
  });

  it("is private -- two function node instances using the same key don't collide", () => {
    const output = runCallsForNodes([COUNTER_CODE, COUNTER_CODE], 3);
    // Interleaved: nodeA round1, nodeB round1, nodeA round2, nodeB round2, ...
    // -- if both shared one dict this would read 1,2,3,4,5,6 instead.
    expect(output).toEqual(["1", "1", "2", "2", "3", "3"]);
  });

  it("the shared _Store class is identical across instances; each instance's own store statement key differs", () => {
    const ctx = freshCtx();
    const a = functionNode.codegenTransform!(node(1, COUNTER_CODE), ctx);
    const b = functionNode.codegenTransform!(node(2, COUNTER_CODE), ctx);
    const classA = a.statements?.find((s) => s.key === "context-store-class");
    const classB = b.statements?.find((s) => s.key === "context-store-class");
    expect(classA?.code).toBe(classB?.code);

    const sharedKeys = new Set(["context-store-class", "flow-vars-dict", "flow-context-obj"]);
    const instanceKeyA = a.statements?.map((s) => s.key).find((k) => !sharedKeys.has(k));
    const instanceKeyB = b.statements?.map((s) => s.key).find((k) => !sharedKeys.has(k));
    expect(instanceKeyA).toBeDefined();
    expect(instanceKeyA).not.toBe(instanceKeyB);
  });
});

describe("thingstudio/function node -- flow scope (shared with variable_get/variable_set)", () => {
  it("a value written by variable_set is read by a function node's flow.get in a separate chain", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "42", repeat: "manual" } },
        { id: "2", type: "thingstudio/variable_set", properties: { name: "counter" } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "5", type: "thingstudio/function", properties: { code: "msg['payload'] = flow.get('counter')\nreturn msg" } },
        { id: "6", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "number"],
        [2, "2", 0, "3", 0, "number"],
        [3, "4", 0, "5", 0, "bool"],
        [4, "5", 0, "6", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const output = runGenerated(source);
    const line = output.split("\n").find((l) => l.includes("node=6"));
    expect(line).toContain("payload=42");
  });

  it("a value written by a function node's flow.set is read back by variable_get in a separate chain", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "flow.set('x', 7)\nreturn msg" } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "5", type: "thingstudio/variable_get", properties: { name: "x", payloadType: "number", default: "-1" } },
        { id: "6", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
        [3, "4", 0, "5", 0, "bool"],
        [4, "5", 0, "6", 0, "number"],
      ],
    };
    const { source } = compile(graph, registry);
    const output = runGenerated(source);
    const line = output.split("\n").find((l) => l.includes("node=6"));
    expect(line).toContain("payload=7");
  });

  it("the shared _flow_vars dict and _Store class are each declared exactly once with both function and variable nodes present", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "flow.set('x', 1)\nreturn msg" } },
        { id: "3", type: "thingstudio/variable_set", properties: { name: "y" } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
      ],
    };
    const { source } = compile(graph, registry);
    expect(source.match(/^_flow_vars = \{\}$/gm)?.length).toBe(1);
    expect(source.match(/^class _Store:$/gm)?.length).toBe(1);
  });
});

describe("thingstudio/function node -- multi-output routing (Node-RED-style array return, outstanding-items/connection-state-gate-router-nodes.md, 2026-09-12)", () => {
  it("an array return with a null slot routes only to the output that got a real value", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = 'a'\nreturn [msg, None]", outputCount: 2 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
        [3, "2", 1, "4", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source).trim().split("\n");
    const line3 = lines.find((l) => l.includes("node=3"));
    expect(line3).toContain("payload='a'");
    expect(lines.some((l) => l.includes("node=4"))).toBe(false);
  });

  it("routes to whichever slot the array actually put a value in, not always slot 0", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = 'b'\nreturn [None, msg]", outputCount: 2 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
        [3, "2", 1, "4", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source).trim().split("\n");
    expect(lines.some((l) => l.includes("node=3"))).toBe(false);
    const line4 = lines.find((l) => l.includes("node=4"));
    expect(line4).toContain("payload='b'");
  });

  it("loose tolerance: a non-list return targets output 0 only, even with more outputs wired", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = 'x'\nreturn msg", outputCount: 2 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
        [3, "2", 1, "4", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source).trim().split("\n");
    const line3 = lines.find((l) => l.includes("node=3"));
    expect(line3).toContain("payload='x'");
    expect(lines.some((l) => l.includes("node=4"))).toBe(false);
  });

  it("loose tolerance: a short array leaves missing trailing outputs as None (no message sent)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = 'only0'\nreturn [msg]", outputCount: 3 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/debug", properties: {} },
        { id: "5", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
        [3, "2", 1, "4", 0, "any"],
        [4, "2", 2, "5", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source).trim().split("\n");
    const line3 = lines.find((l) => l.includes("node=3"));
    expect(line3).toContain("payload='only0'");
    expect(lines.some((l) => l.includes("node=4"))).toBe(false);
    expect(lines.some((l) => l.includes("node=5"))).toBe(false);
  });

  it("loose tolerance: a long array's extra elements beyond the node's real output count are ignored", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        {
          id: "2",
          type: "thingstudio/function",
          properties: { code: "msg['payload'] = 'two'\nreturn [None, msg, 'ignored', 'also ignored']", outputCount: 2 },
        },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
        [3, "2", 1, "4", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source).trim().split("\n");
    expect(lines.some((l) => l.includes("node=3"))).toBe(false);
    const line4 = lines.find((l) => l.includes("node=4"));
    expect(line4).toContain("payload='two'");
  });

  it("a nested list in one slot sends multiple messages out that one output, in order", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        {
          id: "2",
          type: "thingstudio/function",
          properties: { code: "return [[dict(msg, payload=1), dict(msg, payload=2)], None]", outputCount: 2 },
        },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source)
      .trim()
      .split("\n")
      .filter((l) => l.includes("node=3"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("payload=1");
    expect(lines[1]).toContain("payload=2");
  });

  it("an unwired output produces no code and doesn't affect the wired ones", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        {
          id: "2",
          type: "thingstudio/function",
          properties: { code: "msg['payload'] = 'only-wired'\nreturn [msg, msg]", outputCount: 2 },
        },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    const lines = runGenerated(source).trim().split("\n");
    const line3 = lines.find((l) => l.includes("node=3"));
    expect(line3).toContain("payload='only-wired'");
  });

  it("a single-output function node (outputCount 1, or unset) still compiles through the original single-output path unchanged", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = 'plain'\nreturn msg" } },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    // No multi-output routing code (isinstance checks etc.) should appear
    // at all -- this graph has no other node type that emits `isinstance`
    // either (http_request/http_response/mqtt_subscribe do; none are here).
    expect(source).not.toContain("isinstance");
    const lines = runGenerated(source).trim().split("\n");
    const line3 = lines.find((l) => l.includes("node=3"));
    expect(line3).toContain("payload='plain'");
  });
});
