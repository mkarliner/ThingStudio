<!--
  editor/src/app/rete/PropertyPanel.vue

  Phase 3 item 13: real property panel, replacing app/nodes.ts's inline
  Litegraph widgets and main.ts's one-off `#code-modal` (the function
  node's only editing surface today). Ported from
  pocs/poc-rete/src/PropertyPanel.vue -- see that file's own header for why
  this pattern (an ordinary Vue component reading shared `selectedNode`
  state, no Rete API involved at all) generalizes to every node type for
  free, unlike a per-node-type modal hook.

  Trimmed from the poc-rete version in one way, because this app's real
  node set and scope differ from that spike's (a former second trim --
  "no mqtt_publish block" -- is gone; see the mqtt_publish/mqtt_subscribe
  paragraph below):
    - No "inject now" button here, and no `repeat` field at all any more
      (Behavior change, 2026-09-02, node-library/inject.ts's own header):
      inject fires only on a real §13 TRIGGER sent by clicking the node
      itself on the canvas while live-connected (main.ts's nodepicked
      hook) -- there is no periodic option left to edit, and no separate
      manual-fire button either, since the node body IS the fire button
      now. poc-rete's own hand-rolled live-propagation machinery
      (InjectNode.fire()/setupTimer()) still doesn't exist on the real
      InjectNode class and is still out of scope for this migration
      (rete-migration-decision.md, "rete-engine / canvas-side live value
      propagation") -- a live click sends one real wire message, it
      doesn't run any canvas-side simulation of the flow.

  Updated for the §6 wire-type system (wire-type-system-scoping.md):
  unlike the note above, the payload-type select's `@change` NOW also
  calls `retypeOutput()` (nodes.ts) -- that method exists on the real
  InjectNode class as of this session, swapping the output socket to
  match the new payloadType. Not live-propagation machinery; a real,
  now-necessary part of the wire-type check.
  Added relative to poc-rete: a `timer` block (`intervalMs`) -- poc-rete
  had no timer node to port a panel section from; this is fresh work,
  unverified in a real browser until Mike's hands-on pass, same caveat
  nodes.ts's own TimerNode carries.

  wifi_status/udp_send/udp_receive blocks added config-node-and-palette-
  implementation-briefing.md (2026-08-18): each node's own remaining
  fields (pollMs/host/port/timeoutMs) plus, at the time, a ConfigRefField
  each bound to its own `wifiConfigId` -- the actual fix for "entering
  ssid credentials multiple times." No raw ssid/password inputs anywhere
  in this file for these three kinds, then or now -- deliberate, see
  wifi-status.ts's own header on why.

  mqtt_publish/mqtt_subscribe blocks added 2026-08-21: first-time canvas
  wiring for these two (nodes.ts's own header) plus the same config-node
  migration as above, at the time with two ConfigRefField instances each
  (a WiFi config and an MQTT broker config, independent references --
  mqtt-shared.ts's own header explains why: different credentials,
  different things being authenticated to). The broker config's own
  username/password fields are edited through ConfigRefField's existing
  generic edit panel (config-types.ts's `fields` descriptor) -- no bespoke
  UI needed for them.

  http_in/http_response blocks added 2026-09-08 (outstanding-items.md's
  "HTTP in / HTTP response nodes" P3 MVP item) -- given real canvas
  presence from the start, no registry-only interim period. http_in's own
  properties (port/path/method/responseTimeoutMs) plus the same
  "uses the flow's wifi_status node" hint http_request's own block gives;
  http_response has no properties at all, matching debug's own empty-block
  precedent -- everything it needs (statusCode/payload) comes off msg at
  runtime. Full v1 scope cuts (exact path match only, no :name params, no
  request body parsing) are http-server-shared.ts's own header, not
  repeated here.

  http_request block added 2026-09-05: first-time canvas wiring
  (nodes.ts's own header) -- url/method/timeoutMs, no ConfigRefField at
  all. Unlike every other network node type on this canvas, http_request
  never had its own wifiConfigId to remove (nodes.ts's header table) --
  it's always derived WiFi credentials from the flow's own wifi_status
  node via resolveFlowWifiCredentials(), so there's nothing here to
  migrate away from, just the same "add one if missing" hint every other
  network block already gives.

  **WiFi ConfigRefField removed from udp_send/udp_receive/mqtt_publish/
  mqtt_subscribe, 2026-09-04** (Mike's own real-hardware finding --
  wifi-status.ts's header has the full story): only wifi_status keeps its
  own WiFi ConfigRefField now. The other four network node kinds derive
  WiFi credentials from the flow's own wifi_status node instead of a
  config reference of their own, fixing a real bug where each node's
  independently-selectable WiFi config could silently disagree with
  wifi_status's. mqtt_publish/mqtt_subscribe keep their own
  `brokerConfigId` ConfigRefField unchanged -- the broker config was never
  part of the bug.

  **WiFi field back on every WiFi-using node, 2026-09-25** (Mike's call): the WiFi config is now a
  singleton (config-types.ts's `singleton`), so each node's own field shows and edits the flow's one
  instance -- no node holds its own id and nothing can disagree, which was the 2026-09-04 bug above.
  Only wifi_status still writes `wifiConfigId` (kept so older editors reading the file still work);
  the compiler ignores it and uses the instance (wifi-status.ts's resolveFlowWifiCredentials()).

  Presets (docs/working-notes/outstanding-items/presets-design.md,
  confirmed with Mike 2026-09-22) -- MVP item 4 / road-to-mvp.md's "spi
  setup should be saveable with a name to be selected later." One
  `PresetRefField` instance each on display_spi/display_i2c, the two node
  kinds Mike's own framing named explicitly ("nodes that are complex to set
  up, like display drivers"). Unlike ConfigRefField/CredentialRefField,
  this widget takes the whole `node.properties` object directly rather than
  a lookup-table key -- see PresetRefField.vue's own header for why a
  preset needs no separate field descriptor. `:key="node.id"` on each usage
  below is deliberate, not decoration: it remounts the widget when the
  selected node changes (even between two nodes of the same kind), so its
  own local "which preset is loaded" display doesn't carry over from a
  previously-selected node.

  display_spi's `colorOrder`/`invertColors`/`dataLatchOrder` fields added
  the same day, alongside the presets work above -- MVP item 5 named this
  gap explicitly ("colorOrder, invertColors, dataLatchOrder are missing
  today"), and a saved SPI preset is a lot less useful if three of the
  real properties it captures can't be seen or edited here. `palette`
  followed 2026-09-24 via PaletteField.vue (swatches per used entry).

  Custom nodes (docs/working-notes/custom-node-authoring-scoping.md,
  2026-08-20): one generic block below, driven entirely by
  CustomNode.descriptor.properties (custom-node.ts) instead of a
  hand-written block per type -- the whole point of a data-driven
  descriptor. Deliberately renders from a static schema only (text/
  number/boolean/select), never executes anything from the loaded
  package -- see custom-node.ts's own header on why (no Node-RED-style
  oneditprepare/oneditsave equivalent here, a deliberate divergence
  confirmed with Mike).
-->
<template>
  <div class="property-panel" :class="{ 'is-collapsed': !node }">
    <div class="panel-eyebrow">Properties</div>
    <template v-if="node">
      <h3>
        <span class="kind-dot" :style="{ background: kindStyle.color }" />
        {{ displayTitle }} <span class="node-id">#{{ node.id.slice(0, 6) }}</span>
      </h3>
      <!-- Every node can carry its own title for the canvas (a "label" property); blank shows the kind. -->
      <label>flow label (the title on the canvas) <input type="text" v-model="node.properties.label" :placeholder="node.label" @input="touch" /></label>

      <!-- Every node is descriptor-driven now (built-in or custom): the one generic branch renders its
           property schema. -->
      <template v-if="nodeDescriptor">
        <PresetRefField
          v-if="nodeDescriptor.presetType"
          :key="node.id"
          :preset-type="nodeDescriptor.presetType"
          :properties="nodeProperties"
          @applied="touch"
        />
        <p v-if="nodeDescriptor.description" class="hint">{{ nodeDescriptor.description }}</p>
        <template v-for="f in nodeDescriptor.properties ?? []" :key="f.name ?? f.label">
          <template v-if="!f.visibleWhen || evaluatePredicate(f.visibleWhen, nodeProperties)">
            <PinField
              v-if="f.kind === 'pin'"
              :label="f.label"
              :optional="f.optional"
              :model-value="nodeProperties[f.name!]"
              @update:model-value="(v) => setProp(f.name!, v)"
            />
            <PaletteField
              v-else-if="f.kind === 'palette'"
              :properties="nodeProperties"
              @changed="touch"
            />
            <ConfigRefField
              v-else-if="f.kind === 'configRef'"
              :config-type="f.configType!"
              :label="f.label"
              :model-value="(fieldValue(f) as string) || undefined"
              @update:model-value="(id) => setField(f, id)"
            />
            <CredentialRefField
              v-else-if="f.kind === 'credential'"
              :credential-type="f.credentialType!"
              :label="f.label"
              :model-value="(fieldValue(f) as string) || undefined"
              @update:model-value="(name) => setField(f, name)"
            />
            <label v-else-if="f.kind === 'boolean'" class="checkbox-label">
              <input type="checkbox" v-model="nodeProperties[f.name!]" @change="onFieldChange(f)" />
              {{ f.label }}
            </label>
            <label v-else>
              {{ f.label }}
              <select v-if="f.kind === 'select'" v-model="nodeProperties[f.name!]" @change="onFieldChange(f)">
                <option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
              <textarea v-else-if="f.kind === 'textarea'" :rows="f.rows ?? 4" :placeholder="fieldPlaceholder(f)" spellcheck="false" v-model="nodeProperties[f.name!]" @input="onFieldChange(f)"></textarea>
              <input v-else-if="f.kind === 'number'" type="number" :min="f.min" :max="f.max" :step="f.step" :placeholder="fieldPlaceholder(f)" v-model.number="nodeProperties[f.name!]" @input="onFieldChange(f)" />
              <input v-else-if="f.kind === 'password'" type="password" :placeholder="fieldPlaceholder(f)" v-model="nodeProperties[f.name!]" @input="onFieldChange(f)" />
              <input v-else type="text" :placeholder="fieldPlaceholder(f)" v-model="nodeProperties[f.name!]" @input="onFieldChange(f)" />
            </label>
            <p v-if="f.help" class="hint">{{ f.help }}</p>
          </template>
        </template>
        <ScreenOutline v-if="nodeDescriptor.screenOutline" :screen-id="node.id" />
        <p v-if="isCustomNode" class="hint">Custom node ({{ nodeDescriptor.type }}) -- loaded this session only; reload its package after a page refresh.</p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { selectedNode, bumpPropertyVersion, propertyVersion, setFunctionNodeOutputCount } from "./store";
import { DEFAULT_KIND_STYLE, type KindStyle } from "./palette";
import { paletteStyleFor } from "./node-descriptors";
import { CustomNode, type AnyThingstudioNode } from "./nodes";
import { evaluatePredicate, resolveConditionalText, type NodeDescriptor, type PropertyFieldDescriptor } from "../../compiler/node-descriptor";
import ConfigRefField from "./ConfigRefField.vue";
import CredentialRefField from "./CredentialRefField.vue";
import PresetRefField from "./PresetRefField.vue";
import PaletteField from "./PaletteField.vue";
import PinField from "./PinField.vue";
import ScreenOutline from "./ScreenOutline.vue";

const node = computed(() => {
  propertyVersion.value; // establish reactive dependency even though mutations happen off-Vue
  return selectedNode.value;
});

// Any node built from a canonical descriptor -- every migrated built-in (nodes.ts's
// buildDescriptorNodeClass) or a loaded CustomNode -- exposes a `descriptor`, and its property schema
// renders through the one generic branch in the template. Every node type is descriptor-driven now.
const nodeDescriptor = computed<NodeDescriptor | null>(
  () => (node.value as unknown as { descriptor?: NodeDescriptor } | null)?.descriptor ?? null,
);
const isCustomNode = computed(() => node.value instanceof CustomNode);

// A plain untyped view onto the selected node's properties, purely so the template above can use
// ordinary `nodeProperties[f.name]` v-model bindings without a TS cast inside the template
// expression -- this project has no vue-tsc in its toolchain (package.json), so .vue templates
// aren't type-checked today, and keeping template expressions simple/uncast is one less thing to
// get wrong in the SFC compiler regardless. Reads/writes the exact same object node.properties
// already is, just via a loosely-typed local name.
const nodeProperties = computed<Record<string, unknown>>(() => (node.value?.properties ?? {}) as Record<string, unknown>);

// The node's own title if it has one (the "label" field), else its kind.
const displayTitle = computed(() => {
  const l = node.value?.properties?.label;
  return typeof l === "string" && l.trim() ? l.trim() : node.value?.label ?? "";
});

const kindStyle = computed<KindStyle>(() => {
  if (!node.value) return DEFAULT_KIND_STYLE;
  const base = paletteStyleFor(node.value.kind as string);
  const d = nodeDescriptor.value;
  if (!d) return base;
  return {
    color: d.color ?? base.color,
    bgcolor: d.bgcolor ?? base.bgcolor,
    icon: d.icon ?? base.icon,
    label: d.label ?? base.label,
    group: d.group ?? base.group,
    priority: d.priority ?? base.priority,
  };
});

function touch(): void {
  bumpPropertyVersion();
}

/** Writes a pin (or any) property from a PinField/child component and refreshes the panel. */
function setProp(key: string, value: unknown): void {
  if (!node.value) return;
  (node.value.properties as Record<string, unknown>)[key] = value;
  touch();
}

/** A descriptor field's current value; undefined for an info-only field (one with no `name`). */
function fieldValue(f: PropertyFieldDescriptor): unknown {
  return f.name ? nodeProperties.value[f.name] : undefined;
}

/** Writes a descriptor field's value; an info-only field (no `name`) just refreshes the panel. */
function setField(f: PropertyFieldDescriptor, value: unknown): void {
  if (f.name) setProp(f.name, value);
  else touch();
}

/** A field's current placeholder: a `placeholderWhen` variant that matches the node's properties,
 * else the field's own static `placeholder`. */
function fieldPlaceholder(f: PropertyFieldDescriptor): string | undefined {
  return resolveConditionalText(f.placeholderWhen, f.placeholder, nodeProperties.value);
}

/** A generic-branch field changed (v-model already wrote it): resize dynamic outputs when the field
 * drives them, re-resolve port sockets when the field affects a port's type, then refresh the panel. */
function onFieldChange(f: PropertyFieldDescriptor): void {
  if (nodeDescriptor.value?.dynamicOutputs?.property === f.name) setDynamicOutputCount(Number(nodeProperties.value[f.name!]));
  if (f.retype) (node.value as unknown as { retypeOutputs?: () => void } | null)?.retypeOutputs?.();
  touch();
}

// Pin fields moved to the shared PinField.vue (a number input for a numeric target, a dropdown for a
// named-pin board like the STM32 pyboard), which reads activeTarget itself.

// Real port add/remove (not just a `properties` edit) -- routed through
// store.ts's setFunctionNodeOutputCount ref, filled in by
// editor-setup.ts's createThingstudioEditor(), which is where the live
// Rete editor/area instances actually live (this panel never imports
// them directly, same reasoning ConfigRefField.vue's own header gives for
// staying editor-instance-agnostic). A bare-NaN input (field cleared
// mid-edit) is ignored rather than resized to min -- less surprising than
// snapping the port count while someone's typing a two-digit number.
function setDynamicOutputCount(count: number): void {
  if (!node.value || !Number.isFinite(count)) return;
  void setFunctionNodeOutputCount.value?.(node.value as AnyThingstudioNode, count);
}
</script>

<style scoped>
.property-panel {
  flex: 0 0 auto;
  /* Widened 2026-09-14 (Mike's own ask) from 260px -- the panel already
     collapses to a thin rail when nothing's selected (see .is-collapsed
     below) rather than staying open at a fixed width all the time, so the
     usual "wider sidebar eats canvas space" tradeoff barely applies here;
     the credential-storage config/credential edit forms nested inside
     (ConfigRefField.vue/CredentialRefField.vue's own field-row layout)
     need the extra room more than the canvas needs those 80px back. */
  width: 340px;
  padding: 12px;
  color: #ddd;
  font: 12px/1.4 system-ui, sans-serif;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.15s ease, padding 0.15s ease;
}
/* Collapsed to a thin rail rather than fully disappearing (Mike's call,
   2026-09-04 UI-cleanup discussion) -- the eyebrow label rotates to fill
   it, so the panel's presence (and that clicking a node reopens it) stays
   visible even with nothing selected. */
.property-panel.is-collapsed {
  width: 28px;
  padding: 12px 0;
}
.property-panel.is-collapsed .panel-eyebrow {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  white-space: nowrap;
  margin: 0 auto;
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
.property-panel textarea {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.checkbox-label input[type="checkbox"] {
  display: inline-block;
  width: auto;
  margin-top: 0;
}
.hint {
  color: #888;
}
</style>
