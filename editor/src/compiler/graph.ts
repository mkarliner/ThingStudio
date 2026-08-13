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

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
