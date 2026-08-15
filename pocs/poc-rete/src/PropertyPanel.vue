<!--
  Thingstudio poc-rete — checkpoint 4 (rete-spike-briefing.md #4): build one
  node type's property editing as a genuinely separate panel component (not
  inline widgets on the node body), confirm it reflects the currently
  selected node's state and edits propagate back correctly.

  This is a plain Vue SFC living in the app shell (App.vue), entirely outside
  Rete's own node/control rendering — it reads `selectedNode` from store.ts,
  which main.ts sets from the area's `nodepicked` signal. No Rete API is
  involved in this file at all, which is itself the finding: unlike
  poc-c/nodes.js's function-node modal (a one-off `window.openCodeEditor`
  hook built specifically for that one node type), this panel is just an
  ordinary component reading ordinary shared state, generalizes to every
  node type for free, and needed no canvas-library-specific plumbing.
-->
<template>
  <div class="property-panel">
    <template v-if="node">
      <h3>{{ node.label }} <span class="node-id">#{{ node.id.slice(0, 6) }}</span></h3>

      <template v-if="node.kind === 'inject'">
        <label>payload type
          <select v-model="node.properties.payloadType" @change="onInjectTypeChange">
            <option value="bool">bool</option>
            <option value="number">number</option>
            <option value="string">string</option>
          </select>
        </label>
        <label>value
          <input v-model="node.properties.payloadValue" @input="touch" />
        </label>
        <label>repeat
          <select v-model="node.properties.repeat" @change="onInjectRepeatChange">
            <option value="manual">manual</option>
            <option value="1s">1s</option>
            <option value="5s">5s</option>
            <option value="30s">30s</option>
          </select>
        </label>
        <button @click="fire">inject now</button>
      </template>

      <template v-else-if="node.kind === 'function'">
        <label class="code-label">
          code
          <textarea v-model="node.properties.code" @input="touch" rows="10" spellcheck="false"></textarea>
        </label>
      </template>

      <template v-else-if="node.kind === 'gpio_out'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'mqtt_publish'">
        <label>topic
          <input v-model="node.properties.topic" @input="touch" />
        </label>
        <label>qos
          <select v-model="node.properties.qos" @change="touch">
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label class="checkbox">
          <input type="checkbox" v-model="node.properties.retain" @change="touch" /> retain
        </label>
      </template>

      <template v-else-if="node.kind === 'debug'">
        <p class="hint">No properties — this node just prints to the sidebar (§8).</p>
      </template>
    </template>
    <p v-else class="hint">Select a node to edit its properties.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { selectedNode, bumpPropertyVersion, propertyVersion } from "./store";
import type { InjectNode } from "./nodes";

const node = computed(() => {
  propertyVersion.value; // establish reactive dependency even though mutations happen off-Vue
  return selectedNode.value;
});

function touch(): void {
  bumpPropertyVersion();
}

function onInjectTypeChange(): void {
  (selectedNode.value as InjectNode | null)?.retypeOutput();
  bumpPropertyVersion();
}

function onInjectRepeatChange(): void {
  (selectedNode.value as InjectNode | null)?.setupTimer();
  bumpPropertyVersion();
}

function fire(): void {
  (selectedNode.value as InjectNode | null)?.fire();
}
</script>

<style scoped>
.property-panel {
  padding: 12px;
  color: #ddd;
  font: 12px/1.4 system-ui, sans-serif;
}
.property-panel h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #fff;
}
.node-id {
  color: #777;
  font-weight: normal;
}
.property-panel label {
  display: block;
  margin-bottom: 8px;
}
.property-panel input,
.property-panel select,
.property-panel textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 3px;
  background: #1b1b1b;
  border: 1px solid #444;
  color: #eee;
  padding: 4px 6px;
  font-family: inherit;
}
.code-label textarea {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}
.checkbox input {
  width: auto;
}
.property-panel button {
  margin-top: 4px;
  padding: 5px 10px;
  cursor: pointer;
}
.hint {
  color: #888;
}
</style>
