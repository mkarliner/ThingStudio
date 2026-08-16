<!-- Thingstudio poc-rete — app shell: toolbar, canvas, property panel,
     debug sidebar. Mirrors pocs/poc-c's layout (canvas + sidebar) with a
     property panel added, per checkpoint 4. -->
<template>
  <div class="shell">
    <div class="toolbar">
      <h1>poc-rete</h1>
      <button class="primary" @click="loadExample">Load example flow</button>
      <button class="danger" @click="clearAll">Clear canvas</button>
      <span class="spacer"></span>
      <span class="hint">click or drag a node from the palette (left) to add it — drag any node onto a wire to splice it in</span>
    </div>
    <div class="workspace">
      <PaletteSidebar @add="add" />
      <div
        ref="canvasEl"
        class="canvas"
        :class="{ 'drag-over': isDragOver }"
        @dragover.prevent
        @dragenter.prevent="isDragOver = true"
        @dragleave="isDragOver = false"
        @drop="onDrop"
      ></div>
      <div class="panel">
        <PropertyPanel />
        <div class="divider"></div>
        <DebugSidebar />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { createThingstudioEditor, type ThingstudioEditor } from "./editor-setup";
import { InjectNode, FunctionNode, DebugNode, GpioOutNode, MqttPublishNode } from "./nodes";
import { DRAG_MIME, type NodeKind } from "./palette";
import PropertyPanel from "./PropertyPanel.vue";
import DebugSidebar from "./DebugSidebar.vue";
import PaletteSidebar from "./PaletteSidebar.vue";

const canvasEl = ref<HTMLElement | null>(null);
const isDragOver = ref(false);
let handle: ThingstudioEditor | null = null;

const factories = {
  inject: () => new InjectNode(),
  function: () => new FunctionNode(),
  debug: () => new DebugNode(),
  gpio_out: () => new GpioOutNode(),
  mqtt_publish: () => new MqttPublishNode(),
};

onMounted(async () => {
  if (!canvasEl.value) return;
  handle = await createThingstudioEditor(canvasEl.value);
});

let nextX = 40;
async function add(kind: NodeKind, position?: { x: number; y: number }) {
  if (!handle) return;
  const node = factories[kind]();
  if (position) {
    // Drag-drop path: center the node under the cursor instead of its
    // top-left corner landing there — nicer to actually drop something
    // where you were aiming, and cheap since every node already carries
    // its own declared width/height (nodes.ts).
    await handle.addNode(node, { x: position.x - node.width / 2, y: position.y - node.height / 2 });
  } else {
    // Click-to-add path: unchanged auto-incrementing grid placement.
    await handle.addNode(node, { x: nextX, y: 40 });
    nextX += 200;
  }
  if (node instanceof InjectNode) node.setupTimer();
}

// Native HTML5 drag-and-drop (see PaletteSidebar.vue's header comment for
// why this isn't a Rete plugin): converts the drop's screen coordinates
// into the canvas's own graph coordinate space before calling `add()`.
// `handle.area.area.transform` (`{x, y, k}`, a public field on
// rete-area-plugin's `Area` class — `AreaPlugin.area`, confirmed in its
// installed type declarations) is the canvas's current pan (x, y) and zoom
// (k); a screen point maps back to graph space by subtracting the
// canvas's own on-screen offset and the pan, then dividing by zoom — the
// inverse of how the canvas positions/scales its content layer.
function onDrop(event: DragEvent): void {
  isDragOver.value = false;
  const kind = event.dataTransfer?.getData(DRAG_MIME) as NodeKind | "";
  if (!kind || !handle || !canvasEl.value) return;
  const rect = canvasEl.value.getBoundingClientRect();
  const { x: panX, y: panY, k: zoom } = handle.area.area.transform;
  const graphX = (event.clientX - rect.left - panX) / zoom;
  const graphY = (event.clientY - rect.top - panY) / zoom;
  void add(kind, { x: graphX, y: graphY });
}

async function loadExample() {
  if (!handle) return;
  await clearAll();
  const inject = new InjectNode();
  const fn = new FunctionNode();
  const gpio = new GpioOutNode();
  const mqtt = new MqttPublishNode();
  const debug = new DebugNode();

  await handle.addNode(inject, { x: 40, y: 160 });
  await handle.addNode(fn, { x: 260, y: 160 });
  await handle.addNode(gpio, { x: 480, y: 80 });
  await handle.addNode(mqtt, { x: 480, y: 200 });
  await handle.addNode(debug, { x: 480, y: 320 });

  // inject's default payloadType is bool, matching gpio_out's bool-only
  // input — same starting state poc-c's example flow used.
  await handle.connectNodes(inject, "msg", fn, "msg");
  await handle.connectNodes(fn, "msg", gpio, "signal");
  await handle.connectNodes(fn, "msg", mqtt, "msg"); // fan-out, same as poc-c
  await handle.connectNodes(fn, "msg", debug, "msg");

  inject.setupTimer();
  await handle.fitView();
}

async function clearAll() {
  await handle?.clear();
  nextX = 40;
}
</script>

<style>
html, body, #app { height: 100%; margin: 0; background: #16161a; }
</style>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: system-ui, sans-serif;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #202024;
  border-bottom: 1px solid #333;
  color: #eee;
}
.toolbar h1 {
  font-size: 12px;
  font-weight: 600;
  margin: 0 6px 0 0;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.toolbar button {
  padding: 5px 10px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #333;
  color: #eee;
  font-size: 12px;
  cursor: pointer;
}
.toolbar button:hover { filter: brightness(1.2); }
.toolbar button.primary { background: #4a9eff; border-color: #4a9eff; color: #fff; }
.toolbar button.danger { color: #ff8080; }
.spacer { flex: 1; }
.hint { color: #888; font-size: 11px; max-width: 420px; }
.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}
.canvas {
  flex: 1;
  position: relative;
  background: #16161a;
}
.canvas.drag-over {
  /* outline, not border/box-shadow — deliberately, same reasoning as
     ThingstudioNode.vue's own outline-vs-border note: doesn't participate
     in the box model, so it can't shift anything positioned against this
     element (irrelevant here today, but this element is exactly the kind
     rete-area-plugin measures things against — cheap to stay consistent
     rather than reintroduce that class of bug later). */
  outline: 2px dashed #4a9eff;
  outline-offset: -2px;
}
.panel {
  width: 300px;
  background: #1c1c20;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel > :first-child { flex: 0 0 auto; }
.divider { border-top: 1px solid #333; }
.panel > :last-child { flex: 1; min-height: 0; }
</style>
