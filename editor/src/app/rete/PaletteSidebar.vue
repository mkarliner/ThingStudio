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

  wifi_status/udp_receive/udp_send added config-node-and-palette-
  implementation-briefing.md (2026-08-18) -- same source-then-sink display
  ordering convention as every prior addition to this list.

  mqtt_subscribe/mqtt_publish added 2026-08-21 -- same config-node
  migration as wifi_status/udp_send/udp_receive got, plus first-time
  canvas wiring at all (nodes.ts's own header). Same source-then-sink
  ordering: mqtt_subscribe sits with the other sources, mqtt_publish with
  the other sinks.

  Custom nodes (docs/working-notes/custom-node-authoring-scoping.md,
  2026-08-20): a second section below the built-in list, populated from
  custom-nodes-store.ts, plus a "Load custom node..." action that owns the
  actual file-pick/validate/register sequence (custom-node-io.ts +
  custom-node.ts's validateCustomNodeDescriptor + the store) end to end --
  kept here rather than in main.ts since it's entirely about this
  sidebar's own list, and this component already owns its own drag
  source/click-to-add wiring for the built-in list. Reports outcome via
  two new emits (`customNodeLoaded`/`customNodeLoadError`) rather than
  reaching into main.ts's console directly, matching this file's existing
  "only talk to the parent via emits" shape.
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
    <p v-if="visibleKinds.length === 0 && customRows.length === 0" class="hint">No nodes match "{{ filter }}".</p>

    <template v-if="customRows.length > 0">
      <div class="palette-category">custom nodes</div>
      <button
        v-for="row in customRows"
        :key="row.type"
        class="palette-row"
        :style="{ borderColor: row.color }"
        draggable="true"
        @click="emit('addCustom', row.type)"
        @dragstart="onCustomDragStart($event, row.type)"
      >
        <span class="palette-icon" :style="{ background: row.bgcolor }">{{ row.icon }}</span>
        <span class="palette-label">{{ row.label }}</span>
      </button>
    </template>

    <button class="palette-row load-custom-row" @click="onLoadCustomNode">
      <span class="palette-icon">+</span>
      <span class="palette-label">Load custom node…</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, DRAG_MIME, CUSTOM_DRAG_MIME, type NodeKind } from "./palette";
import { customNodePackages, customNodesVersion, loadOrReplaceCustomNodePackage } from "./custom-nodes-store";
import { loadCustomNodePackageFromDisk, CustomNodeFileIoError } from "../../flow-file/custom-node-io";
import { validateCustomNodeDescriptor, CustomNodeDescriptorError } from "../../node-library/custom-node";

const emit = defineEmits<{
  add: [kind: NodeKind];
  addCustom: [type: string];
  customNodeLoaded: [type: string];
  customNodeLoadError: [message: string];
}>();

// Display order -- sources first (inject, timer, interrupt, wifi_status,
// udp_receive, mqtt_subscribe), then processing (function), then sinks
// (gpio_out, udp_send, mqtt_publish, debug).
const KINDS: NodeKind[] = [
  "inject",
  "timer",
  "interrupt",
  "wifi_status",
  "udp_receive",
  "mqtt_subscribe",
  "function",
  "gpio_out",
  "udp_send",
  "mqtt_publish",
  "debug",
];

const filter = ref("");
const visibleKinds = computed(() =>
  KINDS.filter((kind) => NODE_PALETTE[kind].label.toLowerCase().includes(filter.value.trim().toLowerCase())),
);

const customRows = computed(() => {
  customNodesVersion.value; // reactive dependency -- see custom-nodes-store.ts's own header
  const needle = filter.value.trim().toLowerCase();
  return [...customNodePackages.value.values()]
    .map((pkg) => ({
      type: pkg.descriptor.type,
      label: pkg.descriptor.label,
      color: pkg.descriptor.color ?? DEFAULT_KIND_STYLE.color,
      bgcolor: pkg.descriptor.bgcolor ?? DEFAULT_KIND_STYLE.bgcolor,
      icon: pkg.descriptor.icon ?? "◆",
    }))
    .filter((row) => row.label.toLowerCase().includes(needle));
});

// Native HTML5 drag-and-drop, not a Rete plugin -- see this file's header
// comment for why. `effectAllowed = "copy"` matches the gesture's actual
// meaning (dragging a palette row creates a new node, doesn't move
// anything out of the palette).
function onDragStart(event: DragEvent, kind: NodeKind): void {
  event.dataTransfer?.setData(DRAG_MIME, kind);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

// Separate MIME type from the built-in kind's own DRAG_MIME -- a custom
// node's payload is its own type id (an arbitrary namespaced string, e.g.
// "custom/dht22"), not one of NodeKind's fixed literal union, so the drop
// handler (main.ts) needs a way to tell which table to look the dropped
// value up in without guessing from its shape.
function onCustomDragStart(event: DragEvent, type: string): void {
  event.dataTransfer?.setData(CUSTOM_DRAG_MIME, type);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

async function onLoadCustomNode(): Promise<void> {
  let jsonName = "*.node.json"; // overwritten once the picker resolves; fallback keeps a pre-pick JSON.parse failure's message generic-but-sensible
  try {
    const files = await loadCustomNodePackageFromDisk();
    if (!files) return; // user cancelled the picker
    jsonName = files.jsonName;
    const rawDescriptor: unknown = JSON.parse(files.jsonText);
    const descriptor = validateCustomNodeDescriptor(rawDescriptor);
    loadOrReplaceCustomNodePackage(descriptor, files.pythonText);
    emit("customNodeLoaded", descriptor.type);
  } catch (err) {
    const message =
      err instanceof CustomNodeFileIoError || err instanceof CustomNodeDescriptorError
        ? err.message
        : err instanceof SyntaxError
          ? `"${jsonName}" is not valid JSON: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
    emit("customNodeLoadError", message);
  }
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
.load-custom-row {
  margin-top: 8px;
  border-style: dashed;
  border-color: #555;
  color: #aaa;
  cursor: pointer;
}
.load-custom-row .palette-icon {
  background: #333;
}
</style>
