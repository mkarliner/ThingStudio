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
//
// Config nodes (config-node-and-palette-implementation-briefing.md): a
// `configs` array, same `{id, type, properties}` shape as GraphConfigNode
// (compiler/graph.ts) -- added alongside `nodes`/`edges`/`layout`, sorted
// by id the same deterministic way `nodes` is, so re-saving an untouched
// flow with configs stays a zero-diff exactly as §6's git-friendliness
// requirement already demands for everything else in this format. Configs
// aren't part of `layout` -- they don't have a canvas position at all
// (they're never graph nodes, per graph.ts's own header comment), so
// there's no positional data to split out for them.
//
// Node IDs, string not numeric (changed 2026-09-04, decisions.md's
// "Stable node IDs" entry): node ids used to be sequential integers,
// recomputed fresh on every save/compile (Litegraph's own auto-
// incrementing convention) -- same numbering scheme graph-adapter.ts used
// to assign compiler-side, and for the identical reason: nothing
// downstream needed identity to survive an edit or a redeploy, so
// recomputing was the cheaper option. That's no longer true -- Tier 2's
// planned flash-persisted per-node state and reliable console-message-to-
// canvas-node attribution (a NODE_ERROR/DEBUG line surviving edits made
// after the deploy that produced it) both need a node's id to mean the
// same thing across saves/redeploys, not just within one compile. Rather
// than invent a second ID scheme, this format now saves each node's own
// Rete canvas identity directly (`crypto.randomUUID()`, ClassicPreset.
// Node's own constructor) -- the same string every other consumer
// (compiler, wire protocol, device-runtime) already treats as an opaque
// token via string interpolation, never arithmetic. Configs already used
// a string id for unrelated reasons (a separate identity space from nodes,
// this file's original header) -- nodes now share that same shape, not a
// new one.

export const FLOW_FILE_FORMAT_VERSION = 1;

export class FlowFileError extends Error {}

/** One node's logic -- everything that changes only when behavior changes. */
export interface FlowFileNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

/** [originNodeId, originSlot, targetNodeId, targetSlot] -- deliberately not
 * the 6-element GraphLink tuple compile.ts consumes; see header comment on
 * why link id/type aren't saved. Node ids are strings (see header);
 * slot indices stay plain numbers -- they're positions, not identities. */
export type FlowFileEdge = [string, number, string, number];

export interface FlowFileLayoutEntry {
  pos: [number, number];
  size?: [number, number];
}

/** A config node's saved shape -- see this file's header. Same `{id, type,
 * properties}` shape as FlowFileNode now that both use string ids. */
export interface FlowFileConfig {
  id: string;
  type: string;
  properties: Record<string, unknown>;
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
   * "integer index" property-ordering rule, not merely by convention).
   * Node ids are UUIDs now (see header), not small-integer-like strings,
   * so that ordering guarantee no longer applies here in practice -- keys
   * are written in `sortedNodes`' own deterministic (string-sorted) order
   * instead, which is what actually keeps re-saves zero-diff now. */
  layout: Record<string, FlowFileLayoutEntry>;
  /** Sorted by id (string comparison) -- see buildFlowFile. Always present
   * (possibly empty) on anything this module builds; parseFlowFile treats
   * a missing/absent key on an older, pre-config-nodes flow file as "no
   * configs" rather than a validation error, so hand-written and
   * previously-saved flow files without this key keep loading unchanged. */
  configs: FlowFileConfig[];
}

/** What main.ts's canvas-reading code hands in -- plain data, no live
 * Litegraph node reference, so this module never needs one. */
export interface CanvasNodeSnapshot {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  pos: [number, number];
  size?: [number, number];
}

/** String comparator shared by every sort below (nodes, configs, and now
 * edges' node-id columns) -- ids stopped being numeric (see header), so
 * `a.id - b.id`-style arithmetic subtraction no longer type-checks or
 * means anything; this is the same three-way comparison configs already
 * used before this file's ids were all strings. */
function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildFlowFile(nodes: CanvasNodeSnapshot[], edges: FlowFileEdge[], configs: FlowFileConfig[] = []): FlowFile {
  const sortedNodes = [...nodes].sort((a, b) => cmpId(a.id, b.id));
  const sortedEdges = [...edges].sort((a, b) => cmpId(a[0], b[0]) || a[1] - b[1] || cmpId(a[2], b[2]) || a[3] - b[3]);
  const sortedConfigs = [...configs].sort((a, b) => cmpId(a.id, b.id));

  const layout: Record<string, FlowFileLayoutEntry> = {};
  for (const n of sortedNodes) {
    layout[n.id] = n.size ? { pos: n.pos, size: n.size } : { pos: n.pos };
  }

  return {
    formatVersion: FLOW_FILE_FORMAT_VERSION,
    nodes: sortedNodes.map((n) => ({ id: n.id, type: n.type, properties: n.properties })),
    edges: sortedEdges,
    layout,
    configs: sortedConfigs.map((c) => ({ id: c.id, type: c.type, properties: c.properties })),
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
 *
 * `configs` is the one field treated as optional on input (see this file's
 * header) -- every other top-level field stays mandatory, unchanged.
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
  if (obj.configs !== undefined && !Array.isArray(obj.configs)) throw new FlowFileError('"configs" must be an array');

  const nodes: FlowFileNode[] = obj.nodes.map((n, i) => {
    if (typeof n !== "object" || n === null) throw new FlowFileError(`nodes[${i}] must be an object`);
    const rec = n as Record<string, unknown>;
    if (typeof rec.id !== "string") throw new FlowFileError(`nodes[${i}].id must be a string`);
    if (typeof rec.type !== "string") throw new FlowFileError(`nodes[${i}].type must be a string`);
    if (typeof rec.properties !== "object" || rec.properties === null) throw new FlowFileError(`nodes[${i}].properties must be an object`);
    return { id: rec.id, type: rec.type, properties: rec.properties as Record<string, unknown> };
  });

  const edges: FlowFileEdge[] = obj.edges.map((e, i) => {
    if (!Array.isArray(e) || e.length !== 4 || typeof e[0] !== "string" || typeof e[1] !== "number" || typeof e[2] !== "string" || typeof e[3] !== "number") {
      throw new FlowFileError(`edges[${i}] must be a 4-element array [originId: string, originSlot: number, targetId: string, targetSlot: number]`);
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

  const configsArr = Array.isArray(obj.configs) ? obj.configs : [];
  const configs: FlowFileConfig[] = configsArr.map((c, i) => {
    if (typeof c !== "object" || c === null) throw new FlowFileError(`configs[${i}] must be an object`);
    const rec = c as Record<string, unknown>;
    if (typeof rec.id !== "string") throw new FlowFileError(`configs[${i}].id must be a string`);
    if (typeof rec.type !== "string") throw new FlowFileError(`configs[${i}].type must be a string`);
    if (typeof rec.properties !== "object" || rec.properties === null) throw new FlowFileError(`configs[${i}].properties must be an object`);
    return { id: rec.id, type: rec.type, properties: rec.properties as Record<string, unknown> };
  });

  return { formatVersion: obj.formatVersion, nodes, edges, layout, configs };
}
