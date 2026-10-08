// SPDX-License-Identifier: Apache-2.0
// editor/src/compiler/graph.ts
//
// The graph input shape the compiler consumes: Litegraph's
// `LGraph.serialize()` output (`{ nodes, links }`) -- the same format
// pocs/poc-d/compiler.js already used. Keeping this shape means whatever the
// real canvas integration produces later doesn't need translating.
//
// Node IDs, string not numeric (changed 2026-09-04, decisions.md's "Stable
// node IDs" entry): `GraphNode.id`/`GraphLink`'s node-id fields used to be
// `number` (Litegraph's own auto-incrementing convention, recomputed fresh
// by graph-adapter.ts on every compile -- see that file's git history for
// the numbering scheme this replaced). Now each node's id is its own Rete
// canvas identity (`crypto.randomUUID()`), passed through unchanged rather
// than remapped, so a node's compiler-facing/wire-protocol id is stable
// across edits and redeploys, not just within one compile. Link ids (the
// tuple's own first element) are unaffected -- they're this adapter's own
// per-call bookkeeping, never referenced by anything downstream (compile.ts
// only ever destructures originId/targetId from a GraphLink), so there's
// no reason to change what's already a throwaway number.

import type { ScreensSection } from "../gui/screens.js";

export interface GraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

/** [link_id, origin_id, origin_slot, target_id, target_slot, type] */
export type GraphLink = [number, string, number, string, number, string];

/**
 * A config node (docs/working-notes/config-node-and-palette-implementation-
 * briefing.md) -- the Node-RED "Server"-dropdown pattern: a small object
 * configured once (e.g. WiFi credentials) and referenced by ID from
 * ordinary nodes' properties, instead of duplicated as raw values on every
 * node that needs it. Deliberately NOT a GraphNode: no ports, never wired,
 * no codegen output of its own -- see compile.ts's header comment on why
 * configs are kept structurally separate from `GraphData.nodes` rather than
 * a 4th NodeKind, so the DAG walk (reachability/cycle detection/source-sink
 * rules) never has to know configs exist at all.
 *
 * String `id`, same as `GraphNode.id` now (both changed 2026-09-04) --
 * configs and nodes are still different entities with different identity
 * (a config id and a node id are never compared against each other
 * anywhere), they just happen to share the same representation today.
 */
export interface GraphConfigNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Optional -- a graph with no config nodes simply omits this (or leaves
   * it empty); every existing hand-built GraphData literal in the test
   * suite predates this field and stays valid unchanged. */
  configs?: GraphConfigNode[];
  /** The GUI's page layouts, per GUI screen node (gui/screens.ts). Optional: flows without a GUI omit it. */
  screens?: ScreensSection;
}
