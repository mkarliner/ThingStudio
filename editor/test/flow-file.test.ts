// SPDX-License-Identifier: Apache-2.0
// editor/test/flow-file.test.ts
//
// Off-device tests for the flow file format's pure logic (flow-file.ts's
// own header explains why it's Litegraph-independent and testable this
// way, same pattern as compile.ts). The two things that actually matter
// per design doc §6: nodes/edges vs. layout are genuinely separate
// sections, and re-saving unchanged data is byte-identical (a real `git
// diff` requirement, not just "looks right").
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// `configs` coverage added 2026-08-18 -- same determinism/round-trip bar
// as nodes/edges, plus validation-error cases for malformed entries and
// the "absent `configs` key on an older/hand-written file parses as no
// configs" backward-compatibility contract flow-file.ts's own header
// documents.
//
// Node ids, string not numeric (updated 2026-09-04, decisions.md's
// "Stable node IDs" entry): SAMPLE_NODES/SAMPLE_EDGES below use small
// string ids ("1"/"2"/"3") purely for readability in this file -- real
// ids are crypto.randomUUID() strings (flow-file.ts's own header), but
// nothing here depends on the id's actual shape, only that it's a
// string and that string comparison sorts it deterministically.

import { describe, expect, it } from "vitest";
import {
  buildFlowFile,
  DEFAULT_FLOW_NAME,
  FLOW_FILE_FORMAT_VERSION,
  FlowFileError,
  parseFlowFile,
  serializeFlowFileText,
  type CanvasNodeSnapshot,
  type FlowFileConfig,
  type FlowFileEdge,
} from "../src/flow-file/flow-file.js";

const SAMPLE_NODES: CanvasNodeSnapshot[] = [
  { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 }, pos: [300, 100] },
  { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" }, pos: [80, 80], size: [190, 130] },
  { id: "2", type: "thingstudio/function", properties: { code: "return msg\n" }, pos: [200, 90] },
];
const SAMPLE_EDGES: FlowFileEdge[] = [
  ["2", 0, "3", 0],
  ["1", 0, "2", 0],
];
const SAMPLE_CONFIGS: FlowFileConfig[] = [
  { id: "wifi-b", type: "thingstudio/config/wifi", properties: { ssid: "SecondNet", password: "b" } },
  { id: "wifi-a", type: "thingstudio/config/wifi", properties: { ssid: "FirstNet", password: "a" } },
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
    expect(file.nodes.map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(file.edges).toEqual([
      ["1", 0, "2", 0],
      ["2", 0, "3", 0],
    ]);
  });

  it("stamps the current format version", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    expect(file.formatVersion).toBe(FLOW_FILE_FORMAT_VERSION);
  });

  it("defaults configs to an empty array when omitted", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    expect(file.configs).toEqual([]);
  });

  it("sorts configs by id (string comparison), regardless of input order", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES, SAMPLE_CONFIGS);
    expect(file.configs.map((c) => c.id)).toEqual(["wifi-a", "wifi-b"]);
  });

  it("defaults flowName to DEFAULT_FLOW_NAME when omitted", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES);
    expect(file.flowName).toBe(DEFAULT_FLOW_NAME);
  });

  it("uses the given flowName when provided", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES, [], "my named flow");
    expect(file.flowName).toBe("my named flow");
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

  it("re-serializing unchanged configs, in a different input order, also stays byte-identical", () => {
    const textA = serializeFlowFileText(buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES, SAMPLE_CONFIGS));
    const shuffledConfigs: FlowFileConfig[] = [SAMPLE_CONFIGS[1]!, SAMPLE_CONFIGS[0]!];
    const textB = serializeFlowFileText(buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES, shuffledConfigs));
    expect(textA).toBe(textB);
  });

  it("layout keys come out in the same deterministic (string-sorted) order as `nodes`, regardless of insertion order", () => {
    // Updated 2026-09-04 (decisions.md's "Stable node IDs" entry): this
    // used to test the ECMAScript "integer-index property ordering"
    // guarantee (small-integer-like string keys sort ascending
    // numerically regardless of insertion order, even though they're
    // still strings) -- that guarantee doesn't apply any more now that
    // real node ids are crypto.randomUUID() strings, not small integers.
    // What buildFlowFile() actually guarantees now (flow-file.ts's own
    // header): layout keys are written in `sortedNodes`' own
    // deterministic string-sorted order, which is what this checks --
    // "b" (from a node built first) still lands after "a" (built second)
    // in the serialized output, because the sort key is the id string,
    // never insertion order.
    const nodes: CanvasNodeSnapshot[] = [
      { id: "b-node", type: "thingstudio/debug", properties: {}, pos: [0, 0] },
      { id: "a-node", type: "thingstudio/debug", properties: {}, pos: [0, 0] },
    ];
    const text = serializeFlowFileText(buildFlowFile(nodes, []));
    const idxA = text.indexOf('"a-node":');
    const idxB = text.indexOf('"b-node":');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
    expect(idxA).toBeLessThan(idxB);
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

  it("round-trips with configs included", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES, SAMPLE_CONFIGS);
    const parsed = parseFlowFile(serializeFlowFileText(file));
    expect(parsed).toEqual(file);
    expect(parsed.configs.map((c) => c.id)).toEqual(["wifi-a", "wifi-b"]);
  });

  it("treats a missing `configs` key (an older, pre-config-nodes flow file) as no configs, not a validation error", () => {
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    const parsed = parseFlowFile(JSON.stringify(base));
    expect(parsed.configs).toEqual([]);
  });

  it("round-trips flowName", () => {
    const file = buildFlowFile(SAMPLE_NODES, SAMPLE_EDGES, [], "my named flow");
    const parsed = parseFlowFile(serializeFlowFileText(file));
    expect(parsed.flowName).toBe("my named flow");
  });

  it("treats a missing `flowName` key (an older, pre-flow-name flow file) as DEFAULT_FLOW_NAME, not a validation error", () => {
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    const parsed = parseFlowFile(JSON.stringify(base));
    expect(parsed.flowName).toBe(DEFAULT_FLOW_NAME);
  });

  it("rejects a non-string flowName", () => {
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    expect(() => parseFlowFile(JSON.stringify({ ...base, flowName: 123 }))).toThrow(/"flowName" must be a string/);
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
    // Updated 2026-09-04: node ids are string now (decisions.md's
    // "Stable node IDs" entry) -- a string id is valid, so the malformed
    // case is a NUMBER where a string is required, the mirror image of
    // what this test checked before the id type flipped.
    expect(() => parseFlowFile(JSON.stringify({ ...base, nodes: [{ id: 123, type: "x", properties: {} }] }))).toThrow(/nodes\[0\]\.id/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, edges: [[1, 0, 2]] }))).toThrow(/edges\[0\]/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, layout: { "1": { pos: [0] } } }))).toThrow(/layout\["1"\]\.pos/);
  });

  it("rejects an edge whose node-id columns aren't strings, or whose slot columns aren't numbers", () => {
    // New case, 2026-09-04: edges are now [string, number, string, number]
    // (flow-file.ts's header) rather than 4 plain numbers -- a
    // number where a node id belongs, or a string where a slot index
    // belongs, must both fail the same way a wrong-length array does.
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    expect(() => parseFlowFile(JSON.stringify({ ...base, edges: [[1, 0, 2, 0]] }))).toThrow(/edges\[0\]/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, edges: [["a", "0", "b", 0]] }))).toThrow(/edges\[0\]/);
  });

  it("rejects a non-array configs field", () => {
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    expect(() => parseFlowFile(JSON.stringify({ ...base, configs: { not: "an array" } }))).toThrow(/"configs" must be an array/);
  });

  it("rejects malformed config entries with a specific reason", () => {
    const base = { formatVersion: FLOW_FILE_FORMAT_VERSION, nodes: [], edges: [], layout: {} };
    expect(() => parseFlowFile(JSON.stringify({ ...base, configs: [{ id: 1, type: "x", properties: {} }] }))).toThrow(/configs\[0\]\.id/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, configs: [{ id: "x", type: 1, properties: {} }] }))).toThrow(/configs\[0\]\.type/);
    expect(() => parseFlowFile(JSON.stringify({ ...base, configs: [{ id: "x", type: "x", properties: null }] }))).toThrow(/configs\[0\]\.properties/);
  });
});
