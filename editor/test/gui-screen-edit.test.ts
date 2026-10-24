// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-screen-edit.test.ts
//
// The pure edits behind the layout outline, on the cell-grid model (2026-10-24): elements are placed by row,
// column and spans; the list order is only the order the outline shows.

import { describe, expect, it } from "vitest";
import { add, addModal, forgetNodes, addPage, move, movePage, outline, placedWidgets, remove, removeModal, removePage, setProps, type Target } from "../src/gui/screen-edit.js";
import type { GridElement, ScreenSpec } from "../src/gui/screens.js";

const w = (node: string, row = 0, col = 0): GridElement => ({ kind: "widget", node, row, col });
const home: Target = { page: "home" };
const labels = (s: ScreenSpec, t: Target = home): string[] => {
  const elements = "page" in t ? s.pages.find((p) => p.name === t.page)!.elements : s.modals!.find((m) => m.node === t.modal)!.elements;
  return outline(elements, (id) => id).map((r) => r.label);
};

const base = (): ScreenSpec => ({
  pages: [
    { name: "home", elements: [w("a"), w("b"), w("c")] },
    { name: "two", elements: [] },
  ],
});

describe("screen-edit", () => {
  it("moves an element earlier or later in the list, and not past the ends", () => {
    let s = move(base(), home, 2, -1);
    expect(labels(s)).toEqual(["a", "c", "b"]);
    s = move(s, home, 0, -1);
    expect(labels(s)).toEqual(["a", "c", "b"]);
  });

  it("does not mutate what it was given", () => {
    const s = base();
    const before = JSON.stringify(s);
    move(s, home, 0, 1);
    remove(s, home, 0);
    setProps(s, home, 0, { row: 3 });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("adds, removes and edits placement properties", () => {
    let s = add(base(), home, w("d", 2, 3));
    expect(labels(s)).toEqual(["a", "b", "c", "d"]);
    s = setProps(s, home, 0, { row: 1, col: 2, rowSpan: 3, colSpan: 4, card: true });
    const el = s.pages[0]!.elements[0]!;
    expect(el).toMatchObject({ node: "a", row: 1, col: 2, rowSpan: 3, colSpan: 4, card: true });
    s = setProps(s, home, 0, { rowSpan: undefined, card: undefined });
    expect(s.pages[0]!.elements[0]).toMatchObject({ node: "a", row: 1, col: 2, colSpan: 4 });
    expect("rowSpan" in s.pages[0]!.elements[0]!).toBe(false);
    s = remove(s, home, 0);
    expect(labels(s)).toEqual(["b", "c", "d"]);
  });

  it("keeps a panel element separate from the widgets around it", () => {
    let s = add(base(), home, { card: true, row: 0, col: 0, rowSpan: 2, colSpan: 6 });
    expect(labels(s)).toEqual(["a", "b", "c", "panel"]);
    s = setProps(s, home, 3, { row: 1 });
    expect(s.pages[0]!.elements[3]).toMatchObject({ card: true, row: 1 });
  });

  it("reports which widgets are placed, panels excluded", () => {
    const s = add(base(), home, { card: true, row: 0, col: 0 });
    expect([...placedWidgets(s)].sort()).toEqual(["a", "b", "c"]);
  });

  it("adds, removes and reorders pages", () => {
    let s = addPage(base(), "three");
    expect(s.pages.map((p) => p.name)).toEqual(["home", "two", "three"]);
    s = movePage(s, "three", -1);
    expect(s.pages.map((p) => p.name)).toEqual(["home", "three", "two"]);
    expect(s.carousel).toEqual(["home", "three", "two"]);
    s = removePage(s, "three");
    expect(s.pages.map((p) => p.name)).toEqual(["home", "two"]);
  });

  it("adds and removes a modal, and forgets a deleted node", () => {
    let s = addModal(base(), "m1");
    s = add(s, { modal: "m1" }, w("x"));
    expect(s.modals?.[0]?.elements).toHaveLength(1);
    s = forgetNodes(s, new Set(["x"]));
    expect(s.modals?.[0]?.elements).toHaveLength(0);
    s = removeModal(s, "m1");
    expect(s.modals).toEqual([]);
  });

  it("leaves the screen alone for an index that isn't there", () => {
    const s = base();
    expect(remove(s, home, 9)).toEqual(s);
    expect(setProps(s, home, 9, { row: 1 })).toEqual(s);
    expect(move(s, home, 9, 1)).toEqual(s);
  });
});
