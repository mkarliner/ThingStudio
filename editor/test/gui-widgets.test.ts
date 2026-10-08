// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-widgets.test.ts -- widget natural sizes match the board's draw routines (2026-10-08).

import { describe, expect, it } from "vitest";
import fixture from "./fixtures/gui-widget-sizes.json";
import { readoutField, widgetNatural, type WidgetKind } from "../src/gui/widgets.js";
import { textWidth } from "../src/gui/font-metrics.js";

describe("widget natural sizes", () => {
  it("match the shared fixture the board-side test also checks", () => {
    for (const c of fixture.cases) {
      const n = widgetNatural(c.widget as WidgetKind, c.cfg as Record<string, unknown>);
      expect([n.width, n.height], `${c.widget} ${JSON.stringify(c.cfg)}`).toEqual(c.natural);
    }
  });

  it("a readout's field fits every value in its range", () => {
    const field = readoutField("font_digits48", -20, 50, 1);
    for (let v = -20; v <= 50; v += 0.1) {
      expect(textWidth("font_digits48", v.toFixed(1)), v.toFixed(1)).toBeLessThanOrEqual(field);
    }
    expect(textWidth("font_digits48", "--")).toBeLessThanOrEqual(field);
  });

  it("a readout with units but no units font is refused", () => {
    expect(() => widgetNatural("readout", { font: "font_digits32", units: "%" })).toThrow(/units font/);
  });
});
