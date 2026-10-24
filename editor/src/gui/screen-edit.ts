// SPDX-License-Identifier: Apache-2.0
// editor/src/gui/screen-edit.ts
//
// Editing operations on the `screens` section (gui/screens.ts), as pure functions: each takes a screen and
// returns a new one, never mutating. The outline editor (app/rete/ScreenOutline.vue) calls these; the compile
// step (compileScreens) decides whether the result fits. An element is addressed by its index in its page's (or
// modal's) `elements` list, which is also the order the list shows (it has no effect on screen).

import type { GridElement, ModalSpec, PageSpec, ScreenSpec } from "./screens.js";

/** Which grid an operation applies to: a page by name, or a modal by its node id. */
export type Target = { readonly page: string } | { readonly modal: string };

function elementsOf(screen: ScreenSpec, t: Target): readonly GridElement[] | undefined {
  return "page" in t ? screen.pages.find((p) => p.name === t.page)?.elements : screen.modals?.find((m) => m.node === t.modal)?.elements;
}

function withElements(screen: ScreenSpec, t: Target, elements: readonly GridElement[]): ScreenSpec {
  if ("page" in t) {
    return { ...screen, pages: screen.pages.map((p) => (p.name === t.page ? { ...p, elements } : p)) };
  }
  return { ...screen, modals: (screen.modals ?? []).map((m) => (m.node === t.modal ? { ...m, elements } : m)) };
}

/** Every operation goes through this: edit the target's elements, or leave the screen alone. */
function edit(screen: ScreenSpec, t: Target, fn: (elements: readonly GridElement[]) => readonly GridElement[] | null): ScreenSpec {
  const elements = elementsOf(screen, t);
  if (!elements) return screen;
  try {
    const next = fn(elements);
    return next ? withElements(screen, t, next) : screen;
  } catch {
    return screen;
  }
}

/** Appends an element to the page or modal. New elements go at row 0, column 0 unless the caller sets them. */
export function add(screen: ScreenSpec, t: Target, el: GridElement, _at?: number): ScreenSpec {
  return edit(screen, t, (elements) => [...elements, el]);
}

export function remove(screen: ScreenSpec, t: Target, index: number): ScreenSpec {
  return edit(screen, t, (elements) => (index >= 0 && index < elements.length ? elements.filter((_e, i) => i !== index) : null));
}

/** Moves an element earlier or later in the list (the list order only; placement is row/col). */
export function move(screen: ScreenSpec, t: Target, index: number, dir: -1 | 1): ScreenSpec {
  return edit(screen, t, (elements) => {
    const to = index + dir;
    if (index < 0 || index >= elements.length || to < 0 || to >= elements.length) return null;
    const next = elements.slice();
    const [el] = next.splice(index, 1);
    next.splice(to, 0, el!);
    return next;
  });
}

/** Sets or clears placement properties (undefined removes the key). */
export function setProps(screen: ScreenSpec, t: Target, index: number, props: Record<string, unknown>): ScreenSpec {
  return edit(screen, t, (elements) => {
    if (index < 0 || index >= elements.length) return null;
    const el = { ...elements[index] } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined) delete el[k];
      else el[k] = v;
    }
    const next = elements.slice();
    next[index] = el as unknown as GridElement;
    return next;
  });
}

export interface OutlineRow {
  readonly index: number;
  readonly element: GridElement;
  readonly canUp: boolean;
  readonly canDown: boolean;
  /** What the row is called: a widget's name, the text, "page dots", or "panel". */
  readonly label: string;
}

/** The list view's rows, in list order. `nameOf` names a widget node id. */
export function outline(elements: readonly GridElement[], nameOf: (id: string) => string): OutlineRow[] {
  return elements.map((element, index) => ({
    index,
    element,
    canUp: index > 0,
    canDown: index < elements.length - 1,
    label: element.card
      ? "panel"
      : element.kind === "text"
        ? `“${element.text ?? ""}”`
        : element.kind === "pagedots"
          ? "page dots"
          : nameOf(element.node ?? ""),
  }));
}

/** Every widget node id placed on any page or modal of the screen. */
export function placedWidgets(screen: ScreenSpec): Set<string> {
  const out = new Set<string>();
  for (const p of screen.pages) for (const e of p.elements) if (!e.card && e.node) out.add(e.node);
  for (const m of screen.modals ?? []) for (const e of m.elements) if (!e.card && e.node) out.add(e.node);
  return out;
}

export function addPage(screen: ScreenSpec, name: string, parent?: string): ScreenSpec {
  if (screen.pages.some((p) => p.name === name)) return screen;
  const page: PageSpec = { name, ...(parent ? { parent } : {}), elements: [] };
  return { ...screen, pages: [...screen.pages, page] };
}

export function removePage(screen: ScreenSpec, name: string): ScreenSpec {
  return { ...screen, pages: screen.pages.filter((p) => p.name !== name) };
}

export function movePage(screen: ScreenSpec, name: string, dir: -1 | 1): ScreenSpec {
  const tops = screen.pages.filter((p) => p.parent === undefined).map((p) => p.name);
  const at = tops.indexOf(name);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= tops.length) return screen;
  const order = tops.slice();
  [order[at], order[to]] = [order[to]!, order[at]!];
  const pages = [...screen.pages].sort((a, b) => {
    const ia = a.parent === undefined ? order.indexOf(a.name) : 999;
    const ib = b.parent === undefined ? order.indexOf(b.name) : 999;
    return ia - ib;
  });
  return { ...screen, pages, carousel: order };
}

export function addModal(screen: ScreenSpec, node: string): ScreenSpec {
  if ((screen.modals ?? []).some((m) => m.node === node)) return screen;
  const modal: ModalSpec = { node, elements: [] };
  return { ...screen, modals: [...(screen.modals ?? []), modal] };
}

export function removeModal(screen: ScreenSpec, node: string): ScreenSpec {
  return { ...screen, modals: (screen.modals ?? []).filter((m) => m.node !== node) };
}

/** Drops any element that places one of `ids` (a node was deleted from the canvas). */
export function forgetNodes(screen: ScreenSpec, ids: ReadonlySet<string>): ScreenSpec {
  const keep = (e: GridElement): boolean => !(e.node && !e.card && ids.has(e.node));
  return {
    ...screen,
    pages: screen.pages.map((p) => ({ ...p, elements: p.elements.filter(keep) })),
    ...(screen.modals ? { modals: screen.modals.map((m) => ({ ...m, elements: m.elements.filter(keep) })) } : {}),
  };
}
