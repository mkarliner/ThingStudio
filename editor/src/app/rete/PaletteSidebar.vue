<!--
  editor/src/app/rete/PaletteSidebar.vue

  Node palette, left sidebar per Node-RED's own layout. Ported from
  pocs/poc-rete/src/PaletteSidebar.vue -- see that file's header for the
  fuller history (why it's a sidebar and not a top toolbar, why
  drag-and-drop is native HTML5 rather than a Rete plugin). Click-to-add
  AND drag-and-drop; colors/icons come from palette.ts, the same source
  ThingstudioNode.vue's canvas nodes render from, so this list can't
  visually drift from what clicking/dropping a row actually produces.

  Not wired into App/main.ts yet -- the `add` event and the drop target
  that reads DRAG_MIME back out are both Phase 3 (main.ts's rewrite). This
  component is usable standalone once that wiring exists.
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
      draggable="true"
      @click="emit('add', kind)"
      @dragstart="onDragStart($event, kind)"
    >
      <span class="palette-icon" :style="{ background: NODE_PALETTE[kind].bgcolor }">{{ NODE_PALETTE[kind].icon }}</span>
      <span class="palette-label">{{ NODE_PALETTE[kind].label }}</span>
    </button>
    <p v-if="visibleKinds.length === 0" class="hint">No nodes match "{{ filter }}".</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { NODE_PALETTE, DRAG_MIME, type NodeKind } from "./palette";

const emit = defineEmits<{ add: [kind: NodeKind] }>();

// Display order -- sources first (inject, timer, interrupt), then
// processing (function), then sinks (gpio_out, debug).
const KINDS: NodeKind[] = ["inject", "timer", "interrupt", "function", "gpio_out", "debug"];

const filter = ref("");
const visibleKinds = computed(() =>
  KINDS.filter((kind) => NODE_PALETTE[kind].label.toLowerCase().includes(filter.value.trim().toLowerCase())),
);

// Native HTML5 drag-and-drop, not a Rete plugin -- see this file's header
// comment for why. `effectAllowed = "copy"` matches the gesture's actual
// meaning (dragging a palette row creates a new node, doesn't move
// anything out of the palette).
function onDragStart(event: DragEvent, kind: NodeKind): void {
  event.dataTransfer?.setData(DRAG_MIME, kind);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}
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
