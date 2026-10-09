// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/editor-setup.ts
//
// Rete editor bootstrap for the real canvas layer -- ported from
// pocs/poc-rete/src/editor-setup.ts, originally pared down to Phase 1's
// scope (rete-migration-decision.md's scoped task list, Phase 1 step 6):
// area plugin, connection plugin, Vue render preset with the real per-kind
// node/socket components, multi-select, and the checkpoint-1 validation
// pipe. Two things deliberately left out of that first pass have now been
// added, Phase 3 item 13:
//   - nodepicked selection tracking for the property panel, below --
//     ported from poc-rete's own editor-setup.ts checkpoint-4 block,
//     wired against this app's store.ts instead of poc-rete's.
// Still NOT included here, because it's explicitly out of scope for this
// migration (decision doc, "Not in scope"), not merely deferred:
//   - insert-node.ts's drag-to-splice -- pending Mike's
//     nodedragged-vs-nodetranslated call.
//   - propagate()'s hand-rolled live-value walk -- "rete-engine /
//     canvas-side live value propagation" is explicitly out of scope; the
//     real editor may need no execution engine at all (device-driven work
//     instead, per the decision doc).
//
// Wired into app/main.ts as of Phase 3 -- see that file's canvas-
// construction section for how `container` is obtained and how the
// returned handle is used (currentSource(), extractCanvasSnapshot(),
// applyFlowFile(), highlighting).
//
// Delete-node/delete-wire (2026-09-08, outstanding-items.md "UI / editor"
// section): customize.connection() (ThingstudioConnection.vue) makes wires
// clickable/selectable, mirroring the node selection this file already
// tracked; deleteSelected() below removes whatever's currently selected --
// every Rete-multi-selected node (and each connection touching one of
// them) if any, else the one selected wire. Wired to Delete/Backspace by
// main.ts, guarded there against deleting while a text field has focus.

import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { VuePlugin, Presets as VuePresets } from "rete-vue-plugin";

import type { AreaExtra, Schemes } from "./schemes";
import { type AnyThingstudioNode, FunctionNode, portSocket, functionOutputKey, functionNodeHeight } from "./nodes";
import { functionNode as functionNodeDefinition, MAX_FUNCTION_OUTPUTS } from "../../node-library/function-node";
import { installConnectionValidation } from "./validation";
import { selectedNode, selectedConnection, clearNodeSelection, setFunctionNodeOutputCount, bumpPropertyVersion } from "./store";
import { forgetNode, nodeIdsInPane, removePane } from "./panes-store";
import { forgetGuiNodes } from "./screens-store";
import ThingstudioNode from "./ThingstudioNode.vue";
import ThingstudioSocket from "./ThingstudioSocket.vue";
import ThingstudioConnection from "./ThingstudioConnection.vue";

// Inject's click-only live-fire feature (2026-09-02) used to route through
// an `onNodeClicked` hook here that could veto a whole-node click's
// selection (added 2026-09-12, outstanding-items/"Clicking on the inject
// node action opens the property sheet") -- but that made the *entire*
// node body a single click target that either fired (connected) or
// selected (not connected), with no way to open a live inject node's
// property panel at all short of disconnecting first (Mike, 2026-09-13).
// Replaced: the fire action now lives on the node's own "▶" icon
// specifically (ThingstudioNode.vue, via store.ts's `fireInjectNode`),
// which stops its pointerdown from ever reaching this file's nodepicked
// pipe below -- so a click anywhere else on an inject node (the label,
// the rest of the body) is always a real select, live or not, same as
// every other node kind. This file no longer needs to know anything
// about node kinds or live connections to make that work.
export async function createThingstudioEditor(container: HTMLElement) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new VuePlugin<Schemes, AreaExtra>();

  // Per-kind colors, replacing the default classic Vue preset's identical
  // grey box for every node type -- official customization extension point
  // (retejs.org/docs/guides/renderers/vue, "Customization"). `socket` is
  // overridden too, not just `node` -- see ThingstudioSocket.vue's own
  // header for the real bug this fixes.
  render.addPreset(
    VuePresets.classic.setup({ customize: { node: () => ThingstudioNode, socket: () => ThingstudioSocket, connection: () => ThingstudioConnection } }),
  );
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);

  // --- checkpoint 1's mechanism, now doing real work ----------------------
  // (see this file's header and validation.ts's own header). sockets.ts
  // carries real coercion-aware socket types as of the §6 wire-type
  // system (wire-type-system-scoping.md) -- this pipe can now actually
  // reject a connection, not just exist as a seam for later.
  installConnectionValidation(editor, (rejected) => {
    // eslint-disable-next-line no-console
    console.warn("[thingstudio] rejected incompatible connection", rejected);
  });

  // --- nodepicked selection tracking (Phase 3 item 13) --------------------
  // Ported from poc-rete's own editor-setup.ts, same mechanism: `area`'s
  // `nodepicked` signal fires on pointer-down over a node (rete-area-
  // plugin's own selection gesture, distinct from AreaExtensions.
  // selectableNodes' multi-select box below, which this doesn't replace).
  // PropertyPanel.vue reads `selectedNode` reactively; clicking empty
  // canvas (pointerdown directly on `container`, nothing above it) clears
  // the selection the same way poc-rete's did.
  area.addPipe((context) => {
    if (context.type === "nodepicked") {
      const node = editor.getNode(context.data.id) as AnyThingstudioNode | undefined;
      selectedNode.value = node ?? null;
      // A node click always wins over any previously selected wire --
      // mutual exclusivity, ThingstudioConnection.vue's own click handler
      // does the same in the other direction.
      selectedConnection.value = null;
    }
    return context;
  });
  container.addEventListener("pointerdown", (e) => {
    if (e.target === container) {
      selectedNode.value = null;
      selectedConnection.value = null;
    }
  });

  // --- multi-select (decision doc Phase 1 step 6) -------------------------
  // Captured (rather than discarded, as the original Phase 1 step 6 pass
  // left it) so its `select()` can be driven programmatically below --
  // needed for the console click-to-navigate feature (2026-09-04):
  // setting `selectedNode.value` alone (what the nodepicked pipe above
  // does) only drives PropertyPanel.vue: it's an app-level store write,
  // not Rete's own visual "selected" state (the `node.selected` flag this
  // extension flips, read by ThingstudioNode.vue to draw the highlight
  // border). A real canvas click gets both because the nodepicked pipe
  // and this extension both listen to the same underlying pointer
  // gesture; a console click has no gesture to listen to, so it has to
  // trigger both explicitly.
  // Captured separately from selectableNodes()'s own return value (not
  // just inlined as before) so deleteSelected() below can read which
  // nodes are currently multi-selected, and so clearNodeSelection (store.ts)
  // can hand ThingstudioConnection.vue a way to clear that multi-select
  // when a wire gets clicked instead -- see store.ts's own comment on why
  // that has to be threaded through a ref rather than an emit.
  const nodeSelector = AreaExtensions.selector();
  const nodeSelection = AreaExtensions.selectableNodes(area, nodeSelector, {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });
  clearNodeSelection.value = () => {
    void nodeSelector.unselectAll();
  };
  AreaExtensions.simpleNodesOrder(area);

  // Function-node output-count resize (multi-output-port support,
  // outstanding-items/connection-state-gate-router-nodes.md, 2026-09-12).
  // store.ts's own comment on setFunctionNodeOutputCount explains why this
  // lives here rather than in PropertyPanel.vue directly: `editor`/`area`
  // are only in scope inside this function. Only ever resizes from the
  // TAIL (adds/removes the highest-indexed output(s)) -- nodes.ts's
  // functionOutputKey() doc comment explains why that matters (JS object
  // key enumeration order for non-numeric-looking string keys is
  // insertion order, and graph-adapter.ts's socketIndex() depends on that
  // order matching output position).
  setFunctionNodeOutputCount.value = async (node: AnyThingstudioNode, count: number) => {
    if (!(node instanceof FunctionNode)) return;
    const clamped = Math.max(1, Math.min(MAX_FUNCTION_OUTPUTS, Math.round(count) || 1));
    const current = Object.keys(node.outputs).length;
    if (clamped === current) return;
    if (clamped > current) {
      for (let i = current; i < clamped; i++) {
        node.addOutput(functionOutputKey(i), new ClassicPreset.Output(portSocket(functionNodeDefinition.ports?.outputs, "msg", node.properties), String(i + 1)));
      }
    } else {
      // Shrinking: remove any wire attached to a port before removing the
      // port itself -- Rete core has no cascading removal of its own
      // (deleteSelected()'s own header comment above already found this
      // the hard way for node deletion), and an orphaned connection
      // referencing a since-removed output key would corrupt the very
      // next compile (graph-adapter.ts's socketIndex() throws on a socket
      // key it can't find).
      for (let i = clamped; i < current; i++) {
        const key = functionOutputKey(i);
        for (const c of [...editor.getConnections()]) {
          if (c.source === node.id && c.sourceOutput === key) await editor.removeConnection(c.id);
        }
        node.removeOutput(key);
      }
    }
    node.properties.outputCount = clamped;
    node.height = functionNodeHeight(clamped);
    await area.update("node", node.id);
  };

  // Console click-to-navigate viewport jump (outstanding-items/
  // console-click-viewport-jump.md, raised 2026-09-13): focusNode() below
  // used to pan/zoom unconditionally on every click, discarding whatever
  // part of a large flow was already in view even when the target node
  // was already fully on-screen. This checks that first.
  //
  // "Comfortably visible" = the node's full bounding box, in model space
  // (AreaExtensions.getBoundingBox(), the same helper zoomAt() itself
  // uses internally), maps entirely inside the container's viewport once
  // converted to screen space -- model -> screen is `* k + {x, y}` from
  // the area's own transform, the identical mapping content.holder's CSS
  // transform uses to actually paint nodes -- inset by a margin so a node
  // sitting right at the edge still counts as "not visible enough" (the
  // outstanding-items note's own suggestion). Falls back to needing a
  // pan/zoom (returns false) if the container hasn't been laid out yet
  // (clientWidth/clientHeight still 0) -- same as the pre-fix behavior.
  //
  // Deliberately does NOT account for the property panel/palette
  // occluding part of the canvas -- the outstanding-items note leaves
  // that unscoped; revisit if it proves annoying in practice.
  const FOCUS_VISIBILITY_MARGIN_PX = 40;
  function isNodeComfortablyVisible(node: AnyThingstudioNode): boolean {
    const viewportWidth = area.container.clientWidth;
    const viewportHeight = area.container.clientHeight;
    if (viewportWidth === 0 || viewportHeight === 0) return false;
    const box = AreaExtensions.getBoundingBox(area, [node]);
    const { x: tx, y: ty, k } = area.area.transform;
    const screenLeft = box.left * k + tx;
    const screenTop = box.top * k + ty;
    const screenRight = box.right * k + tx;
    const screenBottom = box.bottom * k + ty;
    return (
      screenLeft >= FOCUS_VISIBILITY_MARGIN_PX &&
      screenTop >= FOCUS_VISIBILITY_MARGIN_PX &&
      screenRight <= viewportWidth - FOCUS_VISIBILITY_MARGIN_PX &&
      screenBottom <= viewportHeight - FOCUS_VISIBILITY_MARGIN_PX
    );
  }

  return {
    editor,
    area,
    addNode: async (node: AnyThingstudioNode, position: { x: number; y: number }) => {
      await editor.addNode(node);
      await area.translate(node.id, position);
      return node;
    },
    // Returns addConnection's own boolean (Phase 3 addition) -- `false`
    // means the connection was rejected (validation.ts's pipe, or Rete's
    // own duplicate-connection guard) rather than silently added.
    // applyFlowFile()'s skip-and-report contract (main.ts, item 11) needs
    // this to tell "connected" from "rejected" without re-deriving it.
    connectNodes: (source: AnyThingstudioNode, sourceKey: string, target: AnyThingstudioNode, targetKey: string): Promise<boolean> => {
      return editor.addConnection(new ClassicPreset.Connection(source, sourceKey, target, targetKey) as Schemes["Connection"]);
    },
    fitView: () => AreaExtensions.zoomAt(area, editor.getNodes()),
    // Pan/zoom to bring one specific node into view -- same
    // AreaExtensions.zoomAt() fitView already uses above, just scoped to
    // a single-node array. Added for the console click-to-navigate
    // feature (main.ts's locateNode(), 2026-09-04): a clicked console
    // line (a NODE_ERROR, a DEBUG line, anything carrying a resolvable
    // node id) needs to bring its node into view even when it's
    // off-screen, not just select/highlight it in place. Only actually
    // pans/zooms when the node isn't already comfortably visible --
    // isNodeComfortablyVisible() above -- otherwise a no-op: the node
    // still gets selected (selectNode(), called separately by
    // locateNode()), it just doesn't move the view.
    focusNode: (node: AnyThingstudioNode) => {
      if (isNodeComfortablyVisible(node)) return Promise.resolve();
      return AreaExtensions.zoomAt(area, [node]);
    },
    // Drives both halves of "select this node" for a caller outside the
    // canvas's own pointer handling (the console click-to-navigate
    // feature, main.ts's locateNode(), 2026-09-04): the app-level store
    // write PropertyPanel.vue reads, and Rete's own visual selection
    // state (nodeSelection.select() above, `accumulate: false` so this
    // replaces any existing canvas selection rather than adding to it,
    // matching what a plain unmodified click on the canvas itself does).
    selectNode: async (node: AnyThingstudioNode) => {
      selectedNode.value = node;
      selectedConnection.value = null;
      await nodeSelection.select(node.id, false);
    },
    clear: async () => {
      for (const c of [...editor.getConnections()]) await editor.removeConnection(c.id);
      for (const n of [...editor.getNodes()]) {
        await editor.removeNode(n.id);
        forgetNode(n.id); // multi-pane-canvas.md's node-delete upkeep -- panes-store.ts's own header
      }
      // Selection can't survive a clear -- the selected node/connection
      // objects themselves are gone (poc-rete's editor-setup.ts clear()
      // does the same for the node half).
      selectedNode.value = null;
      selectedConnection.value = null;
      bumpPropertyVersion();
    },
    // Delete-node/delete-wire (2026-09-08). Removes every Rete-multi-
    // selected node (checked via the runtime-only `.selected` flag
    // AreaExtensions.selectableNodes maintains -- not declared on
    // AnyThingstudioNode itself, same widening ThingstudioNode.vue's own
    // props type already does) plus every connection touching one of
    // them, mirroring clear()'s connections-before-nodes order: Rete core
    // doesn't cascade removeNode() into its connections at all (confirmed
    // reading rete's own source -- it just throws "cannot find node" if
    // the id's unknown, no connection awareness whatsoever). Falls back to
    // the single selected wire (store.ts's `selectedConnection`) only when
    // no node is multi-selected, so a lone wire-click-then-Delete still
    // works without requiring a node to also be selected.
    deleteSelected: async () => {
      const selectedIds = new Set(
        (editor.getNodes() as (AnyThingstudioNode & { selected?: boolean })[]).filter((n) => n.selected).map((n) => n.id),
      );
      if (selectedIds.size > 0) {
        for (const c of [...editor.getConnections()]) {
          if (selectedIds.has(c.source) || selectedIds.has(c.target)) await editor.removeConnection(c.id);
        }
        for (const id of selectedIds) {
          await editor.removeNode(id);
          forgetNode(id); // multi-pane-canvas.md's node-delete upkeep -- panes-store.ts's own header
        }
        if (selectedNode.value && selectedIds.has(selectedNode.value.id)) selectedNode.value = null;
        forgetGuiNodes(selectedIds); // out of the screen layouts too
        bumpPropertyVersion();
        return;
      }
      if (selectedConnection.value) {
        const id = selectedConnection.value.id;
        // Guard against a stale reference (e.g. the connection's own node
        // was already removed through some other path) rather than
        // hitting removeConnection()'s "cannot find connection" throw.
        if (editor.getConnections().some((c) => c.id === id)) await editor.removeConnection(id);
        selectedConnection.value = null;
      }
    },
    // Multiple panes (2026-09-13, multi-pane-canvas.md's resolved design:
    // "removing a pane deletes its nodes"). Mirrors deleteSelected()'s own
    // connections-before-nodes order and node-delete upkeep. Returns
    // false (nothing removed) for the last remaining pane -- panes-
    // store.ts's removePane() own doc comment on why that's a reachable
    // UI state, not a programmer error; PaneTabs.vue is expected not to
    // offer "X" on the only remaining tab, but this guards the same
    // invariant regardless of what the UI does.
    deletePane: async (paneId: string): Promise<boolean> => {
      const nodeIds = new Set(nodeIdsInPane(paneId));
      if (nodeIds.size > 0) {
        for (const c of [...editor.getConnections()]) {
          if (nodeIds.has(c.source) || nodeIds.has(c.target)) await editor.removeConnection(c.id);
        }
        for (const id of nodeIds) {
          await editor.removeNode(id);
          forgetNode(id);
        }
        if (selectedNode.value && nodeIds.has(selectedNode.value.id)) selectedNode.value = null;
        forgetGuiNodes(nodeIds);
        bumpPropertyVersion();
      }
      return removePane(paneId);
    },
  };
}

export type ThingstudioEditor = Awaited<ReturnType<typeof createThingstudioEditor>>;
