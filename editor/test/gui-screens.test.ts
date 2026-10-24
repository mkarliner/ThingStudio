// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-screens.test.ts
//
// A page is a cell grid (gui-grid-layout-scoping.md, 2026-10-24): an element's rect is its span mapped to pixels,
// with a gutter derived from the cell, and a span outside the grid or two elements on the same cells are errors.

import { describe, expect, it } from "vitest";
import { compileScreens, type ScreensSection } from "../src/gui/screens.js";
import type { GraphNode } from "../src/compiler/graph.js";

const nodes = [
  { id: "s", type: "thingstudio/gui_screen", properties: {} },
  { id: "hist", type: "thingstudio/gui_trend", properties: { lo: 0, hi: 100 } },
  { id: "bar", type: "thingstudio/gui_bar", properties: {} },
] as unknown as GraphNode[];

const size = () => ({ width: 200, height: 200 }); // 12 x 12 cells, 16.67px each, 2px gutter

function compileOnce(elements: ScreensSection["s"]["pages"][number]["elements"]) {
  return compileScreens({ s: { pages: [{ name: "p", elements }] } }, nodes, size);
}

describe("a widget's rect in the grid", () => {
  it("is its cell span, plus the gutter", () => {
    const out = compileOnce([{ kind: "widget", node: "hist", row: 2, col: 1, rowSpan: 3, colSpan: 6 }]);
    expect(out.errors).toEqual([]);
    expect(out.surfaces[0]!.rects.get("p")!.get("hist")).toEqual({ x: 19, y: 35, width: 96, height: 46 });
  });

  it("refuses two elements on the same cells", () => {
    const out = compileOnce([
      { kind: "widget", node: "hist", row: 0, col: 0, rowSpan: 2, colSpan: 4 },
      { kind: "widget", node: "bar", row: 1, col: 2, rowSpan: 1, colSpan: 2 },
    ]);
    expect(out.errors.join("\n")).toMatch(/overlaps/);
  });

  it("refuses a span outside the grid", () => {
    const out = compileOnce([{ kind: "widget", node: "bar", row: 0, col: 11, colSpan: 2 }]);
    expect(out.errors.join("\n")).toMatch(/outside the 12x12 grid/);
  });

  it("lets a widget sit on a panel's cells, and a panel on another panel not", () => {
    const ok = compileOnce([
      { card: true, row: 0, col: 0, rowSpan: 4, colSpan: 12 },
      { kind: "widget", node: "hist", row: 0, col: 0, rowSpan: 2, colSpan: 6 },
    ]);
    expect(ok.errors).toEqual([]);
    const bad = compileOnce([
      { card: true, row: 0, col: 0, rowSpan: 4, colSpan: 12 },
      { card: true, row: 1, col: 1, rowSpan: 2, colSpan: 4 },
    ]);
    expect(bad.errors.join("\n")).toMatch(/overlaps/);
  });
});
