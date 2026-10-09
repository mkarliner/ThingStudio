// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-layout.test.ts -- the GUI layout engine against expected rect tables (2026-10-07).

import { describe, expect, it } from "vitest";
import { getFont, textWidth } from "../src/gui/font-metrics.js";
import { layoutPage, naturalSize, type Container, type Leaf, type LayoutNode, type Rect } from "../src/gui/layout.js";

const CTX = { display: "tft", page: "home" };
const leaf = (id: string, width: number, height: number, extra: Partial<Leaf> = {}): Leaf => ({ kind: "leaf", id, natural: { width, height }, ...extra });
const col = (id: string, children: LayoutNode[], extra: Partial<Container> = {}): Container => ({ kind: "column", id, children, ...extra });
const row = (id: string, children: LayoutNode[], extra: Partial<Container> = {}): Container => ({ kind: "row", id, children, ...extra });
const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function rects(root: LayoutNode, width = 100, height = 100): Record<string, Rect> {
  const out = layoutPage(root, { width, height }, CTX);
  expect(out.errors).toEqual([]);
  return Object.fromEntries(out.rects);
}

describe("naturalSize", () => {
  it("adds children, gaps and padding along the main axis, takes the largest across", () => {
    expect(naturalSize(row("r", [leaf("a", 10, 5), leaf("b", 20, 8)], { gap: 4, padding: 2 }))).toEqual({ width: 38, height: 12 });
    expect(naturalSize(col("c", [leaf("a", 10, 5), leaf("b", 20, 8)], { gap: 4 }))).toEqual({ width: 20, height: 17 });
    expect(naturalSize(col("empty", [], { padding: 3 }))).toEqual({ width: 6, height: 6 });
  });
});

describe("main axis", () => {
  it("stacks natural sizes from the start, with gap and padding", () => {
    expect(rects(col("c", [leaf("a", 10, 20), leaf("b", 10, 30)], { gap: 5, padding: 2, align: "start" }))).toEqual({
      c: r(0, 0, 100, 100),
      a: r(2, 2, 10, 20),
      b: r(2, 27, 10, 30),
    });
  });

  it("shares free space by grow weight, leftover pixels to the first growers", () => {
    // 100 wide, 10 + 10 natural, 80 free: weights 1 and 2 -> 26 and 53, plus 1 leftover to the first.
    expect(rects(row("r", [leaf("a", 10, 10, { grow: 1 }), leaf("b", 10, 10, { grow: 2 })]))).toMatchObject({
      a: r(0, 0, 37, 100),
      b: r(37, 0, 63, 100),
    });
  });

  it("justify: center, end and space-between", () => {
    const kids = () => [leaf("a", 10, 10), leaf("b", 10, 10), leaf("c", 10, 10)];
    expect(rects(row("r", kids(), { justify: "center", align: "start" }))).toMatchObject({ a: r(35, 0, 10, 10), c: r(55, 0, 10, 10) });
    expect(rects(row("r", kids(), { justify: "end", align: "start" }))).toMatchObject({ a: r(70, 0, 10, 10), c: r(90, 0, 10, 10) });
    // 70 free over two gaps: 35 each.
    expect(rects(row("r", kids(), { justify: "space-between", align: "start" }))).toMatchObject({
      a: r(0, 0, 10, 10),
      b: r(45, 0, 10, 10),
      c: r(90, 0, 10, 10),
    });
  });

  it("space-between with one child is start; grow wins over justify", () => {
    expect(rects(row("r", [leaf("a", 10, 10)], { justify: "space-between", align: "start" }))).toMatchObject({ a: r(0, 0, 10, 10) });
    expect(rects(row("r", [leaf("a", 10, 10), leaf("b", 10, 10, { grow: 1 })], { justify: "end", align: "start" }))).toMatchObject({
      a: r(0, 0, 10, 10),
      b: r(10, 0, 90, 10),
    });
  });
});

describe("cross axis", () => {
  it("stretch by default; start, center, end; alignSelf overrides", () => {
    const out = rects(
      row("r", [
        leaf("s", 10, 20),
        leaf("st", 10, 20, { alignSelf: "start" }),
        leaf("c", 10, 21, { alignSelf: "center" }),
        leaf("e", 10, 20, { alignSelf: "end" }),
      ]),
    );
    expect(out).toMatchObject({ s: r(0, 0, 10, 100), st: r(10, 0, 10, 20), c: r(20, 39, 10, 21), e: r(30, 80, 10, 20) });
  });
});

describe("overflow is an attributed build error", () => {
  it("names the widget, its size, the room it has, the page and the display", () => {
    const out = layoutPage(col("column 1", [leaf("w1", 84, 10, { label: "readout 'Temperature'", alignSelf: "start" })]), { width: 60, height: 40 }, CTX);
    expect(out.errors).toEqual([
      { id: "w1", message: `readout 'Temperature''s natural width 84px exceeds the 60px column 1 gives it on page "home" of display "tft"` },
    ]);
  });

  it("names a container whose children don't fit along it, listing them", () => {
    const out = layoutPage(row("bar", [leaf("a", 40, 10), leaf("b", 30, 10)], { gap: 10 }), { width: 70, height: 10 }, CTX);
    expect(out.errors).toEqual([{ id: "bar", message: `bar's contents need 80px of width but it has 70px on page "home" of display "tft": a 40px, b 30px` }]);
  });

  it("reports an id used twice", () => {
    const out = layoutPage(col("c", [leaf("a", 1, 1), leaf("a", 1, 1)]), { width: 10, height: 10 }, CTX);
    expect(out.errors.map((e) => e.message)).toEqual([`"a" appears twice on page "home" of display "tft"`]);
  });
});

describe("a hero-style page, measured with the real fonts", () => {
  const text = (id: string, font: string, s: string, extra: Partial<Leaf> = {}): Leaf =>
    leaf(id, textWidth(font, s), getFont(font).height, { label: `"${s}"`, ...extra });
  const page = (): Container =>
    col("page", [
      row("title", [text("t", "font_body20", "Living room")], { padding: 6 }),
      row("main", [text("value", "font_digits64", "-10.5"), text("unit", "font_body24", "°C", { alignSelf: "start" })], { grow: 1, gap: 4, padding: 8, align: "center" }),
      row("footer", [text("upd", "font_body12", "Updated 12:04")], { justify: "end", padding: 4 }),
    ]);

  it("fits the CYD's 320x240, every rect inside the screen", () => {
    const out = layoutPage(page(), { width: 320, height: 240 }, CTX);
    expect(out.errors).toEqual([]);
    for (const [id, rc] of out.rects) {
      expect(rc.x >= 0 && rc.y >= 0 && rc.x + rc.width <= 320 && rc.y + rc.height <= 240, id).toBe(true);
    }
    const main = out.rects.get("main")!;
    const footer = out.rects.get("footer")!;
    expect(footer.y + footer.height).toBe(240); // main grew to fill the space between title and footer
    expect(main.y).toBe(out.rects.get("title")!.height);
  });

  it("the same page on a 128x64 OLED is a build error naming what doesn't fit", () => {
    const out = layoutPage(page(), { width: 128, height: 64 }, { display: "oled", page: "home" });
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.errors.some((e) => e.id === "page" && e.message.includes(`of display "oled"`))).toBe(true);
  });
});

describe("flex children", () => {
  it("equal weights split the whole row equally, whatever the natural widths", () => {
    expect(rects(row("r", [leaf("a", 20, 10, { grow: 1, flex: true }), leaf("b", 40, 10, { grow: 1, flex: true })], { gap: 10 }))).toMatchObject({
      a: { x: 0, width: 45 },
      b: { x: 55, width: 45 },
    });
  });
  it("a child whose natural size beats its share keeps it and the rest share what is left", () => {
    expect(rects(row("r", [leaf("a", 80, 10, { grow: 1, flex: true }), leaf("b", 10, 10, { grow: 1, flex: true }), leaf("c", 10, 10, { grow: 1, flex: true })]))).toMatchObject({
      a: { width: 80 },
      b: { x: 80, width: 10 },
      c: { x: 90, width: 10 },
    });
  });
});
