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

  http_request added 2026-09-05 -- its long-flagged canvas-presence
  follow-up finally closed (nodes.ts's own header, palette.ts's own
  header). Placed with `function`, the other transform-kind entry in this
  list (both input and output ports) -- it doesn't fit the source-then-
  sink convention above since it's neither.

  delay added 2026-09-06 -- same transform shape as function/http_request,
  placed alongside them for the same reason. filter (2026-09-26) likewise.

  Custom nodes (docs/working-notes/custom-node-authoring-scoping.md,
  2026-08-20): a second section below the built-in list, populated from
  custom-nodes-store.ts, plus a "Load custom node..." action that owns the
  actual list/fetch/validate/register sequence (admin-api-client.ts +
  custom-node.ts's validateCustomNodeDescriptor + the store) end to end --
  kept here rather than in main.ts since it's entirely about this
  sidebar's own list, and this component already owns its own drag
  source/click-to-add wiring for the built-in list. Reports outcome via
  two new emits (`customNodeLoaded`/`customNodeLoadError`) rather than
  reaching into main.ts's console directly, matching this file's existing
  "only talk to the parent via emits" shape.

  Backend-exclusive as of 2026-09-08 (main.ts's own header addendum): this
  used to open a native two-file picker (custom-node-io.ts) against local
  disk; it now lists what's saved on the backend's /api/custom-nodes and
  lets the user pick one from an inline expanding list (no native
  file-picker equivalent for "choose one of these backend-known names", so
  this renders its own small list of palette-row-styled buttons rather
  than inventing a new widget kind). custom-node-io.ts itself is
  unchanged and unused from here now, kept for the same "hidden, not
  deleted" reason main.ts's header gives WebSerial "direct" mode.
-->
<template>
  <div class="palette-sidebar" :class="{ 'is-collapsed': collapsed }">
    <div class="palette-header">
      <span v-if="!collapsed" class="palette-header-label">Palette</span>
      <button
        class="palette-collapse-toggle"
        :title="collapsed ? 'Expand palette' : 'Collapse palette'"
        @click="collapsed = !collapsed"
      >{{ collapsed ? "»" : "«" }}</button>
    </div>
    <template v-if="!collapsed">
      <input v-model="filter" class="palette-filter" type="text" placeholder="filter nodes" />

      <template v-for="group in groupedRows" :key="group.name">
        <div class="palette-category">{{ group.name }}</div>
        <button
          v-for="row in group.rows"
          :key="row.key"
          class="palette-row"
          :style="{ borderColor: row.color }"
          draggable="true"
          @click="onRowClick(row)"
          @dragstart="onRowDragStart($event, row)"
        >
          <span class="palette-icon" :style="{ background: row.bgcolor }">{{ row.icon }}</span>
          <span class="palette-label">{{ row.label }}</span>
        </button>
      </template>
      <p v-if="groupedRows.length === 0" class="hint">No nodes match "{{ filter }}".</p>

      <button class="palette-row load-custom-row" @click="onLoadCustomNode">
        <span class="palette-icon">+</span>
        <span class="palette-label">{{ backendCustomNodeChoices === null ? "Load custom node…" : "Cancel" }}</span>
      </button>
      <button
        v-for="name in backendCustomNodeChoices ?? []"
        :key="name"
        class="palette-row load-custom-row"
        @click="onPickBackendCustomNode(name)"
      >
        <span class="palette-icon">◆</span>
        <span class="palette-label">{{ name }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, DEFAULT_NODE_GROUPS, DRAG_MIME, CUSTOM_DRAG_MIME, type NodeKind } from "./palette";
import { customNodePackages, customNodesVersion, loadOrReplaceCustomNodePackage } from "./custom-nodes-store";
import { backendWsUrl } from "./store";
import { AdminApiError, listCustomNodes, readCustomNode } from "../../flow-file/admin-api-client";
import { validateCustomNodeDescriptor, CustomNodeDescriptorError } from "../../node-library/custom-node";

const emit = defineEmits<{
  add: [kind: NodeKind];
  addCustom: [type: string];
  customNodeLoaded: [type: string];
  customNodeLoadError: [message: string];
}>();

// Display order within each group is data, not a list here -- see
// palette.ts's KindStyle.priority (built-in kinds) / custom-node.ts's
// CustomNodeDescriptor.priority (custom nodes). Replaced the old
// hardcoded KINDS array + source-then-sink convention 2026-09-13
// (outstanding-items/palette-node-family-ordering.md) -- that convention
// split every multi-node protocol family (mqtt/udp/http) apart within
// "network"; groupedRows below now sorts each group's rows by priority
// directly, so a family's members just need adjacent priority numbers.

// Manual collapse (UI-cleanup brief, 2026-09-04) -- unlike
// PropertyPanel.vue's selection-driven collapse, nothing tells this panel
// when to reopen itself, so it's a plain user toggle. Not persisted across
// reloads (Mike's call, same discussion): starts open every session.
const collapsed = ref(false);

const filter = ref("");

// One row shape for both built-in and custom nodes, so groupedRows below
// can merge them into the same section headers instead of rendering two
// separate lists (the pre-grouping template had a hardcoded "nodes" /
// "custom nodes" split -- gone now that the whole point is grouping by
// palette.ts's/the descriptor's own `group`, not by origin).
interface PaletteRow {
  key: string;
  origin: "builtin" | "custom";
  /** NodeKind for a builtin row, the custom type id (e.g. "custom/dht22") for a custom row. */
  value: string;
  label: string;
  color: string;
  bgcolor: string;
  icon: string;
  group: string;
  priority: number;
}

const allRows = computed<PaletteRow[]>(() => {
  customNodesVersion.value; // reactive dependency -- see custom-nodes-store.ts's own header
  const needle = filter.value.trim().toLowerCase();

  const builtinRows: PaletteRow[] = (Object.keys(NODE_PALETTE) as NodeKind[])
    .filter((kind) => NODE_PALETTE[kind].label.toLowerCase().includes(needle))
    .map((kind) => {
      const style = NODE_PALETTE[kind];
      return {
        key: kind,
        origin: "builtin",
        value: kind,
        label: style.label,
        color: style.color,
        bgcolor: style.bgcolor,
        icon: style.icon,
        group: style.group,
        priority: style.priority,
      };
    });

  const customRows: PaletteRow[] = [...customNodePackages.value.values()]
    .map((pkg) => ({
      key: pkg.descriptor.type,
      origin: "custom" as const,
      value: pkg.descriptor.type,
      label: pkg.descriptor.label,
      color: pkg.descriptor.color ?? DEFAULT_KIND_STYLE.color,
      bgcolor: pkg.descriptor.bgcolor ?? DEFAULT_KIND_STYLE.bgcolor,
      icon: pkg.descriptor.icon ?? "◆",
      // A custom node with no declared group falls into "general" --
      // same fallback-at-the-consuming-end pattern color/bgcolor/icon
      // already use above, not baked into validateCustomNodeDescriptor
      // itself (custom-node.ts's own comment on this field).
      group: pkg.descriptor.group ?? DEFAULT_KIND_STYLE.group,
      // Same fallback pattern for order within that group -- an unset
      // priority sorts after every built-in entry (DEFAULT_KIND_STYLE's
      // own doc comment on this field).
      priority: pkg.descriptor.priority ?? DEFAULT_KIND_STYLE.priority,
    }))
    .filter((row) => row.label.toLowerCase().includes(needle));

  return [...builtinRows, ...customRows];
});

// Section order: the three defaults first (general/network/hardware,
// palette.ts's DEFAULT_NODE_GROUPS), even if a given session's rows don't
// happen to populate all three, then any other group name (a custom
// node's own, per the brief) appended in first-seen order. A group with
// zero matching rows (e.g. filtered out, or simply unused this session)
// is dropped rather than rendered as an empty header.
const groupedRows = computed(() => {
  const rows = allRows.value;
  const order: string[] = [...DEFAULT_NODE_GROUPS];
  for (const row of rows) {
    if (!order.includes(row.group)) order.push(row.group);
  }
  return order
    .map((name) => ({
      name,
      // Stable sort (Array.prototype.sort, ES2019+) -- rows sharing a
      // priority keep whatever order they were encountered in, rather
      // than an arbitrary sort-implementation-dependent shuffle.
      rows: rows.filter((row) => row.group === name).sort((a, b) => a.priority - b.priority),
    }))
    .filter((section) => section.rows.length > 0);
});

function onRowClick(row: PaletteRow): void {
  if (row.origin === "builtin") emit("add", row.value as NodeKind);
  else emit("addCustom", row.value);
}

// Native HTML5 drag-and-drop, not a Rete plugin -- see this file's header
// comment for why. `effectAllowed = "copy"` matches the gesture's actual
// meaning (dragging a palette row creates a new node, doesn't move
// anything out of the palette). Which MIME type carries the payload
// depends on origin -- a custom node's value is its own namespaced type
// id, not one of NodeKind's fixed literal union, so the drop handler
// (main.ts) needs a way to tell which table to resolve it against without
// guessing from its shape.
function onRowDragStart(event: DragEvent, row: PaletteRow): void {
  event.dataTransfer?.setData(row.origin === "builtin" ? DRAG_MIME : CUSTOM_DRAG_MIME, row.value);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

// null = picker closed; a (possibly empty) array = the backend's current
// /api/custom-nodes listing, shown as an expanding set of rows below the
// "Load custom node..." button rather than a native picker -- there's no
// OS-level equivalent for "choose one of these backend-known names" the
// way file-io.ts/custom-node-io.ts could lean on showOpenFilePicker.
const backendCustomNodeChoices = ref<string[] | null>(null);

async function onLoadCustomNode(): Promise<void> {
  if (backendCustomNodeChoices.value !== null) {
    // Second click while the list is already open -- treat it as
    // "cancel" rather than silently re-fetching underneath an open list.
    backendCustomNodeChoices.value = null;
    return;
  }
  try {
    const names = await listCustomNodes(backendWsUrl.value);
    if (names.length === 0) {
      emit("customNodeLoadError", "no custom nodes saved on the backend yet");
      return;
    }
    backendCustomNodeChoices.value = names;
  } catch (err) {
    emit("customNodeLoadError", err instanceof AdminApiError || err instanceof Error ? err.message : String(err));
  }
}

async function onPickBackendCustomNode(name: string): Promise<void> {
  backendCustomNodeChoices.value = null;
  try {
    const pkg = await readCustomNode(backendWsUrl.value, name);
    const rawDescriptor: unknown = JSON.parse(pkg.descriptor);
    const descriptor = validateCustomNodeDescriptor(rawDescriptor);
    loadOrReplaceCustomNodePackage(descriptor, pkg.implementation);
    emit("customNodeLoaded", descriptor.type);
  } catch (err) {
    const message =
      err instanceof AdminApiError || err instanceof CustomNodeDescriptorError
        ? err.message
        : err instanceof SyntaxError
          ? `custom node "${name}"'s descriptor is not valid JSON: ${err.message}`
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
  overflow-x: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  transition: width 0.15s ease, padding 0.15s ease;
}
/* Manual collapse (UI-cleanup brief, 2026-09-04) -- shrinks to a thin
   rail holding just the re-expand toggle, same "narrow strip stays
   visible" shape as PropertyPanel.vue's selection-driven collapse. */
.palette-sidebar.is-collapsed {
  width: 28px;
  padding: 10px 0;
}
.palette-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  padding: 0 2px;
}
.palette-sidebar.is-collapsed .palette-header {
  justify-content: center;
}
.palette-collapse-toggle {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
}
.palette-collapse-toggle:hover {
  color: #ddd;
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
