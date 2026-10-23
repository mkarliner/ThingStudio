// SPDX-License-Identifier: Apache-2.0
// editor/test/cli-layout.test.ts
//
// The layout check and fix (src/cli/layout.ts) behind thingstudio-compile --layout and --relayout: flows we author
// read left to right and are kept tight (Mike, 2026-10-22 and 2026-10-23).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkLayout, relayout, SPACING, type LayoutEdge, type LayoutNode } from "../src/cli/layout.js";
import { checkFlowText, relayoutFlowText } from "../src/cli/check-flow.js";

const n = (id: string, width = 100, height = 34): LayoutNode => ({ id, width, height });
const chain: LayoutNode[] = [n("a"), n("b"), n("c")];
const wires: LayoutEdge[] = [["a", 0, "b", 0], ["b", 0, "c", 0]];

describe("checkLayout", () => {
  it("passes a tight left-to-right row", () => {
    expect(checkLayout(chain, wires, { a: [80, 80], b: [300, 80], c: [520, 80] })).toEqual([]);
  });

  it("reports nodes with no position", () => {
    const w = checkLayout(chain, wires, { a: [80, 80] });
    expect(w.join("\n")).toMatch(/no position for b, c/);
  });

  it("reports a wire that goes backwards or straight down", () => {
    const w = checkLayout(chain, wires, { a: [80, 80], b: [300, 80], c: [80, 160] });
    expect(w.join("\n")).toMatch(/wire b -> c runs right to left/);
    expect(checkLayout(chain, wires, { a: [80, 80], b: [80, 160], c: [300, 160] }).join("\n")).toMatch(/wire a -> b/);
  });

  it("reports a node too close to see its wire", () => {
    expect(checkLayout(chain, wires, { a: [80, 80], b: [200, 80], c: [420, 80] }).join("\n")).toMatch(/b starts only 20 px after a ends/);
  });

  it("reports overlapping nodes", () => {
    const nodes = [n("a"), n("b"), n("x")];
    const w = checkLayout(nodes, [["a", 0, "b", 0]], { a: [80, 80], b: [300, 80], x: [90, 100] });
    expect(w.join("\n")).toMatch(/a and x overlap/);
  });

  it("reports a flow spread out with empty space", () => {
    expect(checkLayout(chain, wires, { a: [80, 80], b: [500, 80], c: [720, 80] }).join("\n")).toMatch(/empty space between x=180 and x=500/);
    const twoRows = [n("a"), n("b"), n("c"), n("d")];
    const w = checkLayout(twoRows, [["a", 0, "b", 0], ["c", 0, "d", 0]], { a: [80, 80], b: [300, 80], c: [80, 400], d: [300, 400] });
    expect(w.join("\n")).toMatch(/empty space between y=114 and y=400/);
  });

  it("reports a flow that starts off screen", () => {
    expect(checkLayout(chain, wires, { a: [900, 80], b: [1120, 80], c: [1340, 80] }).join("\n")).toMatch(/starts at \(900, 80\)/);
  });

  it("reports a wire that is nearly but not quite straight", () => {
    expect(checkLayout(chain, wires, { a: [80, 80], b: [300, 88], c: [520, 88] }).join("\n")).toMatch(/a and b are 8 px out of line/);
  });

  it("caps a run of the same problem", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => n(`n${i}`));
    const edges = nodes.slice(1).map((x, i): LayoutEdge => [`n${i}`, 0, x.id, 0]);
    const pos = Object.fromEntries(nodes.map((x, i) => [x.id, [80 + (7 - i) * 220, 80] as [number, number]]));
    const w = checkLayout(nodes, edges, pos).filter((s) => /right to left|more wires/.test(s));
    expect(w).toHaveLength(4);
    expect(w[3]).toMatch(/4 more wires/);
  });
});

describe("relayout", () => {
  it("lays a chain out as one straight row from the origin", () => {
    expect(relayout(chain, wires)).toEqual({ a: [80, 80], b: [80 + SPACING.columnPitch, 80], c: [80 + 2 * SPACING.columnPitch, 80] });
  });

  it("stacks separate chains, and puts unwired nodes last", () => {
    const nodes = [n("a"), n("b"), n("lone"), n("c"), n("d")];
    const p = relayout(nodes, [["a", 0, "b", 0], ["c", 0, "d", 0]]);
    expect(p.a![1]).toBe(80);
    expect(p.c![1]).toBe(80 + 34 + SPACING.groupGap);
    expect(p.lone![1]).toBeGreaterThan(p.c![1]);
    expect(p.lone![0]).toBe(80);
  });

  it("puts a node after its longest path in, so no wire goes back", () => {
    const nodes = [n("s"), n("m"), n("t")];
    const p = relayout(nodes, [["s", 0, "m", 0], ["m", 0, "t", 0], ["s", 0, "t", 1]]);
    expect(p.t![0]).toBeGreaterThan(p.m![0]);
  });

  it("clears a tall node above when stacking a branch", () => {
    const nodes = [n("s"), n("tall", 100, 74), n("x")];
    const p = relayout(nodes, [["s", 0, "tall", 0], ["s", 0, "x", 0]]);
    expect(p.x![1] - p.tall![1]).toBe(74 + SPACING.rowGap);
  });

  it("does not loop on a cycle", () => {
    expect(() => relayout(chain, [...wires, ["c", 0, "a", 0]])).not.toThrow();
  });

  it("gives every shipped flow a layout the check passes", () => {
    const dir = join(__dirname, "..", "..", "test-flows");
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith(".flow.json")).map((f) => join(dir, f)),
      ...readdirSync(join(dir, "ai-authoring")).filter((f) => f.endsWith(".flow.json")).map((f) => join(dir, "ai-authoring", f)),
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const out = relayoutFlowText(readFileSync(file, "utf8"));
      const layoutWarnings = checkFlowText(out, { layout: true }).warnings.filter((w) => w.startsWith("layout:"));
      expect(layoutWarnings, file).toEqual([]);
    }
  });
});

describe("relayoutFlowText", () => {
  it("changes positions only, and keeps a saved size", () => {
    const text = JSON.stringify({
      formatVersion: 1, flowName: "t",
      nodes: [{ id: "t1", type: "thingstudio/timer", properties: { intervalMs: 500 } }, { id: "g1", type: "thingstudio/gpio_out", properties: { pin: 15 } }],
      edges: [["t1", 0, "g1", 0]],
      layout: { t1: { pos: [700, 700], size: [84, 34] }, g1: { pos: [10, 10] } },
      configs: [], notes: "keep me",
    });
    const out = JSON.parse(relayoutFlowText(text));
    expect(out.notes).toBe("keep me");
    expect(out.nodes).toEqual(JSON.parse(text).nodes);
    expect(out.layout.t1).toEqual({ pos: [80, 80], size: [84, 34] });
    expect(out.layout.g1.pos[0]).toBeGreaterThan(80);
  });
});
