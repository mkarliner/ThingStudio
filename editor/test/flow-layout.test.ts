// SPDX-License-Identifier: Apache-2.0
// editor/test/flow-layout.test.ts
//
// Mike's rule, 2026-10-22: a flow we author reads left to right. Every wire goes to a node further
// right than the one it comes from, branches stack vertically in their column, and nothing wraps back
// to the left edge on a second row -- that wrap is what made the hero flows look like a rats nest even
// though the graph itself was fine.
//
// The check is over test-flows/*.flow.json, the flows this repo authors and ships as hand-run tests.
// A user's own flow can be laid out however they like; the editor never repositions nodes on load.
// `python3 test-flows/relayout.py` fixes a file that fails this.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "..", "test-flows");

interface FlowFile {
  flowName?: string;
  nodes: { id: string }[];
  edges: [string, number, string, number][];
  layout?: Record<string, { pos: [number, number] }>;
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".flow.json"))
  .sort();

describe("authored flow layout", () => {
  it("finds the flows to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file} runs left to right`, () => {
      const flow = JSON.parse(readFileSync(join(DIR, file), "utf8")) as FlowFile;
      const layout = flow.layout ?? {};

      const unplaced = flow.nodes.map((n) => n.id).filter((id) => !layout[id]?.pos);
      expect(unplaced, `${file}: nodes with no layout position`).toEqual([]);

      const backwards = flow.edges
        .filter(([from, , to]) => {
          const a = layout[from]?.pos;
          const b = layout[to]?.pos;
          return a && b && b[0] <= a[0];
        })
        .map(([from, , to]) => `${from} (x=${layout[from]!.pos[0]}) -> ${to} (x=${layout[to]!.pos[0]})`);
      expect(backwards, `${file}: wires that go left or straight down`).toEqual([]);
    });
  }
});
