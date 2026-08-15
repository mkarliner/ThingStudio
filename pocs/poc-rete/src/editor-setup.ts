// Thingstudio poc-rete — editor bootstrap. Wires together everything the
// four checkpoints in rete-spike-briefing.md need: the base NodeEditor +
// AreaPlugin + VuePlugin render (checkpoint 0, just to have a canvas at
// all), ConnectionPlugin + validation.ts (checkpoint 1), insert-node.ts
// (checkpoint 2), and selection tracking that feeds PropertyPanel.vue
// (checkpoint 4).
//
// Checkpoint 3 (palette drag-and-drop) is no longer wired into this
// build's UI — Mike's steer, 2026-08-15: "remove the node palette from the
// bottom," once PaletteSidebar.vue's left-sidebar click-to-add existed as
// well and having both read as redundant. Worth being plain about the
// real cost rather than folding it in quietly: DockPlugin was the only
// implementation in this build of the actual DOM drag-a-preview-onto-
// canvas gesture checkpoint 3 asks about (README.md: "wired per the
// official guide, not independently re-verified beyond that... this is
// the one checkpoint with no headless verification story worth
// attempting"). Removing it doesn't retract a "confirmed working" claim —
// that gesture was never independently re-verified hands-on to begin with
// — but it does mean this build no longer has *any* UI exercising it;
// re-adding `rete-dock-plugin` (still in package.json/package-lock.json,
// untouched, just unused now) is the way back if checkpoint 3 needs
// revisiting later. Click-to-add via PaletteSidebar.vue still exercises
// the same `addNode` path every other node-creation route uses, and
// dragging an existing node onto a wire (checkpoint 2) is unaffected —
// that path was already fixed to key off `nodetranslated`, which fires for
// an ordinary pointer-drag regardless of how the node was created.
import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { VuePlugin, Presets as VuePresets } from "rete-vue-plugin";

import type { AreaExtra, Schemes } from "./schemes";
import { InjectNode, FunctionNode, DebugNode, GpioOutNode, MqttPublishNode, type AnyThingstudioNode } from "./nodes";
import { installConnectionValidation } from "./validation";
import { installInsertableNodes } from "./insert-node";
import { selectedNode, logDebug, bumpPropertyVersion } from "./store";
import ThingstudioNode from "./ThingstudioNode.vue";

export async function createThingstudioEditor(container: HTMLElement) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new VuePlugin<Schemes, AreaExtra>();

  // Per-kind colors + live-value indicators, replacing the default classic
  // Vue preset's identical grey box for every node type (editor-look-and-
  // feel-briefing.md's "Why") via the official customization extension
  // point (retejs.org/docs/guides/renderers/vue, "Customization") rather
  // than fighting the shipped component's CSS from outside. One component
  // handles every kind (ThingstudioNode.vue switches internally on
  // `context.payload.kind`, already set on every node instance) instead of
  // five near-identical files.
  render.addPreset(VuePresets.classic.setup({ customize: { node: () => ThingstudioNode } }));
  connection.addPreset(ConnectionPresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);

  // --- checkpoint 1: mid-drag type rejection -----------------------------
  installConnectionValidation(editor, (rejected) => {
    // eslint-disable-next-line no-console
    console.warn("[poc-rete] rejected incompatible connection", rejected);
  });

  // --- checkpoint 2: drag-to-splice ---------------------------------------
  installInsertableNodes(editor, area);

  // --- checkpoint 4: selection tracking for PropertyPanel.vue -------------
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

  // --- multi-select (also worth recording, rete-spike-briefing.md) -------
  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });
  AreaExtensions.simpleNodesOrder(area);

  // --- mocked "live" propagation ------------------------------------------
  // Rete's core has no dataflow engine of its own (that's the separate
  // `rete-engine` package, not installed for this spike — see README.md's
  // "also worth recording" section). Like poc-c's Drawflow build, this is
  // hand-rolled: walk outgoing connections from whatever just fired.
  function propagate(fromNodeId: string, value: unknown): void {
    for (const conn of editor.getConnections()) {
      if (conn.source !== fromNodeId) continue;
      const target = editor.getNode(conn.target) as AnyThingstudioNode;
      if (target instanceof FunctionNode) {
        propagate(target.id, value); // mock pass-through, no real exec (matches poc-c)
      } else if (target instanceof DebugNode) {
        logDebug(`debug (#${target.id.slice(0, 6)})`, value);
      } else if (target instanceof GpioOutNode) {
        logDebug(`gpio out pin ${target.properties.pin}`, value);
        // Canvas-level "last value" feedback, restored per
        // editor-look-and-feel-briefing.md — matches poc-c's LED dot
        // (nodes.js's onDrawForeground) rather than leaving the debug
        // sidebar to carry that whole burden alone. `area.update` forces
        // ThingstudioNode.vue to re-render since Rete nodes are plain
        // classes, not Vue-reactive (same reason store.ts needs
        // bumpPropertyVersion for the property panel).
        target.lastValue = !!value;
        void area.update("node", target.id);
      } else if (target instanceof MqttPublishNode) {
        logDebug(`→ ${target.properties.topic}`, value);
        target.lastLabel = `→ ${target.properties.topic}: ${JSON.stringify(value)}`;
        void area.update("node", target.id);
      }
    }
  }

  editor.addPipe((context) => {
    if (context.type === "nodecreate" && context.data instanceof InjectNode) {
      context.data.onFire = (value) => propagate(context.data.id, value);
    }
    return context;
  });

  // inject nodes already added before this pipe existed (shouldn't happen
  // in practice since we always addNode after setup, but keep it honest)
  // — no-op guard, not load-bearing.

  return {
    editor,
    area,
    addNode: async (node: AnyThingstudioNode, position: { x: number; y: number }) => {
      await editor.addNode(node);
      await area.translate(node.id, position);
      return node;
    },
    connectNodes: async (
      source: AnyThingstudioNode,
      sourceKey: string,
      target: AnyThingstudioNode,
      targetKey: string,
    ) => {
      await editor.addConnection(new ClassicPreset.Connection(source, sourceKey, target, targetKey) as Schemes["Connection"]);
    },
    fitView: () => AreaExtensions.zoomAt(area, editor.getNodes()),
    clear: async () => {
      for (const c of [...editor.getConnections()]) await editor.removeConnection(c.id);
      for (const n of [...editor.getNodes()]) await editor.removeNode(n.id);
      selectedNode.value = null;
      bumpPropertyVersion();
    },
  };
}

export type ThingstudioEditor = Awaited<ReturnType<typeof createThingstudioEditor>>;
