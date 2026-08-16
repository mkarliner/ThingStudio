<!--
  editor/src/app/rete/PropertyPanel.vue

  Phase 3 item 13: real property panel, replacing app/nodes.ts's inline
  Litegraph widgets and main.ts's one-off `#code-modal` (the function
  node's only editing surface today). Ported from
  pocs/poc-rete/src/PropertyPanel.vue -- see that file's own header for why
  this pattern (an ordinary Vue component reading shared `selectedNode`
  state, no Rete API involved at all) generalizes to every node type for
  free, unlike a per-node-type modal hook.

  Trimmed from the poc-rete version in two ways, both because this app's
  real node set and scope differ from that spike's:
    - No `mqtt_publish` block -- that node type was never exposed on this
      canvas (nodes.ts's own header), even though node-library/
      mqtt-publish.ts exists for a later Tier.
    - No "inject now" button, and inject's payload-type/repeat selects
      don't call `retypeOutput()`/`setupTimer()` on change -- those were
      poc-rete's hooks into its own hand-rolled live-propagation machinery
      (InjectNode.fire()/setupTimer()), which doesn't exist on the real
      InjectNode class (nodes.ts) and is explicitly out of scope for this
      migration (rete-migration-decision.md, "rete-engine / canvas-side
      live value propagation"). Editing these fields just updates
      `properties` and touches propertyVersion, same as every other field
      here.
  Added relative to poc-rete: a `timer` block (`intervalMs`) -- poc-rete
  had no timer node to port a panel section from; this is fresh work,
  unverified in a real browser until Mike's hands-on pass, same caveat
  nodes.ts's own TimerNode carries.
-->
<template>
  <div class="property-panel">
    <div class="panel-eyebrow">Properties</div>
    <template v-if="node">
      <h3>
        <span class="kind-dot" :style="{ background: kindStyle.color }" />
        {{ node.label }} <span class="node-id">#{{ node.id.slice(0, 6) }}</span>
      </h3>

      <template v-if="node.kind === 'inject'">
        <label>payload type
          <select v-model="node.properties.payloadType" @change="touch">
            <option value="bool">bool</option>
            <option value="number">number</option>
            <option value="string">string</option>
          </select>
        </label>
        <label>value
          <input v-model="node.properties.payloadValue" @input="touch" />
        </label>
        <label>repeat
          <select v-model="node.properties.repeat" @change="touch">
            <option value="manual">manual</option>
            <option value="1s">1s</option>
            <option value="5s">5s</option>
            <option value="30s">30s</option>
          </select>
        </label>
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

      <template v-else-if="node.kind === 'timer'">
        <label>interval (ms)
          <input type="number" min="1" v-model.number="node.properties.intervalMs" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'debug'">
        <p class="hint">No properties -- this node just prints the inbound payload to the device console.</p>
      </template>
    </template>
    <p v-else class="hint">Select a node to edit its properties.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { selectedNode, bumpPropertyVersion, propertyVersion } from "./store";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind } from "./palette";

const node = computed(() => {
  propertyVersion.value; // establish reactive dependency even though mutations happen off-Vue
  return selectedNode.value;
});

const kindStyle = computed(() => (node.value ? (NODE_PALETTE[node.value.kind as NodeKind] ?? DEFAULT_KIND_STYLE) : DEFAULT_KIND_STYLE));

function touch(): void {
  bumpPropertyVersion();
}
</script>

<style scoped>
.property-panel {
  padding: 12px;
  color: #ddd;
  font: 12px/1.4 system-ui, sans-serif;
  overflow-y: auto;
}
.panel-eyebrow {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.property-panel h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 6px;
}
.kind-dot {
  width: 8px;
  height: 8px;
  border-radius: 5px;
  flex: 0 0 auto;
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
.hint {
  color: #888;
}
</style>
