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
// Panes (2026-09-13, outstanding-items/multi-pane-canvas.md): `panes`
// (an ordered list of {id, name} tabs) and `paneOf` (nodeId -> pane id)
// follow `layout`'s own precedent exactly, for the identical reason --
// which pane a node sits in, or which pane is currently open, is a
// visual/organizational fact, not a behavior change, so it's split out
// of `nodes` the same way position is. `paneOf` is built from
// `sortedNodes` the same deterministic way `layout` is. Both are treated
// as optional on parse (see parseFlowFile) so a pre-panes flow file keeps
// loading unchanged, same backward-compatibility precedent as `configs`.
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

import type { ScreensSection } from "../gui/screens.js";

export const FLOW_FILE_FORMAT_VERSION = 1;

/** Default flow name until the user sets one (main.ts's flow-name input) --
 * see FlowFile.flowName's own doc comment. */
export const DEFAULT_FLOW_NAME = "untitled flow";

/** The single pane a freshly-built flow (or a pre-panes flow file loading
 * for the first time, parseFlowFile below) starts with. Fixed, not
 * generated (crypto.randomUUID()) -- an old flow file re-saved unedited
 * must produce byte-identical JSON (this file's own determinism
 * requirement, header comment), so the synthesized default pane's id has
 * to be stable across repeated parses of the same input, not fresh every
 * time. */
export const DEFAULT_PANE_ID = "pane-1";
export const DEFAULT_PANE_NAME = "Flow 01";

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

/** One pane (tab) -- see this file's header. Ordered by creation, no
 * reordering yet (multi-pane-canvas.md's MVP scope). */
export interface FlowFilePane {
  id: string;
  name: string;
}

export interface FlowFile {
  formatVersion: number;
  /** Human-readable identity for this flow -- added 2026-09-05
   * (decisions.md's "flow identity" entry), the direct follow-on to
   * device-runtime's boot-time flow auto-resume: once a flow can
   * survive a reset, "is the flow running on this device the one I have
   * open" becomes a real question. This is the stable half of that
   * answer (main.ts's DEPLOY handler also sends a fresh per-deploy uuid,
   * messages.ts's `deployId` -- see that field's own doc comment for why
   * identity is split this way). Deliberately a plain user-edited string,
   * not a generated id: Mike's own call, matching a uuid against flow
   * files on disk "would be painful" with no index to search. Always a
   * string in a file this module builds (defaults to DEFAULT_FLOW_NAME);
   * parseFlowFile treats a missing key on an older, pre-flow-name file
   * the same way, so hand-written and previously-saved files without
   * this key keep loading unchanged (same precedent as `configs`). */
  flowName: string;
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
  /** Ordered by creation (no reordering yet -- see this file's header).
   * Always at least one entry on anything this module builds; parseFlowFile
   * treats a missing/absent key on a pre-panes flow file as a single
   * default pane (DEFAULT_PANE_ID/DEFAULT_PANE_NAME) holding every node,
   * same backward-compatibility precedent as `configs`. */
  panes: FlowFilePane[];
  /** nodeId -> pane id, same "split from the node's own data, regenerated
   * from the live node set on every save" shape `layout` already has (see
   * this file's header) -- no separate store to drift out of sync. A node
   * id absent from this map (a pre-panes flow file, or a node saved before
   * panes existed) falls back to `panes[0].id` at load time, same
   * missing-entry handling `layout` already gets in main.ts's
   * applyFlowFile(). */
  paneOf: Record<string, string>;
  /** The GUI's page layouts, per GUI screen node (gui/screens.ts) -- 2026-10-08. Like `layout`, where widgets
   * sit isn't wiring, so it's kept apart from `nodes`. Omitted when the flow has no GUI, so flows without one
   * save byte-for-byte as before. Checked for shape here; the compiler checks what it says. */
  screens?: ScreensSection;
  /** Free text the flow's author wrote about what it does and how to use it (2026-10-09, Mike's "flows should have
   * a notes section"). Omitted when empty, so flows without notes save byte-for-byte as before. */
  notes?: string;
}

/** What main.ts's canvas-reading code hands in -- plain data, no live
 * Litegraph node reference, so this module never needs one. */
export interface CanvasNodeSnapshot {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  pos: [number, number];
  size?: [number, number];
  /** Which pane this node belongs to -- split out into `paneOf` by
   * buildFlowFile below, same treatment `pos`/`size` already get for
   * `layout`. */
  paneId: string;
}

/** String comparator shared by every sort below (nodes, configs, and now
 * edges' node-id columns) -- ids stopped being numeric (see header), so
 * `a.id - b.id`-style arithmetic subtraction no longer type-checks or
 * means anything; this is the same three-way comparison configs already
 * used before this file's ids were all strings. */
function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildFlowFile(
  nodes: CanvasNodeSnapshot[],
  edges: FlowFileEdge[],
  configs: FlowFileConfig[] = [],
  flowName: string = DEFAULT_FLOW_NAME,
  // Defaults to the single starting pane -- a caller that hasn't been
  // taught about panes yet (any existing test fixture, for instance)
  // still gets a well-formed file rather than an empty `panes: []`,
  // which parseFlowFile would otherwise have no node to fall back onto.
  panes: FlowFilePane[] = [{ id: DEFAULT_PANE_ID, name: DEFAULT_PANE_NAME }],
  screens: ScreensSection = {},
  notes: string = "",
): FlowFile {
  const sortedNodes = [...nodes].sort((a, b) => cmpId(a.id, b.id));
  const sortedEdges = [...edges].sort((a, b) => cmpId(a[0], b[0]) || a[1] - b[1] || cmpId(a[2], b[2]) || a[3] - b[3]);
  const sortedConfigs = [...configs].sort((a, b) => cmpId(a.id, b.id));

  const layout: Record<string, FlowFileLayoutEntry> = {};
  const paneOf: Record<string, string> = {};
  for (const n of sortedNodes) {
    layout[n.id] = n.size ? { pos: n.pos, size: n.size } : { pos: n.pos };
    paneOf[n.id] = n.paneId;
  }

  return {
    formatVersion: FLOW_FILE_FORMAT_VERSION,
    flowName,
    nodes: sortedNodes.map((n) => ({ id: n.id, type: n.type, properties: n.properties })),
    edges: sortedEdges,
    layout,
    configs: sortedConfigs.map((c) => ({ id: c.id, type: c.type, properties: c.properties })),
    panes,
    paneOf,
    ...(Object.keys(screens).length > 0 ? { screens: Object.fromEntries(Object.keys(screens).sort(cmpId).map((k) => [k, screens[k]!])) } : {}),
    ...(notes.trim() !== "" ? { notes } : {}),
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
 * `configs`, `flowName`, `panes`, and `paneOf` are the fields treated as
 * optional on input (see this file's header) -- every other top-level
 * field stays mandatory, unchanged.
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
  // flowName is the one field treated as optional on input, same
  // backward-compatibility precedent as `configs` (this file's header):
  // an older/hand-written file simply doesn't have it, and gets the same
  // default a freshly-built one would. A *present* but wrong-typed value
  // still fails loudly, matching every other field's strictness.
  if (obj.flowName !== undefined && typeof obj.flowName !== "string") {
    throw new FlowFileError('"flowName" must be a string');
  }
  const flowName = typeof obj.flowName === "string" ? obj.flowName : DEFAULT_FLOW_NAME;
  if (!Array.isArray(obj.nodes)) throw new FlowFileError('"nodes" must be an array');
  if (!Array.isArray(obj.edges)) throw new FlowFileError('"edges" must be an array');
  if (typeof obj.layout !== "object" || obj.layout === null) throw new FlowFileError('"layout" must be an object');
  if (obj.configs !== undefined && !Array.isArray(obj.configs)) throw new FlowFileError('"configs" must be an array');
  // panes/paneOf: same optional-on-input treatment as configs/flowName
  // above (this file's header) -- a pre-panes flow file simply doesn't
  // have them.
  if (obj.panes !== undefined && !Array.isArray(obj.panes)) throw new FlowFileError('"panes" must be an array');
  if (obj.paneOf !== undefined && (typeof obj.paneOf !== "object" || obj.paneOf === null)) {
    throw new FlowFileError('"paneOf" must be an object');
  }

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

  // A pre-panes flow file (obj.panes absent) gets the same single default
  // pane a freshly-built one starts with (DEFAULT_PANE_ID/NAME) -- see
  // this file's header and DEFAULT_PANE_ID's own doc comment on why that
  // id is fixed rather than generated.
  // Explicit `unknown[]` annotation -- keeps both ternary branches
  // (obj.panes narrowed to unknown[], vs. the {id,name}[] fallback) from
  // inferring as a wider union than intended; matches configsArr's own
  // simpler version of this same pattern just above.
  const panesArr: unknown[] = Array.isArray(obj.panes) ? obj.panes : [{ id: DEFAULT_PANE_ID, name: DEFAULT_PANE_NAME }];
  const panes: FlowFilePane[] = panesArr.map((pn, i) => {
    if (typeof pn !== "object" || pn === null) throw new FlowFileError(`panes[${i}] must be an object`);
    const rec = pn as Record<string, unknown>;
    if (typeof rec.id !== "string") throw new FlowFileError(`panes[${i}].id must be a string`);
    if (typeof rec.name !== "string") throw new FlowFileError(`panes[${i}].name must be a string`);
    return { id: rec.id, name: rec.name };
  });
  if (panes.length === 0) throw new FlowFileError('"panes" must have at least one entry');

  // paneOf's values are only checked for shape (a string), not that they
  // name a real pane in `panes` -- same leniency `layout` already gets
  // (no cross-check against `nodes` either). A node id missing from this
  // map, or naming an unknown pane, both fall back to `panes[0].id` at
  // load time (main.ts's applyFlowFile) rather than failing the parse --
  // same "a partially-bad state should still load what it can" reasoning
  // applyFlowFile's own header already applies to layout/edges.
  const paneOfObj = (obj.paneOf ?? {}) as Record<string, unknown>;
  const paneOf: Record<string, string> = {};
  for (const key of Object.keys(paneOfObj)) {
    const value = paneOfObj[key];
    if (typeof value !== "string") throw new FlowFileError(`paneOf["${key}"] must be a string`);
    paneOf[key] = value;
  }

  let screens: ScreensSection | undefined;
  if (obj.screens !== undefined) {
    if (typeof obj.screens !== "object" || obj.screens === null || Array.isArray(obj.screens)) throw new FlowFileError('"screens" must be an object');
    for (const [id, spec] of Object.entries(obj.screens as Record<string, unknown>)) {
      if (typeof spec !== "object" || spec === null || !Array.isArray((spec as Record<string, unknown>).pages)) {
        throw new FlowFileError(`screens["${id}"] must be an object with a "pages" array`);
      }
    }
    screens = obj.screens as ScreensSection;
  }

  if (obj.notes !== undefined && typeof obj.notes !== "string") throw new FlowFileError('"notes" must be a string');
  const notes = typeof obj.notes === "string" && obj.notes.trim() !== "" ? obj.notes : undefined;

  return { formatVersion: obj.formatVersion, flowName, nodes, edges, layout, configs, panes, paneOf, ...(screens ? { screens } : {}), ...(notes !== undefined ? { notes } : {}) };
}
