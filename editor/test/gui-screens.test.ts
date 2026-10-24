// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-screens.test.ts
//
// A widget's natural size comes from its node properties; the layout outline's placement `height` is a per-page
// override that only the bar uses. The histogram read `el.height` first, so a placement height left over from a
// previous bar ignored the node's own height property (found on the CYD, 2026-10-24).

import { describe, expect, it } from "vitest";
import { compileScreens, type ScreensSection } from "../src/gui/screens.js";
import type { GraphNode } from "../src/compiler/graph.js";

const nodes = [
  { id: "s", type: "thingstudio/gui_screen", properties: {} },
  { id: "hist", type: "thingstudio/gui_trend", properties: { height: 30, columns: 10, colWidth: 3 } },
  { id: "bar", type: "thingstudio/gui_bar", properties: {} },
] as unknown as GraphNode[];

const size = () => ({ width: 200, height: 200 });

describe("a widget's natural size in the layout", () => {
  it("takes a histogram's height from its node property, not a placement height", () => {
    const screens: ScreensSection = {
      s: { pages: [{ name: "p", root: { kind: "column", children: [{ kind: "widget", node: "hist", height: 99 }] } }] },
    };
    const out = compileScreens(screens, nodes, size);
    expect(out.errors).toEqual([]);
    expect(out.surfaces[0]!.rects.get("p")!.get("hist")!.height).toBe(30);
  });

  it("still lets a bar's placement height size it (it has no height property)", () => {
    const screens: ScreensSection = {
      s: { pages: [{ name: "p", root: { kind: "column", children: [{ kind: "widget", node: "bar", height: 22 }] } }] },
    };
    const out = compileScreens(screens, nodes, size);
    expect(out.errors).toEqual([]);
    expect(out.surfaces[0]!.rects.get("p")!.get("bar")!.height).toBe(22);
  });
});
