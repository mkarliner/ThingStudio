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
  // Injected automatically by rete-vue-plugin's own render wrapper (a
  // fresh `Math.random()` on every render — confirmed in the installed
  // bundle) — not used for display, only read (in `status` below) to give
  // Vue's reactivity something that actually changes to depend on. See
  // that computed's own comment for why this is necessary at all.
  seed?: number;
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
  // Selected state computed here rather than left to the scoped `.selected`
  // class alone — an inline style always wins over a stylesheet rule for
  // the same CSS property regardless of class specificity, so a class-only
  // `.ts-node.selected { outline-color: ... }` would never actually show
  // through this element's own inline `outline-color`. (`box-shadow` below
  // stays in the stylesheet since nothing inline sets it.)
  outlineColor: props.data.selected ? "#ff8f0e" : palette.value.color,
  background: palette.value.bgcolor,
}));

function sortByIndex(entries: [string, { index?: number }][]) {
  return [...entries].sort(([, a], [, b]) => (a?.index ?? 0) - (b?.index ?? 0));
}
const inputs = computed(() => sortByIndex(Object.entries(props.data.inputs)));
const outputs = computed(() => sortByIndex(Object.entries(props.data.outputs)));

// Must match ThingstudioSocket.vue's own `.ts-socket-dot` width/height —
// there's no shared import for it since it's read by rete-render-utils
// purely from the rendered DOM (`offsetWidth`/`offsetHeight`, see below),
// not from this constant directly; this only needs to agree with the CSS
// value there, which the comment on that file's style block also notes.
const SOCKET_SIZE = 10;

// Distributes N ports evenly down the pill's vertical edge instead of
// hardcoding "always centered" — matches real Node-RED's layout for
// multi-port nodes (e.g. a switch node's several outputs stacked down the
// right edge). None of this spike's 5 node types currently has more than
// one input or one output (a single port just lands at center, the same
// place a hardcoded 50% would), but the math doesn't assume that stays
// true.
//
// Computed as an absolute pixel `top`, deliberately NOT `top: 50%` plus a
// `transform: translateY(-50%)` centering trick — found hands-on (Mike's
// screenshot, 2026-08-15) that this was the actual cause of misaligned
// wires, not the socket-sizing bug the previous fix addressed. Root cause,
// confirmed by reading rete-render-utils' own source (getElementCenter in
// rete-render-utils.esm.js): wire endpoints are computed from
// `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight`, walking up the
// `offsetParent` chain — the *pre-transform* CSS layout box. A `transform`
// shifts where an element visually renders without moving its layout box
// at all, so the dot rendered exactly where `translateY(-50%)` put it
// on-screen, but the wire endpoint math measured the box's un-transformed
// position instead — consistently off by roughly half the anchor's height.
// (The pan/zoom transform on the canvas's own content layer *doesn't* hit
// this problem: `nodeView.position.x/y`, added separately in
// rete-render-utils' `listen()`, is plain tracked state, not measured from
// CSS, and every node's socket offsets are computed relative to that same
// transformed ancestor consistently — it's an extra *local* transform like
// this one, with nothing else compensating for it, that breaks.)
function portStyle(index: number, count: number): { top: string } {
  const height = Number.isFinite(props.data.height) ? (props.data.height as number) : 34;
  const centerFraction = count <= 1 ? 0.5 : (index + 1) / (count + 1);
  return { top: `${centerFraction * height - SOCKET_SIZE / 2}px` };
}

type Status = { text: string; dotClass: string } | null;

const status = computed<Status>(() => {
  // Real reactive dependency, not a no-op read — `data` is `markRaw`'d by
  // rete-vue-plugin (confirmed in its installed bundle's `create()`), so
  // mutating `lastValue`/`lastLabel` in place on that same object
  // reference, as editor-setup.ts's `propagate()` does, never triggers
  // Vue's reactivity on its own: `data` itself never changes reference, so
  // nothing here would otherwise re-run. `seed` is a fresh random number
  // the plugin injects on every `area.update()`-driven re-render
  // specifically to give consumers something to depend on for exactly
  // this — same pattern PropertyPanel.vue already uses via store.ts's
  // `propertyVersion` for the same off-Vue-mutation problem. Found hands-
  // on via the Chrome extension (2026-08-15): the status line never
  // appeared without this, despite `propagate()` correctly setting the
  // field and calling `area.update()`.
  void props.seed;
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
  /* `outline`, not `border` — deliberately. `.ts-node` is `position:
     relative`, making it the containing block for `.ts-port`'s absolute
     children; per spec, an absolutely positioned descendant's `top`/`left`
     resolve against the containing block's *padding* edge, not its border's
     outer edge. A `border` here would inset that origin by the border
     width, throwing off portStyle()'s pixel math by a couple of px — found
     hands-on (Mike's screenshot, 2026-08-15: "nearly, not quite" after the
     transform-vs-offsetTop fix already landed). `outline` doesn't
     participate in the box model at all (no containing-block/layout effect,
     just painted on top), so it can't reintroduce this — `outline-offset`
     pulls it inward so it still reads as a pill border rather than a ring
     floating outside the rounded corners. */
  outline: 1.5px solid #555;
  outline-offset: -1.5px;
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
  /* outline-color handled inline (nodeStyles) — see that computed's
     comment for why a stylesheet rule alone wouldn't win here. */
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
/* Pure positioning anchor — no size/color of its own. This is the `Ref`
   wrapper `Ref.vue` mounts (see that component's own header); the actual
   visible dot is ThingstudioSocket.vue, rendered *inside* this wrapper by
   VuePlugin once `Ref` emits its `render` signal, sized on its own terms.
   Deliberately no explicit width/height here: with only `top` + one of
   `left`/`right` set (never both), a `position: absolute` block shrinks to
   fit its child instead of stretching, so this anchor hugs the socket dot
   exactly rather than needing to duplicate its size. Learned the hard way —
   see editor-setup.ts's customize.socket comment for what this replaced.

   No `transform` here, deliberately — `top` is already a pre-computed
   pixel value from `portStyle()` accounting for the anchor's own height,
   not a `top: 50%` + `translateY(-50%)` centering trick. See that
   function's comment for why a transform-based approach breaks wire
   endpoints specifically (rete-render-utils measures pre-transform layout
   position, not the transformed visual position). */
:deep(.ts-port) {
  position: absolute;
  z-index: 2;
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
