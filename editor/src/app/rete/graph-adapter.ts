// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/graph-adapter.ts
//
// Phase 2 of docs/working-notes/rete-migration-decision.md's scoped plan
// (sub-decision 1): a Rete-graph -> compiler `GraphData` adapter, keeping
// compiler/graph.ts's tested `{nodes, links}` input contract unchanged
// rather than touching tested compiler code for a shape change with no
// benefit today. This is the one genuinely new piece of logic in the
// whole migration -- everything downstream of it (compile.ts, the ~20
// node-library/compiler test suites) stays untouched and has to keep
// trusting whatever this function hands it.
//
// Two real conversions happen here, not one:
//
//   1. IDs. GraphNode.id/GraphLink's node-id fields are `number`
//      (graph.ts's header: modeled on Litegraph's own auto-incrementing
//      numeric node IDs). Rete's ClassicPreset.Node.id is a string UUID
//      (crypto.randomUUID(), set by the class's own constructor) -- there
//      is no numeric ID anywhere in a Rete graph to reuse. This adapter
//      assigns sequential integers (1-indexed, matching Litegraph's own
//      convention of never using 0) in `editor.getNodes()` order, and
//      returns the string<->number mapping alongside the compiled
//      GraphData so a later caller (main.ts's error-attribution path,
//      §5/§13's NODE_ERROR handling -- Phase 3, not built here) can map a
//      numeric node ID from a compile error or a device NODE_ERROR back to
//      the actual canvas node to highlight. Recomputed fresh on every
//      call -- there is no persistent numbering across calls, by design,
//      since the alternative (a stable ID surviving node
//      deletion/re-creation) is more machinery than anything downstream
//      currently needs.
//
//   2. Slot indices. compiler/graph.ts's own `GraphLink` header documents
//      `origin_slot`/`target_slot` as real positional indices, and
//      rete-migration-decision.md's sub-decision 1 is explicit that this
//      adapter must compute them for real rather than hardcoding 0 "since
//      it's 0 everywhere today" -- mvp-feature-priorities.md already has a
//      two-output status router and a generic switch/router node waiting
//      on exactly this, and poc-rete's own headless check (README.md,
//      "Multi-output routing gap") confirmed Rete supports
//      independently-keyed named outputs with zero extra plumbing, so the
//      limitation is purely in this adapter if it hardcodes anything.
//      Rete connections reference sockets by string key
//      (`sourceOutput`/`targetInput`), not by index -- the index is
//      recovered here from each key's position in
//      `Object.keys(node.outputs)`/`Object.keys(node.inputs)`, which for a
//      plain JS object with string keys is insertion order (the same
//      order `addOutput`/`addInput` were called in each node class's
//      constructor, nodes.ts) -- matching Litegraph's own positional slot
//      convention. `compile.ts` itself doesn't read either slot field or
//      the link's `type` field today (only `originId`/`targetId` are
//      destructured from a GraphLink there), so nothing observable changes
//      yet -- this only matters the moment a multi-output node type
//      exists.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// `toGraphData()` takes an explicit `configs` parameter rather than
// reading app/rete/store.ts's config store itself -- same reasoning this
// file's own header already gives for staying framework/DOM-agnostic:
// this module has no Vue import today and stays fully unit-testable
// headlessly (graph-adapter.test.ts) without one. main.ts is the only real
// caller and already has the store's contents in hand when it calls this.
//
// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20): `type` below now reads each node's own
// `nodeType` field (nodes.ts) instead of computing
// `` `thingstudio/${n.kind}` `` -- that concatenation assumed every node
// lives in the "thingstudio/" namespace and that its palette `kind` names
// the rest of the type string, both true for the 9 first-party classes
// but not for a loaded custom node (own namespace, e.g. "custom/dht22",
// no fixed relationship between `kind` and a type suffix). Zero behavior
// change for first-party nodes -- `nodeType` was set to exactly what this
// used to compute, see nodes.ts's own header on that change.
//
// Not built here (Phase 3, main.ts wiring): calling this from
// `currentSource()` in place of `graph.serialize()`, or using
// `nodeIdByReteId` for highlighting. This module is a pure function over
// a `NodeEditor` -- no DOM, no AreaPlugin -- so it's fully unit-testable
// headlessly (graph-adapter.test.ts), same "off-device testable" property
// the implementation briefing called out for this phase.

import type { GraphConfigNode, GraphData, GraphLink, GraphNode } from "../../compiler/graph.js";
import type { Editor, Schemes } from "./schemes";
import type { AnyThingstudioNode } from "./nodes";

export interface GraphAdapterResult {
  graphData: GraphData;
  /** Numeric compiler-facing ID -> the Rete node's own string ID. */
  reteIdByNodeId: Map<number, string>;
  /** The reverse of the above. */
  nodeIdByReteId: Map<string, number>;
}

// Exported (Phase 3): main.ts's extractCanvasSnapshot() needs the exact
// same "socket key -> positional index" math when saving a flow file, and
// re-deriving it there instead of importing it would risk the two drifting
// apart -- both callers must agree on what "slot 0" means for a given node.
export function socketIndex(keys: string[], key: string): number {
  const i = keys.indexOf(key);
  // A connection can't reference a socket key its own source/target node
  // doesn't have -- Rete's own addConnection would have had nothing to
  // attach to. Defensive, not expected to trigger: -1 would silently
  // corrupt origin_slot/target_slot into a value indistinguishable from a
  // real index, so this fails loudly instead (CLAUDE.md's fault-handling
  // priority) rather than emitting bad data compile.ts happens not to
  // check today.
  if (i === -1) throw new Error(`graph-adapter: socket key "${key}" not found among [${keys.join(", ")}]`);
  return i;
}

/** `configs` is folded into the returned GraphData verbatim (already the
 * right shape -- store.ts's ConfigEntry and GraphConfigNode agree on
 * {id, type, properties}) -- optional and defaults to none, so every
 * existing call site/test predating config nodes keeps compiling and
 * behaving unchanged. */
export function toGraphData(editor: Editor, configs: GraphConfigNode[] = []): GraphAdapterResult {
  const reteNodes = editor.getNodes();
  const reteIdByNodeId = new Map<number, string>();
  const nodeIdByReteId = new Map<string, number>();
  reteNodes.forEach((node, i) => {
    const numericId = i + 1; // 1-indexed, matches Litegraph's own convention (never uses 0)
    reteIdByNodeId.set(numericId, node.id);
    nodeIdByReteId.set(node.id, numericId);
  });

  const nodes: GraphNode[] = reteNodes.map((node) => {
    const n = node as AnyThingstudioNode;
    return {
      id: nodeIdByReteId.get(n.id)!,
      // See this file's header (Custom node authoring) -- n.nodeType is
      // each node class's own real compiler type string, not derived here.
      type: n.nodeType,
      properties: n.properties,
    };
  });

  const links: GraphLink[] = editor.getConnections().map((conn: Schemes["Connection"], i: number) => {
    const sourceNode = editor.getNode(conn.source);
    const targetNode = editor.getNode(conn.target);
    if (!sourceNode || !targetNode) {
      // Rete itself guarantees a connection's endpoints exist (addConnection
      // validates this before the connection is added) -- not expected to
      // trigger, kept as an invariant rather than assumed, same reasoning
      // as socketIndex's guard above.
      throw new Error(`graph-adapter: connection ${conn.id} references a missing node`);
    }
    const originId = nodeIdByReteId.get(conn.source)!;
    const targetId = nodeIdByReteId.get(conn.target)!;
    const originSlot = socketIndex(Object.keys(sourceNode.outputs), conn.sourceOutput);
    const targetSlot = socketIndex(Object.keys(targetNode.inputs), conn.targetInput);
    const socketType = sourceNode.outputs[conn.sourceOutput]?.socket.name ?? "any";

    const link: GraphLink = [i + 1, originId, originSlot, targetId, targetSlot, socketType];
    return link;
  });

  const graphData: GraphData = { nodes, links };
  if (configs.length > 0) graphData.configs = configs;

  return { graphData, reteIdByNodeId, nodeIdByReteId };
}
