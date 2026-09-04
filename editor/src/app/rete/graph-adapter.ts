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
// IDs (simplified 2026-09-04, decisions.md's "Stable node IDs" entry):
// this used to be the one place doing real work here -- GraphNode.id was
// `number` (Litegraph's own auto-incrementing convention) while Rete's
// ClassicPreset.Node.id is a string UUID (crypto.randomUUID(), set by the
// class's own constructor), so this function assigned fresh sequential
// integers on every call and returned a string<->number mapping
// (`reteIdByNodeId`/`nodeIdByReteId`) so a later caller could translate
// between the two -- recomputed fresh every time, no persistent numbering
// across calls, by design, since nothing downstream needed identity to
// survive an edit or redeploy back when this was written.
//
// That's no longer the design: GraphNode.id is now `string` (graph.ts's
// own header), and this function passes each Rete node's own `.id`
// straight through as the compiler-facing id -- no remapping, no second
// ID space, and therefore no mapping to compute or return. A node's id is
// simply the same string everywhere: on the canvas, in a saved flow file,
// in generated Python, and on the wire (§13 messages already carried
// `nodeId` as a string -- see messages.ts's header -- so this change
// needed zero protocol changes, only this adapter and the few
// editor-side consumers of the old numeric id). This is what makes
// main.ts's highlightNode() (Phase 3, NODE_ERROR/DEBUG-line attribution)
// a plain `editor.getNode(nodeId)` lookup now instead of needing this
// module's old id-mapping output at all.
//
// One real conversion still happens here:
//
//   Slot indices. compiler/graph.ts's own `GraphLink` header documents
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

import type { GraphConfigNode, GraphData, GraphLink } from "../../compiler/graph.js";
import type { Editor, Schemes } from "./schemes";
import type { AnyThingstudioNode } from "./nodes";

// Exported: main.ts's extractCanvasSnapshot() needs the exact same
// "socket key -> positional index" math when saving a flow file, and
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
export function toGraphData(editor: Editor, configs: GraphConfigNode[] = []): GraphData {
  const reteNodes = editor.getNodes();

  const nodes = reteNodes.map((node) => {
    const n = node as AnyThingstudioNode;
    return {
      // Passed straight through -- see this file's header. n.id is
      // already the string every other consumer (flow-file, wire
      // protocol, device-runtime) treats as this node's real identity.
      id: n.id,
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
    const originSlot = socketIndex(Object.keys(sourceNode.outputs), conn.sourceOutput);
    const targetSlot = socketIndex(Object.keys(targetNode.inputs), conn.targetInput);
    const socketType = sourceNode.outputs[conn.sourceOutput]?.socket.name ?? "any";

    const link: GraphLink = [i + 1, conn.source, originSlot, conn.target, targetSlot, socketType];
    return link;
  });

  const graphData: GraphData = { nodes, links };
  if (configs.length > 0) graphData.configs = configs;

  return graphData;
}
