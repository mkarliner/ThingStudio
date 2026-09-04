// SPDX-License-Identifier: Apache-2.0
// editor/test/compiler.node-line-ranges.test.ts
//
// Verifies compile()'s nodeLineRanges output -- the mapping
// main.ts's highlightNodeFromMpyError uses to resolve a raw line number
// out of mpy-cross's SyntaxError back to the node on the canvas that
// produced that line. See mvp-feature-priorities.md's "Real editor
// shell" entry, 2026-08-14, for the reasoning this was built on: a
// structured line-range table computed directly from the same text
// compile() emits (NOT text-scanned back out of the source afterward),
// so it's immune to whatever a function node's own verbatim
// user-authored code happens to contain.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

describe("compile(): nodeLineRanges", () => {
  it("maps each transform/sink node's own line range, each starting with its marker comment", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = not msg['payload']\nreturn msg\n" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
      ],
    };
    const { source, nodeLineRanges } = compile(graph, buildRegistry());
    const lines = source.split("\n");

    // Only the two real generated-function nodes get an entry -- the
    // inject source's buildMsg is inlined directly into its coroutine,
    // never emitted as its own function (see compile.ts's NodeLineRange
    // doc comment).
    expect(nodeLineRanges.map((r) => r.nodeId).sort()).toEqual(["2", "3"]);

    for (const range of nodeLineRanges) {
      expect(range.startLine).toBeLessThanOrEqual(range.endLine);
      const markerLine = lines[range.startLine - 1]; // startLine is 1-indexed
      expect(markerLine).toBe(`# node:${range.nodeId}`);
      const defLine = lines[range.startLine]; // the line right after the marker
      expect(defLine).toMatch(/^async def /);
    }

    // Ranges don't overlap.
    const sorted = [...nodeLineRanges].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.startLine).toBeGreaterThan(sorted[i - 1]!.endLine);
    }
  });

  it("a line deep inside a node's function body still resolves back to that node", () => {
    // Multiple body lines so there's a real "the error isn't on the def
    // line itself" case -- matching what a real SyntaxError somewhere
    // inside a function node's own code actually looks like.
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "a = 1\nb = 2\nmsg['payload'] = a + b\nreturn msg\n" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
      ],
    };
    const { source, nodeLineRanges } = compile(graph, buildRegistry());
    const lines = source.split("\n");
    const functionRange = nodeLineRanges.find((r) => r.nodeId === "2")!;

    const bodyLineNo = lines.findIndex((l) => l.includes("b = 2")) + 1; // 1-indexed
    expect(bodyLineNo).toBeGreaterThan(0);
    expect(bodyLineNo).toBeGreaterThanOrEqual(functionRange.startLine);
    expect(bodyLineNo).toBeLessThanOrEqual(functionRange.endLine);
  });
});
