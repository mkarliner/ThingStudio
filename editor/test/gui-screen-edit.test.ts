import { describe, expect, it } from "vitest";
import { add, addModal, forgetNodes, addPage, indent, move, movePage, outdent, outline, placedWidgets, remove, removePage, setProps, type Target } from "../src/gui/screen-edit.js";
import type { ElementSpec, ScreenSpec } from "../src/gui/screens.js";

const w = (node: string): ElementSpec => ({ kind: "widget", node });
const home: Target = { page: "home" };
const names = (s: ScreenSpec, t: Target = home): string[] => {
  const root = "page" in t ? s.pages.find((p) => p.name === t.page)!.root : s.modals!.find((m) => m.node === t.modal)!.root;
  return outline(root).slice(1).map((r) => `${"  ".repeat(r.depth - 1)}${r.element.kind === "widget" ? r.element.node : r.element.kind}`);
};

const base = (): ScreenSpec => ({
  pages: [{ name: "home", root: { kind: "column", children: [w("a"), { kind: "row", children: [w("b"), w("c")] }, w("d")] } }, { name: "two", root: { kind: "column", children: [] } }],
});

describe("screen-edit", () => {
  it("moves an element up and down among its siblings, and not past the ends", () => {
    let s = move(base(), home, [2], -1);
    expect(names(s)).toEqual(["a", "d", "row", "  b", "  c"]);
    s = move(s, home, [0], -1);
    expect(names(s)).toEqual(["a", "d", "row", "  b", "  c"]); // already first
    s = move(s, home, [2, 0], 1);
    expect(names(s)).toEqual(["a", "d", "row", "  c", "  b"]);
  });

  it("does not mutate what it was given", () => {
    const s = base();
    const before = JSON.stringify(s);
    move(s, home, [0], 1);
    remove(s, home, [0]);
    indent(s, home, [2]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("indents into the container before it, and outdents out to after it", () => {
    let s = indent(base(), home, [2]);
    expect(names(s)).toEqual(["a", "row", "  b", "  c", "  d"]);
    expect(indent(base(), home, [0])).toEqual(base()); // first: nothing before it
    expect(indent(base(), home, [1])).toEqual(base()); // previous is a widget, not a container
    s = outdent(s, home, [1, 0]);
    expect(names(s)).toEqual(["a", "row", "  c", "  d", "b"]);
    expect(outdent(base(), home, [0])).toEqual(base()); // a direct child of the root
  });

  it("removes, adds to a container, and edits placement properties", () => {
    let s = remove(base(), home, [1, 0]);
    expect(names(s)).toEqual(["a", "row", "  c", "d"]);
    s = add(s, home, w("e"), [1]);
    expect(names(s)).toEqual(["a", "row", "  c", "  e", "d"]);
    s = add(s, home, w("f"));
    expect(names(s).at(-1)).toBe("f");
    s = setProps(s, home, [0], { font: "font_body20", grow: 1 });
    expect(outline(s.pages[0]!.root)[1]!.element).toMatchObject({ node: "a", font: "font_body20", grow: 1 });
    s = setProps(s, home, [0], { grow: undefined, font: "" });
    expect(outline(s.pages[0]!.root)[1]!.element).toEqual({ kind: "widget", node: "a" });
    s = setProps(s, home, [], { gap: 12 });
    expect(s.pages[0]!.root).toMatchObject({ gap: 12 });
  });

  it("reports what each row can do", () => {
    const rows = outline(base().pages[0]!.root);
    expect(rows.map((r) => [r.canUp, r.canDown, r.canIndent, r.canOutdent])).toEqual([
      [false, false, false, false], // root
      [false, true, false, false], // a
      [true, true, false, false], // row (previous is a widget)
      [false, true, false, true], // b
      [true, false, false, true], // c
      [true, false, true, false], // d: the row before it is a container
    ]);
  });

  it("adds, removes and reorders pages; reordering keeps child pages after the top-level ones", () => {
    let s: ScreenSpec = addPage(addPage(addPage(base(), "three"), "kid", "two"), "home"); // duplicate name ignored
    expect(s.pages.map((p) => p.name)).toEqual(["home", "two", "three", "kid"]);
    s = movePage(s, "three", -1);
    expect(s.pages.map((p) => p.name)).toEqual(["home", "three", "two", "kid"]);
    expect(movePage(s, "home", -1)).toEqual(s);
    s = removePage(s, "two");
    expect(s.pages.map((p) => p.name)).toEqual(["home", "three", "kid"]);
    expect(s.pages.find((p) => p.name === "kid")!.parent).toBeUndefined();
  });

  it("reorders an explicit carousel too", () => {
    const s = movePage({ ...base(), carousel: ["home", "two"] }, "two", -1);
    expect(s.carousel).toEqual(["two", "home"]);
  });

  it("edits modals the same way, and lists the widgets placed anywhere", () => {
    let s = addModal(base(), "alarm");
    const t: Target = { modal: "alarm" };
    s = add(s, t, w("x"));
    s = add(s, t, w("y"));
    s = move(s, t, [1], -1);
    expect(names(s, t)).toEqual(["y", "x"]);
    expect([...placedWidgets(s)].sort()).toEqual(["a", "b", "c", "d", "x", "y"]);
  });

  it("forgetNodes takes deleted widgets out of every page, nested rows included, and drops a deleted modal", () => {
    let s = addModal(base(), "m");
    s = add(s, { modal: "m" }, w("b"));
    s = add(s, { page: "two" }, w("c"));
    const out = forgetNodes(s, new Set(["b", "m"]));
    expect(names(out)).toEqual(["a", "row", "  c", "d"]);
    expect(names(out, { page: "two" })).toEqual(["c"]);
    expect(out.modals).toEqual([]);
    expect(forgetNodes(base(), new Set(["zzz"]))).toEqual(base());
  });
});
