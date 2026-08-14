// SPDX-License-Identifier: Apache-2.0
// editor/src/flow-file/flow-file.ts
//
// The git-friendly flow file format (design doc §6, `repo-structure-and-
// conventions.md`'s reserved-but-unbuilt flow-file/ directory). Node-RED's
// own `flows.json` is the cautionary tale §6 names explicitly: node
// position lives in the same object as the node's logic, so dragging a
// node on the canvas and a real behavior change look identical in a `git
// diff`. This file's format splits those concerns instead:
//   - `nodes`/`edges`: only change when behavior changes (type,
//     properties, wiring).
//   - `layout`: only changes when someone rearranges the canvas
//     (position, size).
// Deterministic: nodes and edges are sorted by ID, so re-saving an
// untouched flow reproduces byte-identical JSON -- a real requirement,
// not a nice-to-have (§6: "so a `git diff` on a flow file tells you
// something meaningful").
//
// Deliberately pure and Litegraph-independent -- this file only knows
// about plain data, never a live LGraph/LGraphNode instance, so it's
// off-device testable the same way compile.ts is (compiler.general.test.ts
// etc.). The Litegraph-coupled half (reading/writing an actual canvas) is
// main.ts's job, same separation as compile.ts (pure graph-shape logic)
// vs. main.ts's currentSource() (the live-canvas glue around it).
//
// What's NOT saved, and why: link IDs and link `type` (the 6th element of
// GraphLink) are Litegraph's own bookkeeping, regenerated correctly by
// LGraphNode.prototype.connect() from the slots' own registered types when
// a file is loaded (verified against the vendored library before this was
// written -- connect(originSlot, targetNodeOrId, targetSlot) takes no type
// argument at all). Saving them would just be one more thing to keep
// consistent for no benefit.

export const FLOW_FILE_FORMAT_VERSION = 1;

export class FlowFileError extends Error {}

/** One node's logic -- everything that changes only when behavior changes. */
export interface FlowFileNode {
  id: number;
  type: string;
  properties: Record<string, unknown>;
}

/** [originNodeId, originSlot, targetNodeId, targetSlot] -- deliberately not
 * the 6-element GraphLink tuple compile.ts consumes; see header comment on
 * why link id/type aren't saved. */
export type FlowFileEdge = [number, number, number, number];

export interface FlowFileLayoutEntry {
  pos: [number, number];
  size?: [number, number];
}

export interface FlowFile {
  formatVersion: number;
  /** Sorted by id -- see buildFlowFile. */
  nodes: FlowFileNode[];
  /** Sorted by [originId, originSlot, targetId, targetSlot] -- see buildFlowFile. */
  edges: FlowFileEdge[];
  /** Keyed by node id, as a string (JSON object keys are always strings --
   * see flow-file.test.ts for why this doesn't actually cost determinism:
   * JS/JSON engines order small-integer-like string keys ascending
   * regardless of insertion order, per the ECMAScript spec's own
   * "integer index" property-ordering rule, not merely by convention). */
  layout: Record<string, FlowFileLayoutEntry>;
}

/** What main.ts's canvas-reading code hands in -- plain data, no live
 * Litegraph node reference, so this module never needs one. */
export interface CanvasNodeSnapshot {
  id: number;
  type: string;
  properties: Record<string, unknown>;
  pos: [number, number];
  size?: [number, number];
}

export function buildFlowFile(nodes: CanvasNodeSnapshot[], edges: FlowFileEdge[]): FlowFile {
  const sortedNodes = [...nodes].sort((a, b) => a.id - b.id);
  const sortedEdges = [...edges].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);

  const layout: Record<string, FlowFileLayoutEntry> = {};
  for (const n of sortedNodes) {
    layout[String(n.id)] = n.size ? { pos: n.pos, size: n.size } : { pos: n.pos };
  }

  return {
    formatVersion: FLOW_FILE_FORMAT_VERSION,
    nodes: sortedNodes.map((n) => ({ id: n.id, type: n.type, properties: n.properties })),
    edges: sortedEdges,
    layout,
  };
}

/** Trailing newline -- ordinary POSIX text file convention, and avoids a
 * spurious "no newline at end of file" line in every diff. */
export function serializeFlowFileText(file: FlowFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/**
 * Parses and validates a flow file's raw text. Deliberately strict rather
 * than permissive -- a hand-edited or corrupted file should fail loudly
 * with a specific reason, not silently misinterpret partial/wrong-shaped
 * data (this project's fault-handling-over-happy-path priority, CLAUDE.md,
 * applied to file I/O the same way it's already applied to the wire
 * protocol's adversarial framing tests). `formatVersion` is checked now,
 * before there's a second version to migrate from, on the same reasoning
 * §13's HELLO version check exists: fail clearly at the boundary instead
 * of leaving a future format change to silently misparse as this one.
 */
export function parseFlowFile(text: string): FlowFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new FlowFileError(`not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new FlowFileError("flow file must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  if (obj.formatVersion !== FLOW_FILE_FORMAT_VERSION) {
    throw new FlowFileError(`unsupported flow file formatVersion ${JSON.stringify(obj.formatVersion)} (expected ${FLOW_FILE_FORMAT_VERSION})`);
  }
  if (!Array.isArray(obj.nodes)) throw new FlowFileError('"nodes" must be an array');
  if (!Array.isArray(obj.edges)) throw new FlowFileError('"edges" must be an array');
  if (typeof obj.layout !== "object" || obj.layout === null) throw new FlowFileError('"layout" must be an object');

  const nodes: FlowFileNode[] = obj.nodes.map((n, i) => {
    if (typeof n !== "object" || n === null) throw new FlowFileError(`nodes[${i}] must be an object`);
    const rec = n as Record<string, unknown>;
    if (typeof rec.id !== "number") throw new FlowFileError(`nodes[${i}].id must be a number`);
    if (typeof rec.type !== "string") throw new FlowFileError(`nodes[${i}].type must be a string`);
    if (typeof rec.properties !== "object" || rec.properties === null) throw new FlowFileError(`nodes[${i}].properties must be an object`);
    return { id: rec.id, type: rec.type, properties: rec.properties as Record<string, unknown> };
  });

  const edges: FlowFileEdge[] = obj.edges.map((e, i) => {
    if (!Array.isArray(e) || e.length !== 4 || e.some((v) => typeof v !== "number")) {
      throw new FlowFileError(`edges[${i}] must be a 4-element numeric array [originId, originSlot, targetId, targetSlot]`);
    }
    return e as FlowFileEdge;
  });

  const layoutObj = obj.layout as Record<string, unknown>;
  const layout: Record<string, FlowFileLayoutEntry> = {};
  for (const key of Object.keys(layoutObj)) {
    const entry = layoutObj[key];
    if (typeof entry !== "object" || entry === null) throw new FlowFileError(`layout["${key}"] must be an object`);
    const rec = entry as Record<string, unknown>;
    if (!Array.isArray(rec.pos) || rec.pos.length !== 2 || rec.pos.some((v) => typeof v !== "number")) {
      throw new FlowFileError(`layout["${key}"].pos must be a 2-element numeric array`);
    }
    const parsed: FlowFileLayoutEntry = { pos: rec.pos as [number, number] };
    if (rec.size !== undefined) {
      if (!Array.isArray(rec.size) || rec.size.length !== 2 || rec.size.some((v) => typeof v !== "number")) {
        throw new FlowFileError(`layout["${key}"].size must be a 2-element numeric array`);
      }
      parsed.size = rec.size as [number, number];
    }
    layout[key] = parsed;
  }

  return { formatVersion: obj.formatVersion, nodes, edges, layout };
}
