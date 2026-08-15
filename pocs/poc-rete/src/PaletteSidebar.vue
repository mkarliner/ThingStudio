<!--
  Thingstudio poc-rete — node palette, moved into a real left sidebar per
  Mike's steer (2026-08-15, against the reference Node-RED screenshot): "the
  node palette should be in a left side bar like node-red. there should be
  no node palette on the top." Previously this was a row of "+ kind" buttons
  in App.vue's top toolbar; that's gone now, replaced by this component,
  positioned as the first child of App.vue's `.workspace` row (left of the
  canvas), matching where Node-RED's own "PALETTE" panel sits.

  Click-to-add, not drag-and-drop — real Node-RED's palette IS a drag
  source, and this build originally had that mechanism too, via
  rete-dock-plugin's bottom-left dock overlay on the canvas (checkpoint 3,
  rete-spike-briefing.md #3). Removed 2026-08-15 per Mike's steer ("remove
  the node palette from the bottom") once this sidebar existed alongside it
  and the two read as redundant — see editor-setup.ts's header comment for
  the real cost of that (checkpoint 3 no longer has a UI path in this
  build). This sidebar's click-to-add is the only node-creation entry point
  left besides "Load example flow"; dragging an already-placed node onto a
  wire (checkpoint 2) is unaffected.

  Colors/icons come from palette.ts, the same source ThingstudioNode.vue's
  canvas nodes render from, so this list can't visually drift from what
  clicking one of these actually produces.
-->
<template>
  <div class="palette-sidebar">
    <div class="palette-header">Palette</div>
    <input v-model="filter" class="palette-filter" type="text" placeholder="filter nodes" />
    <div class="palette-category">nodes</div>
    <button
      v-for="kind in visibleKinds"
      :key="kind"
      class="palette-row"
      :style="{ borderColor: NODE_PALETTE[kind].color }"
      @click="emit('add', kind)"
    >
      <span class="palette-icon" :style="{ background: NODE_PALETTE[kind].bgcolor }">{{ NODE_PALETTE[kind].icon }}</span>
      <span class="palette-label">{{ NODE_PALETTE[kind].label }}</span>
    </button>
    <p v-if="visibleKinds.length === 0" class="hint">No nodes match "{{ filter }}".</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { NODE_PALETTE, type NodeKind } from "./palette";

const emit = defineEmits<{ add: [kind: NodeKind] }>();

// Display order — deliberately not `Object.keys(NODE_PALETTE)` order
// (debug sorts before gpio_out/mqtt_publish there), kept matching the
// order the old toolbar buttons used instead.
const KINDS: NodeKind[] = ["inject", "function", "gpio_out", "mqtt_publish", "debug"];

const filter = ref("");
const visibleKinds = computed(() =>
  KINDS.filter((kind) => NODE_PALETTE[kind].label.toLowerCase().includes(filter.value.trim().toLowerCase())),
);
</script>

<style scoped>
.palette-sidebar {
  width: 170px;
  flex: 0 0 auto;
  background: #1c1c20;
  border-right: 1px solid #333;
  padding: 10px 8px;
  box-sizing: border-box;
  overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.palette-header {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  padding: 0 2px;
}
.palette-filter {
  display: block;
  width: 100%;
  box-sizing: border-box;
  background: #111;
  border: 1px solid #333;
  color: #ddd;
  padding: 4px 6px;
  font-size: 11px;
  border-radius: 3px;
  margin-bottom: 10px;
}
.palette-category {
  font-size: 10px;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 2px 4px;
}
.palette-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 6px;
  margin-bottom: 3px;
  background: #232328;
  border: 1px solid #333;
  border-left-width: 3px;
  border-radius: 3px;
  color: #eee;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.palette-row:hover {
  background: #2a2a30;
}
.palette-icon {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 10px;
  line-height: 1;
}
.palette-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  color: #666;
  font-size: 11px;
  padding: 4px 2px;
}
</style>
