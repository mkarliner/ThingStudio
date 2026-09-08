<!--
  editor/src/app/rete/ThingstudioConnection.vue

  Custom connection (wire) renderer, replacing rete-vue-plugin's default
  Presets.classic Connection.vue (plain `<svg><path :d="path"/></svg>`,
  fixed steelblue, no interactivity beyond dragging a fresh wire out of a
  socket). Wired in via `customize.connection()` in editor-setup.ts,
  alongside the existing `customize.node()`/`customize.socket()`.

  Added 2026-09-08 for delete-node/delete-wire (outstanding-items.md
  "UI / editor" section): a wire has to be selectable before it can be
  deleted, and nothing in this app tracked that before now -- node
  selection already existed (store.ts's `selectedNode`), wire selection
  did not.

  Unlike ThingstudioNode.vue, this component gets no `emit` prop --
  rete-vue-plugin's classic preset only threads `emit` through to the
  node/socket/control render props; its render(), 'connection' branch
  hands the rendered component just {data, component, start, end, path}
  (confirmed reading rete-vue-plugin's compiled classic preset). So
  selection state is written straight to store.ts's `selectedConnection`
  ref rather than routed through an area pipe the way node selection is
  (editor-setup.ts's `nodepicked` pipe). `@pointerdown.stop` keeps a wire
  click from also reaching the canvas's own "click empty space clears
  selection" listener (editor-setup.ts, container-level) -- same reason
  the default Control.vue's own input stops pointerdown propagation.

  Path/svg markup and base styling ported from rete-vue-plugin's own
  default Connection.vue (steelblue, 5px stroke, svg absolute/pointer-
  events:none with pointer-events:auto opted back in on the path) so an
  unselected wire looks exactly as it always has; only the selected-state
  styling and the click handling are new.
-->
<template>
  <svg data-testid="connection">
    <path :d="path" :class="{ 'ts-wire-selected': isSelected }" @pointerdown.stop="select" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ClassicPreset } from "rete";
import { selectedConnection, selectedNode, clearNodeSelection } from "./store";

const props = defineProps<{
  data: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
  path: string;
}>();

const isSelected = computed(() => selectedConnection.value?.id === props.data.id);

function select(): void {
  selectedConnection.value = props.data;
  // Mutually exclusive with node selection -- see this file's header.
  selectedNode.value = null;
  clearNodeSelection.value?.();
}
</script>

<style scoped>
svg {
  overflow: visible !important;
  position: absolute;
  pointer-events: none;
  width: 9999px;
  height: 9999px;
}
path {
  fill: none;
  stroke-width: 5px;
  stroke: steelblue;
  pointer-events: auto;
  cursor: pointer;
}
path:hover {
  stroke: #6ea6d6;
}
/* Same selected-orange as ThingstudioNode.vue's `.selected` outline
   (#ff8f0e) -- one visual language for "this is the thing Delete will
   act on", node or wire. */
path.ts-wire-selected {
  stroke: #ff8f0e;
  stroke-width: 6px;
}
</style>
