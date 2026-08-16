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

import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { VuePlugin, Presets as VuePresets } from "rete-vue-plugin";

import type { AreaExtra, Schemes } from "./schemes";
import type { AnyThingstudioNode } from "./nodes";
import { installConnectionValidation } from "./validation";
import { selectedNode, bumpPropertyVersion } from "./store";
import ThingstudioNode from "./ThingstudioNode.vue";
import ThingstudioSocket from "./ThingstudioSocket.vue";

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
  render.addPreset(VuePresets.classic.setup({ customize: { node: () => ThingstudioNode, socket: () => ThingstudioSocket } }));
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);

  // --- checkpoint 1's mechanism, kept live as infrastructure -------------
  // (see this file's header and validation.ts's own header for why this
  // still gets wired even though sockets.ts's AnySocket always accepts).
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
    }
    return context;
  });
  container.addEventListener("pointerdown", (e) => {
    if (e.target === container) selectedNode.value = null;
  });

  // --- multi-select (decision doc Phase 1 step 6) -------------------------
  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });
  AreaExtensions.simpleNodesOrder(area);

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
    clear: async () => {
      for (const c of [...editor.getConnections()]) await editor.removeConnection(c.id);
      for (const n of [...editor.getNodes()]) await editor.removeNode(n.id);
      // Selection can't survive a clear -- the selected node object itself
      // is gone (poc-rete's editor-setup.ts clear() does the same).
      selectedNode.value = null;
      bumpPropertyVersion();
    },
  };
}

export type ThingstudioEditor = Awaited<ReturnType<typeof createThingstudioEditor>>;
