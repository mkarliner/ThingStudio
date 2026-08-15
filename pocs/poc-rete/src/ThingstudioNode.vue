<!--
  Thingstudio poc-rete — custom node renderer, replacing the default
  `Presets.classic` Vue component (generic grey box for every node type,
  see editor-look-and-feel-briefing.md's "Why"). Wired in via
  `customize.node()` in editor-setup.ts, the official extension point
  (retejs.org/docs/guides/renderers/vue, "Customization") rather than
  fighting the shipped component's CSS from outside.

  Shape modeled directly on the real Node-RED editor (reference screenshot,
  2026-08-15 — Mike's steer, not the default classic Vue preset's stacked-
  row card): a compact single-row pill, colored per node kind, small icon
  chip on the left, ports as small circles straddling the left/right edges
  (distributed vertically along the edge when a node has more than one —
  none of these 5 types currently do, but the layout doesn't hardcode
  "centered," it divides the edge by port count so it generalizes), and a
  status line *below* the pill with a colored dot + text — Node-RED's own
  convention for a node reporting live state (the "connected" caption under
  "tele/tasmota_BE2F61/#" and "mqtt" in the reference screenshot). That
  status line is what carries gpio_out's/mqtt_publish's live-value
  indicators, restoring the canvas-level feedback poc-c had via
  `onDrawForeground` that this build lost when it dropped Litegraph's
  per-frame `onExecute` (README.md's "no dataflow engine included") — see
  editor-setup.ts's `propagate()`.

  Every node type gets the same declared height (nodes.ts's `NODE_HEIGHT`)
  now that ports lay out on the pill's edges instead of stacking as extra
  body rows — consistent node height, matching the reference screenshot,
  where every node pill is the same height regardless of port count.
-->
<template>
  <div class="ts-node" :class="[`kind-${data.kind}`, { selected: data.selected }]" :style="nodeStyles">
    <div class="ts-icon">{{ icon }}</div>
    <div class="ts-label" data-testid="title">{{ data.label }}</div>

    <Ref
      v-for="(entry, i) in inputs"
      :key="'input' + entry[0]"
      class="ts-port in"
      :style="portStyle(i, inputs.length)"
      :data="{ type: 'socket', side: 'input', key: entry[0], nodeId: data.id, payload: entry[1].socket }"
      :emit="emit"
      data-testid="input-socket"
    />
    <Ref
      v-for="(entry, i) in outputs"
      :key="'output' + entry[0]"
      class="ts-port out"
      :style="portStyle(i, outputs.length)"
      :data="{ type: 'socket', side: 'output', key: entry[0], nodeId: data.id, payload: entry[1].socket }"
      :emit="emit"
      data-testid="output-socket"
    />
  </div>

  <div v-if="status" class="ts-status" :style="statusPosition">
    <span class="ts-status-dot" :class="status.dotClass" />
    <span class="ts-status-text">{{ status.text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Ref } from "rete-vue-plugin";
import type { AnyThingstudioNode } from "./nodes";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind } from "./palette";

// `data` is the actual node instance (rete-vue-plugin hands the render
// context's `payload` straight through as this prop — confirmed in the
// installed bundle's `render()`, not assumed), so `.kind`/`.properties`/
// `.lastValue`/`.lastLabel` are all plain fields on it already, no lookup
// needed. Loosened past `AnyThingstudioNode` for `.selected`/`.inputs`/
// `.outputs`, which are set by rete-area-plugin/rete itself, not this
// app's own node classes.
const props = defineProps<{
  data: AnyThingstudioNode & { selected?: boolean };
  emit: (data: unknown) => unknown;
}>();

// Shared with App.vue's toolbar buttons — see palette.ts's own header for
// why this lives in one file instead of being redefined per consumer.
const palette = computed(() => NODE_PALETTE[props.data.kind as NodeKind] ?? DEFAULT_KIND_STYLE);
const icon = computed(() => palette.value.icon);

const nodeStyles = computed(() => ({
  // Real layout budget, not a hint — rete-vue-plugin's Node.vue sets these
  // as inline CSS off the same fields (README.md's node-size gotcha), and
  // this component preserves that contract for nodes.ts's NODE_HEIGHT.
  width: Number.isFinite(props.data.width) ? `${props.data.width}px` : "",
  height: Number.isFinite(props.data.height) ? `${props.data.height}px` : "",
  borderColor: palette.value.color,
  background: palette.value.bgcolor,
}));

function sortByIndex(entries: [string, { index?: number }][]) {
  return [...entries].sort(([, a], [, b]) => (a?.index ?? 0) - (b?.index ?? 0));
}
const inputs = computed(() => sortByIndex(Object.entries(props.data.inputs)));
const outputs = computed(() => sortByIndex(Object.entries(props.data.outputs)));

// Distributes N ports evenly down the pill's vertical edge instead of
// hardcoding "always centered" — matches real Node-RED's layout for
// multi-port nodes (e.g. a switch node's several outputs stacked down the
// right edge). None of this spike's 5 node types currently has more than
// one input or one output (a single port just lands at 50%, the same place
// a hardcoded center would), but the math doesn't assume that stays true.
function portStyle(index: number, count: number): { top: string } {
  const pct = count <= 1 ? 50 : ((index + 1) / (count + 1)) * 100;
  return { top: `${pct}%` };
}

type Status = { text: string; dotClass: string } | null;

const status = computed<Status>(() => {
  const d = props.data;
  if (d.kind === "gpio_out") {
    if (d.lastValue === undefined) return null;
    return { text: `pin ${d.properties.pin}: ${d.lastValue ? "on" : "off"}`, dotClass: d.lastValue ? "on" : "off" };
  }
  if (d.kind === "mqtt_publish") {
    if (!d.lastLabel) return null;
    return { text: d.lastLabel, dotClass: "on" };
  }
  return null;
});

// Status line renders as a sibling of `.ts-node` (Vue 3 multi-root
// component, confirmed supported by how VuePlugin mounts — plain
// `createApp(component).mount(element)`, checked in the installed bundle
// — not a single-root `app.mount` assumption) rather than a child, so it
// can sit *below* the pill without growing the pill's own declared height
// (nodes.ts's NODE_HEIGHT). Both `.ts-node` and this sibling land as
// direct children of rete-area-plugin's own per-node positioning wrapper
// (a bare `position: absolute` div with the pan/zoom translate on it, no
// fixed size, no overflow clipping — checked in that bundle too), so
// `top`/`left` here are relative to that same shared origin. Computed as a
// plain inline style (px numbers) rather than a `v-bind()`-in-CSS custom
// property, since there's no browser available in this environment to
// confirm that mechanism behaves the same way across a multi-root SFC —
// see editor-look-and-feel-briefing.md's "real costs" section on that
// constraint. Real-browser confirmation this actually sits where intended
// is still Mike's call, same as every other visual judgment in this spike.
const statusPosition = computed(() => ({
  top: `${(Number.isFinite(props.data.height) ? props.data.height : 34) + 3}px`,
  left: "0",
  width: Number.isFinite(props.data.width) ? `${props.data.width}px` : "",
}));
</script>

<style scoped>
.ts-node {
  box-sizing: border-box;
  border: 1.5px solid #555;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  user-select: none;
  display: flex;
  align-items: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: visible;
}
.ts-node:hover {
  filter: brightness(1.15);
}
.ts-node.selected {
  border-color: #ff8f0e;
  box-shadow: 0 0 0 1px #ff8f0e, 0 0 6px rgba(255, 143, 14, 0.6);
}
.ts-icon {
  flex: 0 0 auto;
  width: 22px;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 4px 0 0 4px;
  color: #fff;
  font-size: 12px;
  line-height: 1;
}
.ts-label {
  flex: 1 1 auto;
  padding: 0 8px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
:deep(.ts-port) {
  position: absolute;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 6px;
  border: 1px solid #fff;
  background: #96b38a;
  box-sizing: border-box;
  cursor: pointer;
  z-index: 2;
}
:deep(.ts-port:hover) {
  border-width: 2px;
}
:deep(.ts-port.in) {
  left: -5px;
}
:deep(.ts-port.out) {
  right: -5px;
}
.ts-status {
  /* top/left/width set inline via `statusPosition` (script setup) — see
     that computed's comment for why this is a plain inline style rather
     than a scoped-CSS v-bind(). */
  position: absolute;
  display: flex;
  align-items: center;
  gap: 4px;
  font: 10px ui-monospace, monospace;
  color: #bbb;
  white-space: nowrap;
  pointer-events: none;
}
.ts-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 5px;
  background: #666;
  flex: 0 0 auto;
}
.ts-status-dot.on {
  background: #57ff57;
}
.ts-status-dot.off {
  background: #666;
}
.ts-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
</style>
