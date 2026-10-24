// SPDX-License-Identifier: Apache-2.0
// editor/src/cli/layout.ts
//
// How a flow we author should look when someone opens it, as a check and as a fix (2026-10-23). The rules are
// Mike's: a flow reads left to right (2026-10-22, AGENTS.md "Authored flows read left to right"), and it is kept
// visually tight -- the spacing is taken from flows he laid out by hand in the editor, where columns sit about 220 px
// apart and nodes in a column 60-100 px apart, not from the looser 260 x 170 grid relayout.py used.
//
// Node boxes are small (34 px tall, 84-132 px wide; a function node with several outputs is taller), so "tight"
// here means a gap of about 90 px for a wire to run across and about 36 px between stacked nodes.
//
// Both functions are pure: a flow's nodes (with their real sizes), wires and positions in, warnings or new positions
// out. The command line wires them to --layout and --relayout; a user's own flow is never checked or moved unless
// they ask, and the editor never repositions nodes on load.

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}
export type LayoutEdge = [string, number, string, number];
export type Positions = Record<string, [number, number]>;

/** The spacing both the check and the fix use. */
export const SPACING = {
  /** Where the first node goes. The editor does not fit the view on open, so a flow should start near here. */
  origin: [80, 80] as [number, number],
  /** Column to column, left edge to left edge. Widened for a column with a node wider than 130 px. */
  columnPitch: 220,
  /** Clear space a wire needs between one node's right edge and the next node's left edge. */
  minWireGap: 40,
  /** Clear space between nodes stacked in one column of one chain. */
  rowGap: 36,
  /** Clear space between two separate chains (unconnected groups), stacked one under the other. */
  groupGap: 66,
  /** Boxes closer than this, either way, read as touching. */
  minClearance: 16,
  /** An empty horizontal band wider than this is wasted space. The target is about 90-120 px between columns; the
   * warning is set looser than that, at what reads as spread out, so a flow laid out by hand in roughly the right
   * shape does not trip it. */
  maxEmptyX: 200,
  /** An empty vertical band taller than this is wasted space (same reasoning: target 36-66 px). */
  maxEmptyY: 150,
  /** A first node further than this from the origin opens off screen. */
  maxStart: 320,
  /** Two wired nodes whose y differs by less than this but not zero get a kinked wire; line them up. */
  nearlyStraight: 20,
};

const LIMIT = 3;

function capped(kind: string, items: string[]): string[] {
  if (items.length <= LIMIT) return items;
  return [...items.slice(0, LIMIT), `layout: ${items.length - LIMIT} more ${kind} like these`];
}

/** Merge [start, end] intervals and return the gaps between them that are wider than `max`. */
function gaps(intervals: [number, number][], max: number): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let end = -Infinity;
  for (const [s, e] of sorted) {
    if (end !== -Infinity && s - end > max) out.push([end, s]);
    end = Math.max(end, e);
  }
  return out;
}

/** Layout warnings for a flow, each starting "layout:". Empty when the flow follows the rules. */
export function checkLayout(nodes: LayoutNode[], edges: LayoutEdge[], pos: Positions): string[] {
  const out: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const r = (v: number) => Math.round(v);

  const unplaced = nodes.filter((n) => !pos[n.id]).map((n) => n.id);
  if (unplaced.length > 0) {
    out.push(`layout: no position for ${unplaced.join(", ")} (they all open on top of each other at 0,0); give every node a layout pos`);
  }
  const placed = nodes.filter((n) => pos[n.id]);
  if (placed.length === 0) return out;
  const box = (n: LayoutNode) => {
    const [x, y] = pos[n.id]!;
    return { x, y, r: x + n.width, b: y + n.height };
  };

  const backwards: string[] = [];
  const cramped: string[] = [];
  const kinked: string[] = [];
  for (const [from, , to] of edges) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b || !pos[from] || !pos[to]) continue;
    const A = box(a);
    const B = box(b);
    if (B.x <= A.x) {
      backwards.push(`layout: wire ${from} -> ${to} runs right to left or straight down (x ${r(A.x)} -> ${r(B.x)}); every wire should go to a node further right`);
    } else if (B.x - A.r < SPACING.minWireGap) {
      const gap = r(B.x - A.r);
      const where = gap < 0 ? `starts before ${from} ends` : `starts only ${gap} px after ${from} ends`;
      cramped.push(`layout: ${to} ${where}, too close to see the wire; put it in the next column (about ${SPACING.columnPitch} px to the right of ${from})`);
    }
    const dy = Math.abs(B.y - A.y);
    if (dy >= 1 && dy < SPACING.nearlyStraight) {
      kinked.push(`layout: ${from} and ${to} are ${r(dy)} px out of line, so the wire kinks; give them the same y`);
    }
  }

  const overlaps: string[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const A = box(placed[i]!);
      const B = box(placed[j]!);
      const c = SPACING.minClearance;
      if (A.x < B.r + c && B.x < A.r + c && A.y < B.b + c && B.y < A.b + c) {
        overlaps.push(`layout: ${placed[i]!.id} and ${placed[j]!.id} overlap or touch; keep about ${SPACING.rowGap} px between stacked nodes`);
      }
    }
  }

  const boxes = placed.map(box);
  const emptyX = gaps(boxes.map((b) => [b.x, b.r]), SPACING.maxEmptyX).map(
    ([s, e]) => `layout: ${r(e - s)} px of empty space between x=${r(s)} and x=${r(e)}; close it up (columns about ${SPACING.columnPitch} px apart)`,
  );
  const emptyY = gaps(boxes.map((b) => [b.y, b.b]), SPACING.maxEmptyY).map(
    ([s, e]) => `layout: ${r(e - s)} px of empty space between y=${r(s)} and y=${r(e)}; stack rows closer (about ${SPACING.rowGap} px between nodes in a chain, ${SPACING.groupGap} px between separate chains)`,
  );

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const start: string[] = [];
  if (minX > SPACING.maxStart || minY > SPACING.maxStart || minX < 0 || minY < 0) {
    start.push(`layout: the flow starts at (${r(minX)}, ${r(minY)}); start near (${SPACING.origin.join(", ")}) so it is on screen when it opens`);
  }

  return [
    ...out,
    ...capped("wires", backwards),
    ...capped("wires", cramped),
    ...capped("overlaps", overlaps),
    ...capped("gaps", emptyX),
    ...capped("gaps", emptyY),
    ...start,
    ...capped("kinks", kinked),
  ];
}

/**
 * Positions that follow the rules: each separate chain is laid out on its own and stacked under the one before;
 * within a chain a node's column is its longest distance from a source (so no wire has to go backwards), and its y is
 * the average of the nodes feeding it, pushed down only as far as it must be to clear the node above. A straight
 * chain comes out as one straight row.
 */
export function relayout(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  const ids = nodes.map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const neighbours = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const [from, , to] of edges) {
    if (!byId.has(from) || !byId.has(to) || from === to) continue;
    preds.get(to)!.push(from);
    neighbours.get(from)!.add(to);
    neighbours.get(to)!.add(from);
  }

  // Longest path from a source; a cycle (the compiler rejects these) is cut rather than looped on.
  const depth = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const p = preds.get(id)!;
    const d = p.length === 0 ? 0 : 1 + Math.max(...p.map((x) => visit(x, stack)));
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id, new Set());

  // Separate chains, in the order their first node appears in the file.
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const group: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      group.push(cur);
      for (const n of neighbours.get(cur)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    groups.push(group);
  }
  // Nodes with no wires at all go together, in one chain-height group at the end, rather than one row each.
  const lone = groups.filter((g) => g.length === 1 && neighbours.get(g[0]!)!.size === 0).map((g) => g[0]!);
  const wired = groups.filter((g) => !(g.length === 1 && neighbours.get(g[0]!)!.size === 0));

  // One set of column x positions for the whole flow, so columns line up across chains.
  const maxDepth = Math.max(0, ...ids.map((id) => depth.get(id)!));
  const colX: number[] = [SPACING.origin[0]];
  for (let c = 1; c <= maxDepth; c++) {
    const widest = Math.max(0, ...ids.filter((id) => depth.get(id) === c - 1).map((id) => byId.get(id)!.width));
    colX.push(colX[c - 1]! + Math.max(SPACING.columnPitch, widest + SPACING.minWireGap + 50));
  }

  const out: Positions = {};
  const order = new Map(ids.map((id, i) => [id, i]));
  let top = SPACING.origin[1];
  for (const group of wired) {
    const cols = new Map<number, string[]>();
    for (const id of group) {
      const c = depth.get(id)!;
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c)!.push(id);
    }
    const y = new Map<string, number>();
    let bottom = top;
    for (const c of [...cols.keys()].sort((a, b) => a - b)) {
      const want = (id: string): number => {
        const p = preds.get(id)!.filter((x) => y.has(x));
        return p.length === 0 ? top : p.reduce((s, x) => s + y.get(x)!, 0) / p.length;
      };
      const column = cols.get(c)!.sort((a, b) => want(a) - want(b) || order.get(a)! - order.get(b)!);
      let next = top;
      for (const id of column) {
        const at = Math.round(Math.max(want(id), next));
        y.set(id, at);
        next = at + byId.get(id)!.height + SPACING.rowGap;
        bottom = Math.max(bottom, at + byId.get(id)!.height);
      }
    }
    for (const id of group) out[id] = [colX[depth.get(id)!]!, y.get(id)!];
    top = bottom + SPACING.groupGap;
  }
  for (const id of lone) {
    out[id] = [SPACING.origin[0], top];
    top += byId.get(id)!.height + SPACING.rowGap;
  }
  return out;
}
