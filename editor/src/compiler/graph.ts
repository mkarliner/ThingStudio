// SPDX-License-Identifier: Apache-2.0
// editor/src/compiler/graph.ts
//
// The graph input shape the compiler consumes: Litegraph's
// `LGraph.serialize()` output (`{ nodes, links }`) -- the same format
// pocs/poc-d/compiler.js already used. Keeping this shape means whatever the
// real canvas integration produces later doesn't need translating.

export interface GraphNode {
  id: number;
  type: string;
  properties: Record<string, unknown>;
}

/** [link_id, origin_id, origin_slot, target_id, target_slot, type] */
export type GraphLink = [number, number, number, number, number, string];

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
 * String `id` deliberately, not the numeric node-ID space `GraphNode.id`
 * uses -- configs and nodes are different entities with different
 * identity; reusing the numeric space would invite an accidental
 * collision check that doesn't need to exist.
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
}
