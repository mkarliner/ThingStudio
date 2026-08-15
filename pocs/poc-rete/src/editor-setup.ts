// Thingstudio poc-rete — editor bootstrap. Wires together everything the
// four checkpoints in rete-spike-briefing.md need: the base NodeEditor +
// AreaPlugin + VuePlugin render (checkpoint 0, just to have a canvas at
// all), ConnectionPlugin + validation.ts (checkpoint 1), insert-node.ts
// (checkpoint 2), DockPlugin (checkpoint 3), and selection tracking that
// feeds PropertyPanel.vue (checkpoint 4).

import { NodeEditor, ClassicPreset } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { VuePlugin, Presets as VuePresets } from "rete-vue-plugin";
import { DockPlugin, DockPresets } from "rete-dock-plugin";

import type { AreaExtra, Schemes } from "./schemes";
import { InjectNode, FunctionNode, DebugNode, GpioOutNode, MqttPublishNode, type AnyThingstudioNode } from "./nodes";
import { installConnectionValidation } from "./validation";
import { installInsertableNodes } from "./insert-node";
import { selectedNode, logDebug, bumpPropertyVersion } from "./store";

export async function createThingstudioEditor(container: HTMLElement) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new VuePlugin<Schemes, AreaExtra>();
  const dock = new DockPlugin<Schemes>();

  render.addPreset(VuePresets.classic.setup());
  connection.addPreset(ConnectionPresets.classic.setup());
  dock.addPreset(DockPresets.classic.setup({ area, size: 80, scale: 0.55 }));

  editor.use(area);
  area.use(connection);
  area.use(render);
  area.use(dock);

  // --- checkpoint 1: mid-drag type rejection -----------------------------
  installConnectionValidation(editor, (rejected) => {
    // eslint-disable-next-line no-console
    console.warn("[poc-rete] rejected incompatible connection", rejected);
  });

  // --- checkpoint 2: drag-to-splice ---------------------------------------
  installInsertableNodes(editor, area);

  // --- checkpoint 3: palette drag-and-drop --------------------------------
  // Each factory is a fresh node instance per drop, matching the dock
  // plugin's documented contract ("called when a node is added to the Dock
  // menu or dragged onto the editor area").
  dock.add(() => new InjectNode());
  dock.add(() => new FunctionNode());
  dock.add(() => new GpioOutNode());
  dock.add(() => new MqttPublishNode());
  dock.add(() => new DebugNode());

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
      } else if (target instanceof MqttPublishNode) {
        logDebug(`→ ${target.properties.topic}`, value);
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
    dock,
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
