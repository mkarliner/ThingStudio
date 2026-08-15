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
      <span class="hint">click a node in the palette (left) to add it — drag any node onto a wire to splice it in</span>
    </div>
    <div class="workspace">
      <PaletteSidebar @add="add" />
      <div ref="canvasEl" class="canvas"></div>
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
import PropertyPanel from "./PropertyPanel.vue";
import DebugSidebar from "./DebugSidebar.vue";
import PaletteSidebar from "./PaletteSidebar.vue";

const canvasEl = ref<HTMLElement | null>(null);
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
async function add(kind: keyof typeof factories) {
  if (!handle) return;
  const node = factories[kind]();
  await handle.addNode(node, { x: nextX, y: 40 });
  nextX += 200;
  if (node instanceof InjectNode) node.setupTimer();
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
