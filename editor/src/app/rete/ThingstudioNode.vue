<!--
  editor/src/app/rete/ThingstudioNode.vue

  Real per-kind Vue node renderer, ported from
  pocs/poc-rete/src/ThingstudioNode.vue -- same Node-RED-shaped compact
  pill layout Mike steered toward there (icon chip, label, ports as small
  circles straddling the left/right edges, distributed vertically by port
  count), wired in via editor-setup.ts's `customize.node()`.

  Deliberately narrower than the poc-rete version: no `status`/`seed`
  live-value indicator line. That machinery existed there to surface
  poc-rete's hand-rolled propagate() (gpio_out's LED, mqtt_publish's last
  topic/value) -- this session doesn't wire propagation at all
  (editor-setup.ts's header: canvas-side live value propagation is out of
  scope, the real editor's live values are device-driven work per §6, not
  canvas-side). Restoring a status line is a main.ts-wiring-time decision,
  not a canvas-layer one, and can be added back onto this component without
  disturbing the layout below.

  Phase 3 item 12 addition: `data.highlighted` (nodes.ts) drives the
  compile/runtime-error-attribution red state, replacing app/nodes.ts's
  `node.color`/`node.bgcolor` mutation. Reads a plain field on the node
  instance, same as `data.kind`/`data.properties` -- main.ts mutates it and
  forces a re-render via `area.update("node", id)`, since Rete nodes aren't
  Vue-reactive (see nodes.ts's own comment on the field).
-->
<template>
  <div class="ts-node" :class="[`kind-${data.kind}`, { selected: data.selected, highlighted: data.highlighted }]" :style="nodeStyles">
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
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Ref } from "rete-vue-plugin";
import type { AnyThingstudioNode } from "./nodes";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind } from "./palette";

// `data` is the actual node instance (rete-vue-plugin hands the render
// context's `payload` straight through as this prop) so `.kind`/
// `.properties` are plain fields on it already, no lookup needed. Loosened
// past `AnyThingstudioNode` for `.selected`/`.inputs`/`.outputs`, which are
// set by rete-area-plugin/rete itself, not this app's own node classes.
const props = defineProps<{
  data: AnyThingstudioNode & { selected?: boolean; highlighted?: boolean };
  emit: (data: unknown) => unknown;
}>();

const palette = computed(() => NODE_PALETTE[props.data.kind as NodeKind] ?? DEFAULT_KIND_STYLE);
const icon = computed(() => palette.value.icon);

// app/nodes.ts's exact error-attribution colors (highlightNode()'s
// node.color/node.bgcolor) -- preserved verbatim so a highlighted node
// looks the same as it did on the Litegraph canvas.
const HIGHLIGHT_COLOR = "#e05555";
const HIGHLIGHT_BGCOLOR = "#5a1f1f";

const nodeStyles = computed(() => ({
  // Real layout budget, not a hint -- rete-vue-plugin's Node.vue sets these
  // as inline CSS off the same fields (poc-rete README's node-size gotcha),
  // and this component preserves that contract for nodes.ts's NODE_HEIGHT.
  width: Number.isFinite(props.data.width) ? `${props.data.width}px` : "",
  height: Number.isFinite(props.data.height) ? `${props.data.height}px` : "",
  // Selected state computed here rather than left to the scoped `.selected`
  // class alone -- an inline style always wins over a stylesheet rule for
  // the same CSS property regardless of class specificity. Highlighted
  // (error attribution) takes precedence over both selected and the
  // per-kind palette color -- matches app/nodes.ts, which unconditionally
  // overwrote node.color/bgcolor regardless of any other node state.
  outlineColor: props.data.highlighted ? HIGHLIGHT_COLOR : props.data.selected ? "#ff8f0e" : palette.value.color,
  background: props.data.highlighted ? HIGHLIGHT_BGCOLOR : palette.value.bgcolor,
}));

function sortByIndex(entries: [string, { index?: number }][]) {
  return [...entries].sort(([, a], [, b]) => (a?.index ?? 0) - (b?.index ?? 0));
}
const inputs = computed(() => sortByIndex(Object.entries(props.data.inputs)));
const outputs = computed(() => sortByIndex(Object.entries(props.data.outputs)));

// Must match ThingstudioSocket.vue's own `.ts-socket-dot` width/height --
// there's no shared import for it since it's read by rete-render-utils
// purely from the rendered DOM, not from this constant directly; this only
// needs to agree with the CSS value there.
const SOCKET_SIZE = 10;

// Distributes N ports evenly down the pill's vertical edge instead of
// hardcoding "always centered" -- none of these 5 node types currently has
// more than one input or one output, but the math doesn't assume that
// stays true.
//
// Computed as an absolute pixel `top`, deliberately NOT `top: 50%` plus a
// `transform: translateY(-50%)` centering trick -- poc-rete found hands-on
// that this was the actual cause of misaligned wires, not a socket-sizing
// bug: rete-render-utils computes wire endpoints from
// `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight` (the pre-transform
// CSS layout box), and a `transform` shifts where an element visually
// renders without moving its layout box at all -- see
// pocs/poc-rete/src/ThingstudioNode.vue's own comment for the fuller
// writeup of that finding.
function portStyle(index: number, count: number): { top: string } {
  const height = Number.isFinite(props.data.height) ? (props.data.height as number) : 34;
  const centerFraction = count <= 1 ? 0.5 : (index + 1) / (count + 1);
  return { top: `${centerFraction * height - SOCKET_SIZE / 2}px` };
}
</script>

<style scoped>
.ts-node {
  box-sizing: border-box;
  /* `outline`, not `border` -- deliberately. `.ts-node` is `position:
     relative`, making it the containing block for `.ts-port`'s absolute
     children; a `border` here would inset that origin by the border width,
     throwing off portStyle()'s pixel math by a couple of px -- found
     hands-on in poc-rete (see that file's own header for the debugging
     trail). `outline` doesn't participate in the box model at all, so it
     can't reintroduce this. */
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
  /* outline-color handled inline (nodeStyles) -- see that computed's
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
/* Pure positioning anchor -- no size/color of its own; the visible dot is
   ThingstudioSocket.vue, rendered inside this wrapper by VuePlugin.
   Deliberately no explicit width/height: with only `top` + one of
   `left`/`right` set, a `position: absolute` block shrinks to fit its
   child instead of stretching, so this anchor hugs the socket dot exactly. */
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
</style>
