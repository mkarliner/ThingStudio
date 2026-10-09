// SPDX-License-Identifier: Apache-2.0
// editor/src/gui/screen-edit.ts
//
// Editing operations on the `screens` section (gui/screens.ts), as pure functions: each takes a screen and
// returns a new one, never mutating. The primitive layout editor (app/rete/ScreenOutline.vue) calls these;
// the compile step (compileScreens) still decides whether the result fits. An element is addressed by its path
// from a page's (or modal's) root: the list of child indices to follow, [] being the root itself. Order in a
// container's `children` IS the order on screen, so reordering is the whole of "layout" here.

import type { ContainerSpec, ElementSpec, ModalSpec, PageSpec, ScreenSpec, WidgetSpec } from "./screens.js";

export type Path = readonly number[];

/** Which tree an operation applies to: a page by name, or a modal by its node id. */
export type Target = { readonly page: string } | { readonly modal: string };

const isContainer = (e: ElementSpec): e is ContainerSpec => e.kind === "row" || e.kind === "column";

function rootOf(screen: ScreenSpec, t: Target): ElementSpec | undefined {
  return "page" in t ? screen.pages.find((p) => p.name === t.page)?.root : screen.modals?.find((m) => m.node === t.modal)?.root;
}

function withRoot(screen: ScreenSpec, t: Target, root: ElementSpec): ScreenSpec {
  if ("page" in t) return { ...screen, pages: screen.pages.map((p) => (p.name === t.page ? { ...p, root } : p)) };
  return { ...screen, modals: (screen.modals ?? []).map((m) => (m.node === t.modal ? { ...m, root } : m)) };
}

export function elementAt(root: ElementSpec, path: Path): ElementSpec | undefined {
  let e: ElementSpec | undefined = root;
  for (const i of path) {
    if (!e || !isContainer(e)) return undefined;
    e = e.children[i];
  }
  return e;
}

/** Replaces the container at `path` with fn(container). */
function editContainer(root: ElementSpec, path: Path, fn: (c: ContainerSpec) => ContainerSpec): ElementSpec {
  if (!isContainer(root)) throw new Error("not a container");
  if (path.length === 0) return fn(root);
  const [i, ...rest] = path;
  const child = root.children[i!];
  if (!child) throw new Error("no such element");
  const children = root.children.slice();
  children[i!] = editContainer(child, rest, fn);
  return { ...root, children };
}

/** Every operation below goes through this: edit the target's root, or leave the screen alone if it can't be done. */
function edit(screen: ScreenSpec, t: Target, fn: (root: ElementSpec) => ElementSpec | null): ScreenSpec {
  const root = rootOf(screen, t);
  if (!root) return screen;
  try {
    const next = fn(root);
    return next ? withRoot(screen, t, next) : screen;
  } catch {
    return screen;
  }
}

const parentPath = (p: Path): Path => p.slice(0, -1);

/** Swaps the element with its neighbour: dir -1 earlier, +1 later. */
export function move(screen: ScreenSpec, t: Target, path: Path, dir: -1 | 1): ScreenSpec {
  return edit(screen, t, (root) => {
    if (path.length === 0) return null;
    const idx = path[path.length - 1]!;
    const j = idx + dir;
    return editContainer(root, parentPath(path), (c) => {
      if (j < 0 || j >= c.children.length) throw new Error("at the end");
      const children = c.children.slice();
      [children[idx], children[j]] = [children[j]!, children[idx]!];
      return { ...c, children };
    });
  });
}

/** Moves the element into the container just before it (as its last child). */
export function indent(screen: ScreenSpec, t: Target, path: Path): ScreenSpec {
  return edit(screen, t, (root) => {
    if (path.length === 0) return null;
    const idx = path[path.length - 1]!;
    if (idx === 0) return null;
    const pp = parentPath(path);
    const parent = elementAt(root, pp) as ContainerSpec;
    const el = parent.children[idx]!;
    const prev = parent.children[idx - 1]!;
    if (!isContainer(prev)) return null;
    return editContainer(root, pp, (c) => {
      const children = c.children.slice();
      children.splice(idx, 1);
      children[idx - 1] = { ...prev, children: [...prev.children, el] };
      return { ...c, children };
    });
  });
}

/** Moves the element out of its container, to just after that container in the grandparent. */
export function outdent(screen: ScreenSpec, t: Target, path: Path): ScreenSpec {
  return edit(screen, t, (root) => {
    if (path.length < 2) return null; // a direct child of the root has nowhere to go
    const idx = path[path.length - 1]!;
    const pp = parentPath(path);
    const gp = parentPath(pp);
    const parentIdx = pp[pp.length - 1]!;
    const parent = elementAt(root, pp) as ContainerSpec;
    const el = parent.children[idx]!;
    return editContainer(root, gp, (g) => {
      const children = g.children.slice();
      children[parentIdx] = { ...parent, children: parent.children.filter((_, k) => k !== idx) };
      children.splice(parentIdx + 1, 0, el);
      return { ...g, children };
    });
  });
}

export function remove(screen: ScreenSpec, t: Target, path: Path): ScreenSpec {
  return edit(screen, t, (root) => {
    if (path.length === 0) return null;
    const idx = path[path.length - 1]!;
    return editContainer(root, parentPath(path), (c) => ({ ...c, children: c.children.filter((_, k) => k !== idx) }));
  });
}

/** Appends `el` to the container at `path` (default: the root). */
export function add(screen: ScreenSpec, t: Target, el: ElementSpec, path: Path = []): ScreenSpec {
  return edit(screen, t, (root) => editContainer(root, path, (c) => ({ ...c, children: [...c.children, el] })));
}

/** Merges placement properties into the element at `path`; a value of undefined removes the property. */
export function setProps(screen: ScreenSpec, t: Target, path: Path, props: Record<string, unknown>): ScreenSpec {
  return edit(screen, t, (root) => {
    const apply = (e: ElementSpec): ElementSpec => {
      const next: Record<string, unknown> = { ...e, ...props };
      for (const k of Object.keys(props)) if (props[k] === undefined || props[k] === "") delete next[k];
      return next as unknown as ElementSpec;
    };
    if (path.length === 0) return apply(root);
    return editContainer(root, parentPath(path), (c) => {
      const idx = path[path.length - 1]!;
      const children = c.children.slice();
      if (!children[idx]) throw new Error("no such element");
      children[idx] = apply(children[idx]!);
      return { ...c, children };
    });
  });
}

// ---- pages and modals --------------------------------------------------------------------------------------

export const newColumn = (): ContainerSpec => ({ kind: "column", gap: 6, padding: 4, children: [] });

export function addPage(screen: ScreenSpec, name: string, parent?: string): ScreenSpec {
  if (!name || screen.pages.some((p) => p.name === name)) return screen;
  const page: PageSpec = { name, ...(parent ? { parent } : {}), root: newColumn() };
  return { ...screen, pages: [...screen.pages, page] };
}

export function removePage(screen: ScreenSpec, name: string): ScreenSpec {
  const pages = screen.pages.filter((p) => p.name !== name).map((p) => (p.parent === name ? { ...p, parent: undefined } : p));
  return { ...screen, pages, carousel: screen.carousel?.filter((n) => n !== name) };
}

/** Moves a page earlier or later in the page order (the carousel, and the order the page dots show). */
export function movePage(screen: ScreenSpec, name: string, dir: -1 | 1): ScreenSpec {
  const swap = <T>(list: readonly T[], at: number): T[] => {
    const j = at + dir;
    if (at < 0 || j < 0 || j >= list.length) return list.slice();
    const out = list.slice();
    [out[at], out[j]] = [out[j]!, out[at]!];
    return out;
  };
  const top = screen.pages.filter((p) => p.parent === undefined);
  const at = top.findIndex((p) => p.name === name);
  if (at < 0) return screen;
  const j = at + dir;
  if (j < 0 || j >= top.length) return screen;
  const order = swap(top.map((p) => p.name), at);
  // Rebuild: top-level pages in the new order, each child page kept after the top-level pages.
  const byName = new Map(screen.pages.map((p) => [p.name, p] as const));
  const pages = [...order.map((n) => byName.get(n)!), ...screen.pages.filter((p) => p.parent !== undefined)];
  return { ...screen, pages, carousel: screen.carousel ? order.filter((n) => screen.carousel!.includes(n)) : undefined };
}

export function addModal(screen: ScreenSpec, node: string): ScreenSpec {
  if ((screen.modals ?? []).some((m) => m.node === node)) return screen;
  const modal: ModalSpec = { node, root: { kind: "column", padding: 10, gap: 6, children: [] } };
  return { ...screen, modals: [...(screen.modals ?? []), modal] };
}

export function removeModal(screen: ScreenSpec, node: string): ScreenSpec {
  return { ...screen, modals: (screen.modals ?? []).filter((m) => m.node !== node) };
}

// ---- reading the tree for display -------------------------------------------------------------------------

export interface OutlineRow {
  readonly path: Path;
  readonly depth: number;
  readonly element: ElementSpec;
  /** Can children be added to it (a row or column)? */
  readonly container: boolean;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly canIndent: boolean;
  readonly canOutdent: boolean;
}

/** The tree flattened top to bottom, with what each row can do. The root itself is row 0. */
export function outline(root: ElementSpec): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (e: ElementSpec, path: Path, siblings: readonly ElementSpec[] | null): void => {
    const idx = path.length ? path[path.length - 1]! : 0;
    rows.push({
      path,
      depth: path.length,
      element: e,
      container: isContainer(e),
      canUp: siblings !== null && idx > 0,
      canDown: siblings !== null && idx < siblings.length - 1,
      canIndent: siblings !== null && idx > 0 && isContainer(siblings[idx - 1]!),
      canOutdent: path.length >= 2,
    });
    if (isContainer(e)) e.children.forEach((c, i) => walk(c, [...path, i], e.children));
  };
  walk(root, [], null);
  return rows;
}

/** Every widget node id placed anywhere on a screen (pages and modals). */
export function placedWidgets(screen: ScreenSpec): Set<string> {
  const out = new Set<string>();
  const visit = (e: ElementSpec): void => {
    if (e.kind === "widget") out.add((e as WidgetSpec).node);
    else if (isContainer(e)) e.children.forEach(visit);
  };
  screen.pages.forEach((p) => visit(p.root));
  (screen.modals ?? []).forEach((m) => visit(m.root));
  return out;
}
