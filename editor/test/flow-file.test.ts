// SPDX-License-Identifier: Apache-2.0
// editor/test/flow-file.test.ts
//
// Off-device tests for the flow file format's pure logic (flow-file.ts's
// own header explains why it's Litegraph-independent and testable this
// way, same pattern as compile.ts). The two things that actually matter
// per design doc §6: nodes/edges vs. layout are genuinely separate
// sections, and re-saving unchanged data is byte-identical (a real `git
// diff` requirement, not just "looks right").

import { describe, expect, it } from "vitest";
import { buildFlowFile, FLOW_FILE_FORMAT_VERSION, FlowFileError, parseFlowFile, serializeFlowFileText, type CanvasNodeSnapshot, type FlowFileEdge } from "../src/flow-file/flow-file.js";

const SAMPLE_NODES: CanvasNodeSnapshot[] = [
  { id: 3, type: "thingstudio/gpio_out", properties: { pin: 12 }, pos: [300, 100] },
  { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" }, pos: [80, 80], size: [190, 130] },
  { id: 2, type: "thingstudio/function", properties: { code: "return msg\n" }, pos: [200, 90] },
];
const SAMPLE_EDGES: FlowFileEdge[] = [
  [2, 0, 3, 0],
  [1, 0, 2, 0],
];

describe("buildFlowFile", () => {
  it("splits logic (nodes/edges) from layout (position/size)", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    expect(file.nodes.every((n) => !("pos" in n) && !("size" in n))).toBe(true);
    expect(Object.keys(file.layout).sort()).toEqual(["1", "2", "3"]);
    expect(file.layout["1"]).toEqual({ pos: [80, 80], size: [190, 130] });
    expect(file.layout["3"]).toEqual({ pos: [300, 100] }); // no size given -- omitted, not defaulted
  });

  it("sorts nodes by id and edges by [originId, originSlot, targetId, targetSlot], regardless of input order", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    expect(file.nodes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(file.edges).toEqual([
      [1, 0, 2, 0],
      [2, 0, 3, 0],
    ]);
  });

  it("stamps the current format version", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    expect(file.formatVersion).toBe(FLOW_FILE_FORMAT_VERSION);
  });
});

describe("serializeFlowFileText: determinism", () => {
  it("re-serializing an unchanged flow produces byte-identical text -- the actual git-diff requirement", () => {
    const textA = serializeFlowFileText(buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES));
    // Same data, different input order (as if nodes/edges were rebuilt
    // from a live canvas in a different iteration order) -- must still
    // produce identical output.
    const shuffledNodes = [SAMPLE_NODES[2]!, SAMPLE_NODES[0]!, SAMPLE_NODES[1]!];
    const shuffledEdges: FlowFileEdge[] = [SAMPLE_EDGES[1]!, SAMPLE_EDGES[0]!];
    const textB = serializeFlowFileText(buildFlowFile(shuffledNodes, shuffledEdges));
    expect(textA).toBe(textB);
  });

  it("layout's numeric-string keys come out ascending regardless of insertion order -- a real JS/JSON engine guarantee (ECMAScript's integer-index property ordering), not a convention this code has to enforce itself", () => {
    // Node 10 built before node 2 -- if key order followed insertion,
    // "10" would sort before "2" as a string. It doesn't: JS engines
    // order integer-like keys ascending numerically.
    const nodes: CanvasNodeSnapshot[] = [
      { id: 10, type: "thingstudio/debug", properties: {}, pos: [0, 0] },
      { id: 2, type: "thingstudio/debug", properties: {}, pos: [0, 0] },
    ];
    const text = serializeFlowFileText(buildFlowFile(nodes, []));
    const idx2 = text.indexOf('"2":');
    const idx10 = text.indexOf('"10":');
    expect(idx2).toBeGreaterThan(-1);
    expect(idx10).toBeGreaterThan(-1);
    expect(idx2).toBeLessThan(idx10);
  });

  it("ends with a trailing newline", () => {
    const text = serializeFlowFileText(buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES));
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("parseFlowFile: round-trip and validation", () => {
  it("round-trips build -> serialize -> parse back to an equivalent structure", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    const parsed = parseFlowFile(serializeFlowFileText(file));
    expect(parsed).toEqual(file);
  });

  it("rejects non-JSON text", () => {
    expect(() => parseFlowFile("not json {{{")).toThrow(FlowFileError);
    expect(() => parseFlowFile("not json {{{")).toThrow(/not valid JSON/);
  });

  it("rejects a wrong/missing formatVersion rather than silently misparsing", () => {
    expect(() => parseFlowFile(JSON.stringify({ formatVersion: 999, nodes: [], edges: [], layout: {} }))).toThrow(/formatVersion/);
    expect(() => parseFlowFile(JSON.stringify({ nodes: [], edges: [], layout: {} }))).toThrow(/formatVersion/);
  });

  it("rejects malformed nodes/edges/layout with a specific reason, not a generic crash", () => {
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    expect(() => parseFlowFile(JSON.stringify({ ...base, nodes: [{ id: "not-a-number", type: "x", properties: {} }] }))).toThrow(/nodes\[0\]\.id/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, edges: [[1, 0, 2]] }))).toThrow(/edges\[0\]/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, layout: { "1": { pos: [0] } } }))).toThrow(/layout\["1"\]\.pos/);
  });
});
