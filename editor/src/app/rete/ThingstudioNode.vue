<!--
  editor/src/app/rete/ThingstudioNode.vue

  Real per-kind Vue node renderer, ported from
  pocs/poc-rete/src/ThingstudioNode.vue -- same Node-RED-shaped compact
  pill layout Mike steered toward there (icon chip, label, ports as small
  circles straddling the left/right edges, distributed vertically by port
  count), wired in via editor-setup.ts's `customize.node()`.

  `status`/`statusText` line restored 2026-09-10 (connection-status-
  indicator feature, outstanding-items/node-status-indicators.md), ported
  from poc-rete's own status-line concept (that file's header has the
  original design writeup: dot + text, positioned as a sibling below the
  pill so it doesn't grow nodes.ts's fixed NODE_HEIGHT). Different data
  source than poc-rete's version, though: that spike's status line read
  `lastValue`/`lastLabel`, mutated by its own hand-rolled canvas-side
  propagate() (out of scope here, editor-setup.ts's header); this one
  reads `data.status`/`data.statusText` (nodes.ts), mutated by main.ts
  only in response to a real device-pushed §13 NODE_STATUS message --
  device-driven, not canvas-side, per §6.

  CORRECTION (2026-09-10, found hands-on via Mike's own devtools): this
  DOES need the `seed` prop after all -- the claim just above (that
  `highlighted`'s existing mechanism made it unnecessary) was wrong.
  `data` is `markRaw`'d by rete-vue-plugin (see poc-rete's own header),
  so mutating `data.status` in place gives Vue's `statusLine` computed no
  tracked dependency to invalidate on -- `area.update("node", id)` does
  make rete-vue-plugin pass a fresh `seed` prop on every call (confirmed:
  Vue warned about it arriving as an unconsumed extraneous attribute), but
  that only forces this component to re-render if `seed` is a real,
  declared, read prop. Fixed by declaring `seed?: number` below and
  reading it inside `statusLine`'s computed, exactly matching poc-rete's
  own proven pattern -- see that file's header for the fuller writeup of
  why. Left as an open question whether `nodeStyles`/`highlighted` above
  has this same latent bug; it wasn't touched here since there's no
  evidence yet that it's broken, but it's worth a hardware check.

  Phase 3 item 12 addition: `data.highlighted` (nodes.ts) drives the
  compile/runtime-error-attribution red state, replacing app/nodes.ts's
  `node.color`/`node.bgcolor` mutation. Reads a plain field on the node
  instance, same as `data.kind`/`data.properties` -- main.ts mutates it and
  forces a re-render via `area.update("node", id)`, since Rete nodes aren't
  Vue-reactive (see nodes.ts's own comment on the field).

  Custom nodes (docs/working-notes/custom-node-authoring-scoping.md,
  2026-08-20): `palette` below special-cases a CustomNode instance to read
  its own descriptor's color/bgcolor/icon instead of looking `data.kind`
  ("custom", for every loaded custom type) up in NODE_PALETTE, which would
  otherwise fall through to DEFAULT_KIND_STYLE for all of them
  indistinguishably. `data.label` needs no equivalent fix -- Rete's own
  `ClassicPreset.Node` label is already set from the descriptor in
  CustomNode's constructor (nodes.ts).
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

  <div v-if="statusLine" class="ts-status" :style="statusPosition">
    <span class="ts-status-dot" :class="statusLine.dotClass" />
    <span class="ts-status-text">{{ statusLine.text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Ref } from "rete-vue-plugin";
import { CustomNode, type AnyThingstudioNode } from "./nodes";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind, type KindStyle } from "./palette";
import type { NodeStatusState } from "../../protocol/messages";

// `data` is the actual node instance (rete-vue-plugin hands the render
// context's `payload` straight through as this prop) so `.kind`/
// `.properties` are plain fields on it already, no lookup needed. Loosened
// past `AnyThingstudioNode` for `.selected`/`.inputs`/`.outputs`, which are
// set by rete-area-plugin/rete itself, not this app's own node classes.
const props = defineProps<{
  data: AnyThingstudioNode & { selected?: boolean; highlighted?: boolean };
  emit: (data: unknown) => unknown;
  // Fresh random number rete-vue-plugin injects on every
  // `area.update("node", id)`-driven re-render (see header comment's
  // 2026-09-10 correction, and poc-rete's own original version) --
  // declared so it's a real, tracked prop `statusLine` can depend on,
  // not so its value itself means anything.
  seed?: number;
}>();

const palette = computed<KindStyle>(() => {
  if (props.data instanceof CustomNode) {
    const d = props.data.descriptor;
    return { color: d.color ?? DEFAULT_KIND_STYLE.color, bgcolor: d.bgcolor ?? DEFAULT_KIND_STYLE.bgcolor, icon: d.icon ?? "◆", label: d.label };
  }
  return NODE_PALETTE[props.data.kind as NodeKind] ?? DEFAULT_KIND_STYLE;
});
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

// Node-RED's own dot-color convention (green/connecting-amber/grey/red
// for connected/connecting/disconnected/error) -- matches the reference
// screenshot poc-rete's own header cites, not invented fresh here.
const STATUS_DOT_CLASS: Record<NodeStatusState, string> = {
  connected: "connected",
  connecting: "connecting",
  disconnected: "disconnected",
  error: "error",
};

type StatusLine = { text: string; dotClass: string } | null;

const statusLine = computed<StatusLine>(() => {
  // Real reactive dependency, not a no-op read -- `data` is `markRaw`'d,
  // so `props.data.status` below has nothing for Vue to track; `seed` is
  // the only genuinely-reactive prop this component gets on every
  // `area.update()`-driven re-render, so reading it here is what makes
  // this computed re-evaluate at all. See header comment's 2026-09-10
  // correction.
  void props.seed;
  const state = props.data.status;
  if (state === null || state === undefined) return null; // "never heard from" -- see nodes.ts's own comment on the field's null default
  return { text: props.data.statusText ?? state, dotClass: STATUS_DOT_CLASS[state] };
});

// Same positioning approach as poc-rete's own version (that file's
// header has the full offsetTop/transform writeup for why this is a
// sibling of `.ts-node`, not a child, and why `top`/`left` are computed
// as plain px numbers rather than a scoped-CSS v-bind()): renders below
// the pill without growing its declared NODE_HEIGHT.
const statusPosition = computed(() => ({
  top: `${(Number.isFinite(props.data.height) ? props.data.height : 34) + 3}px`,
  left: "0",
  width: Number.isFinite(props.data.width) ? `${props.data.width}px` : "",
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
.ts-status {
  /* top/left/width set inline via `statusPosition` (script setup) --
     same reasoning as poc-rete's own version's comment on this: a plain
     inline style rather than a scoped-CSS v-bind(). */
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
.ts-status-dot.connected {
  background: #57ff57;
}
.ts-status-dot.connecting {
  background: #e0c040;
}
.ts-status-dot.disconnected {
  background: #666;
}
.ts-status-dot.error {
  background: #e05555;
}
.ts-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
</style>
