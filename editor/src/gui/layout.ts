// SPDX-License-Identifier: Apache-2.0
// editor/src/gui/layout.ts
//
// The GUI layout engine (phase 3 of docs/working-notes/gui-layout-widget-system-scoping.md, "Layout -- the
// fixed screen is the whole gift"). A display's size never changes, so layout runs here, once per display,
// and the board only ever gets the resulting rects. A small flexbox subset, two passes as in Xt: measure
// (natural sizes, bottom up), then arrange (rects, top down).
//
//   row / column containers, nestable; gap; padding
//   per child: natural size, or grow: n (shares the free space by weight)
//   cross axis: start | center | end | stretch (container's `align`, a child's own `alignSelf`)
//   main axis: start | center | end | space-between (container's `justify`, when nothing grows)
//
// No wrap, shrink, order or align-content. Overflow is a build error, not a visual bug: every problem comes
// back attributed to the widget or container, its page and its display. Pure functions, no DOM; a leaf's
// natural size comes from the caller (a widget measures itself with font-metrics.ts).

export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "space-between";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Common {
  /** Stable id: a widget's node id, or a container's own. Rects are keyed by it. */
  readonly id: string;
  /** What error messages call it ("readout 'Temperature'"); defaults to the id. */
  readonly label?: string;
  /** Share of the parent's free main-axis space. 0 or absent: natural size. */
  readonly grow?: number;
  /** Overrides the parent's `align` for this child. */
  readonly alignSelf?: Align;
}

export interface Leaf extends Common {
  readonly kind: "leaf";
  readonly natural: Size;
}

export interface Container extends Common {
  readonly kind: "row" | "column";
  readonly children: readonly LayoutNode[];
  readonly gap?: number;
  readonly padding?: number;
  readonly align?: Align;
  readonly justify?: Justify;
}

export type LayoutNode = Leaf | Container;

export interface LayoutContext {
  readonly display: string;
  readonly page: string;
}

export interface LayoutError {
  readonly id: string;
  readonly message: string;
}

export interface LayoutResult {
  /** Every node's rect, containers included, in display pixels. */
  readonly rects: ReadonlyMap<string, Rect>;
  readonly errors: readonly LayoutError[];
}

const name = (n: LayoutNode): string => n.label ?? n.id;
const where = (ctx: LayoutContext): string => `on page "${ctx.page}" of display "${ctx.display}"`;

/** Natural (smallest comfortable) size: a leaf's own; a container's from its children, gaps and padding. */
export function naturalSize(node: LayoutNode): Size {
  if (node.kind === "leaf") return node.natural;
  const pad = 2 * (node.padding ?? 0);
  const gaps = Math.max(0, node.children.length - 1) * (node.gap ?? 0);
  const sizes = node.children.map(naturalSize);
  const along = sizes.reduce((sum, s) => sum + main(node, s), 0) + gaps;
  const across = sizes.reduce((max, s) => Math.max(max, cross(node, s)), 0);
  return node.kind === "row"
    ? { width: along + pad, height: across + pad }
    : { width: across + pad, height: along + pad };
}

function main(c: Container, s: Size): number {
  return c.kind === "row" ? s.width : s.height;
}
function cross(c: Container, s: Size): number {
  return c.kind === "row" ? s.height : s.width;
}
function mainName(c: Container): string {
  return c.kind === "row" ? "width" : "height";
}
function crossName(c: Container): string {
  return c.kind === "row" ? "height" : "width";
}

/** Lays out one page of one display. `root` fills the whole screen. */
export function layoutPage(root: LayoutNode, display: Size, ctx: LayoutContext): LayoutResult {
  const rects = new Map<string, Rect>();
  const errors: LayoutError[] = [];
  const seen = new Set<string>();

  function place(node: LayoutNode, r: Rect): void {
    if (seen.has(node.id)) errors.push({ id: node.id, message: `"${node.id}" appears twice ${where(ctx)}` });
    seen.add(node.id);
    rects.set(node.id, r);
    if (node.kind === "leaf") return;
    arrange(node, r);
  }

  function arrange(c: Container, r: Rect): void {
    const pad = c.padding ?? 0;
    const gap = c.gap ?? 0;
    const inner = { x: r.x + pad, y: r.y + pad, width: r.width - 2 * pad, height: r.height - 2 * pad };
    const innerMain = c.kind === "row" ? inner.width : inner.height;
    const innerCross = c.kind === "row" ? inner.height : inner.width;
    const kids = c.children;
    if (kids.length === 0) return;

    const natural = kids.map(naturalSize);
    const sizes = natural.map((s) => main(c, s));
    const free = innerMain - (kids.length - 1) * gap - sizes.reduce((a, b) => a + b, 0);
    if (free < 0) {
      const needed = innerMain - free;
      errors.push({
        id: c.id,
        message:
          `${name(c)}'s contents need ${needed}px of ${mainName(c)} but it has ${innerMain}px ${where(ctx)}: ` +
          kids.map((k, i) => `${name(k)} ${sizes[i]}px`).join(", "),
      });
    }

    // Grow: share the free space by weight, whole pixels; leftover pixels go to the first growers.
    // Otherwise `justify` places the free space: before, around, after, or between the children.
    const weights = kids.map((k) => Math.max(0, k.grow ?? 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let lead = 0;
    const gaps = kids.map((_, i) => (i === 0 ? 0 : gap)); // space before each child
    if (free > 0 && totalWeight > 0) {
      const shares = weights.map((w) => Math.floor((free * w) / totalWeight));
      let left = free - shares.reduce((a, b) => a + b, 0);
      for (let i = 0; i < kids.length && left > 0; i++) {
        if (weights[i]! > 0) {
          shares[i]! += 1;
          left -= 1;
        }
      }
      shares.forEach((sh, i) => (sizes[i]! += sh));
    } else if (free > 0) {
      const justify = c.justify ?? "start";
      if (justify === "center") lead = Math.floor(free / 2);
      else if (justify === "end") lead = free;
      else if (justify === "space-between" && kids.length > 1) {
        const extra = Math.floor(free / (kids.length - 1));
        let left = free - extra * (kids.length - 1);
        for (let i = 1; i < kids.length; i++) {
          gaps[i]! += extra + (left > 0 ? 1 : 0);
          if (left > 0) left -= 1;
        }
      }
    }

    let pos = lead;
    kids.forEach((k, i) => {
      pos += gaps[i]!;
      place(k, rect(c, inner, pos, sizes[i]!, crossPlace(c, k, natural[i]!, innerCross)));
      pos += sizes[i]!;
    });
  }

  function crossPlace(c: Container, k: LayoutNode, nat: Size, innerCross: number): { offset: number; size: number } {
    const want = cross(c, nat);
    const align = k.alignSelf ?? c.align ?? "stretch";
    if (want > innerCross) {
      errors.push({
        id: k.id,
        message: `${name(k)}'s natural ${crossName(c)} ${want}px exceeds the ${innerCross}px ${name(c)} gives it ${where(ctx)}`,
      });
    }
    if (align === "stretch") return { offset: 0, size: innerCross };
    const size = Math.min(want, innerCross);
    const room = innerCross - size;
    const offset = align === "center" ? Math.floor(room / 2) : align === "end" ? room : 0;
    return { offset, size };
  }

  function rect(c: Container, inner: Rect, pos: number, length: number, x: { offset: number; size: number }): Rect {
    return c.kind === "row"
      ? { x: inner.x + pos, y: inner.y + x.offset, width: length, height: x.size }
      : { x: inner.x + x.offset, y: inner.y + pos, width: x.size, height: length };
  }

  place(root, { x: 0, y: 0, width: display.width, height: display.height });
  if (root.kind === "leaf") {
    const n = root.natural;
    if (n.width > display.width || n.height > display.height) {
      errors.push({
        id: root.id,
        message: `${name(root)} needs ${n.width}x${n.height}px but the display is ${display.width}x${display.height} ${where(ctx)}`,
      });
    }
  }
  return { rects, errors };
}
