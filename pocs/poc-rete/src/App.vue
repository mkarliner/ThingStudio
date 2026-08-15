<!-- Thingstudio poc-rete — app shell: toolbar, canvas, property panel,
     debug sidebar. Mirrors pocs/poc-c's layout (canvas + sidebar) with a
     property panel added, per checkpoint 4. -->
<template>
  <div class="shell">
    <div class="toolbar">
      <strong>poc-rete</strong>
      <button @click="add('inject')">+ inject</button>
      <button @click="add('function')">+ function</button>
      <button @click="add('gpio_out')">+ gpio out</button>
      <button @click="add('mqtt_publish')">+ mqtt out</button>
      <button @click="add('debug')">+ debug</button>
      <span class="spacer"></span>
      <button @click="loadExample">Load example flow</button>
      <button @click="clearAll">Clear canvas</button>
      <span class="hint">drag a node from the dock (bottom-left) onto the canvas, or drop one onto an existing wire to splice it in</span>
    </div>
    <div class="workspace">
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
.toolbar button {
  padding: 5px 10px;
  cursor: pointer;
}
.spacer { flex: 1; }
.hint { color: #888; font-size: 11px; max-width: 320px; }
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
