// SPDX-License-Identifier: Apache-2.0
// editor/test/font-metrics.test.ts -- the GUI font set as the layout engine measures it (2026-10-07).

import { describe, expect, it } from "vitest";
import { fontIds, getFont, glyphBitmap, missingChars, textWidth, widestWidth } from "../src/gui/font-metrics.js";

describe("font set", () => {
  it("has the body, digits and seven-segment ladders", () => {
    expect(fontIds()).toEqual([
      "font_body12", "font_body16", "font_body20", "font_body24",
      "font_digits16", "font_digits24", "font_digits32", "font_digits48", "font_digits64",
      "font_seg748", "font_seg764", "font_seg796",
    ]);
  });

  it("each font's height is within a pixel of its nominal size, and every glyph has a full bitmap", () => {
    for (const id of fontIds()) {
      const f = getFont(id);
      // font_to_py's height isn't exactly the size asked for (digits48 is 47, body16 is 17): layout uses
      // `height`, never `size`.
      expect(Math.abs(f.height - f.size), id).toBeLessThanOrEqual(1);
      for (const [ch, [width, b64]] of Object.entries(f.glyphs)) {
        expect(atob(b64).length, `${id} ${ch}`).toBe(((width + 7) >> 3) * f.height);
      }
    }
  });
});

describe("textWidth", () => {
  it("matches font_to_py's own widths for the sample strings (tools/build_fonts.py)", () => {
    for (const id of fontIds()) {
      for (const [s, expected] of Object.entries(getFont(id).samples)) {
        expect(textWidth(id, s), `${id} "${s}"`).toBe(expected);
      }
    }
  });

  it("counts a character outside the charset as the error glyph, as the board draws it", () => {
    expect(textWidth("font_digits32", "A")).toBe(textWidth("font_digits32", "?"));
  });

  it("names an unknown font", () => {
    expect(() => textWidth("font_body99", "x")).toThrow(/unknown font "font_body99"/);
  });
});

describe("missingChars", () => {
  it("lists characters the font lacks, once each", () => {
    expect(missingChars("font_digits32", "21.9°C°")).toEqual(["°", "C"]);
    expect(missingChars("font_body16", "21.9 °C ±0.5 µs")).toEqual([]);
  });
});

describe("widestWidth", () => {
  it("is at least as wide as any real value of that length", () => {
    const w = widestWidth("font_digits32", 5, "0123456789.-");
    for (const s of ["-10.5", "21.95", "88888", "11111"]) expect(textWidth("font_digits32", s)).toBeLessThanOrEqual(w);
  });
});

describe("glyphBitmap", () => {
  it("gives one row per pixel of height, with some pixels set for a visible glyph", () => {
    const g = glyphBitmap("font_digits48", "8");
    expect(g.rows).toHaveLength(getFont("font_digits48").height);
    expect(g.rows.some((r) => r.some((b) => b !== 0))).toBe(true);
    expect(glyphBitmap("font_body16", " ").rows.every((r) => r.every((b) => b === 0))).toBe(true);
  });
});
