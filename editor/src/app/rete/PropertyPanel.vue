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
        {{ node.label }} <span class="node-id">#{{ node.id.slice(0, 6) }}</span>
      </h3>

      <template v-if="node.kind === 'inject'">
        <label>payload type
          <select v-model="node.properties.payloadType" @change="retypeInjectOutput">
            <option value="bool">bool</option>
            <option value="number">number</option>
            <option value="string">string</option>
          </select>
        </label>
        <label>value
          <input v-model="node.properties.payloadValue" @input="touch" />
        </label>
        <p class="hint">Click this node on the canvas while connected to fire it once.</p>
      </template>

      <template v-else-if="node.kind === 'function'">
        <label class="code-label">
          code
          <textarea v-model="node.properties.code" @input="touch" rows="10" spellcheck="false"></textarea>
        </label>
      </template>

      <template v-else-if="node.kind === 'gpio_out'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'timer'">
        <label>interval (ms)
          <input type="number" min="1" v-model.number="node.properties.intervalMs" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'interrupt'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
        <label>edge
          <select v-model="node.properties.edge" @change="touch">
            <option value="rising">rising</option>
            <option value="falling">falling</option>
            <option value="both">both</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="node.properties.debounce" @change="touch" />
          debounce
        </label>
        <label v-if="node.properties.debounce">debounce (ms)
          <input type="number" min="1" v-model.number="node.properties.debounceMs" @input="touch" />
        </label>
        <p class="hint">
          Event-driven (machine.Pin.irq()), not polled. No internal pull configured -- wire an external pull
          resistor (or a button module with one built in), see test-flows/README.md.
        </p>
      </template>

      <template v-else-if="node.kind === 'wifi_status'">
        <label>poll interval (ms)
          <input type="number" min="1" v-model.number="node.properties.pollMs" @input="touch" />
        </label>
        <ConfigRefField
          config-type="thingstudio/config/wifi"
          :model-value="node.properties.wifiConfigId || undefined"
          @update:model-value="(id) => setWifiConfigId(id)"
        />
        <p class="hint">Required -- won't compile without one. Pick "unmanaged" on the config if this flow intentionally rides on a connection managed outside it (e.g. a captive-portal-provisioned device).</p>
      </template>

      <template v-else-if="node.kind === 'udp_send'">
        <label>host
          <input v-model="node.properties.host" @input="touch" />
        </label>
        <label>port
          <input type="number" min="1" max="65535" v-model.number="node.properties.port" @input="touch" />
        </label>
        <label>timeout (ms)
          <input type="number" min="1" v-model.number="node.properties.timeoutMs" @input="touch" />
        </label>
        <p class="hint">Uses the flow's own wifi_status node for WiFi credentials -- add one if the flow doesn't have one yet.</p>
      </template>

      <template v-else-if="node.kind === 'udp_receive'">
        <label>port
          <input type="number" min="1" max="65535" v-model.number="node.properties.port" @input="touch" />
        </label>
        <label>poll interval (ms)
          <input type="number" min="1" v-model.number="node.properties.pollMs" @input="touch" />
        </label>
        <p class="hint">Uses the flow's own wifi_status node for WiFi credentials -- add one if the flow doesn't have one yet.</p>
      </template>

      <template v-else-if="node.kind === 'http_request'">
        <label>url
          <input v-model="node.properties.url" @input="touch" placeholder="http://host:port/path" />
        </label>
        <label>method
          <select v-model="node.properties.method" @change="touch">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>
        <label>timeout (ms)
          <input type="number" min="1" v-model.number="node.properties.timeoutMs" @input="touch" />
        </label>
        <p class="hint">http:// only -- no TLS/HTTPS in v1. Uses the flow's own wifi_status node for WiFi credentials -- add one if the flow doesn't have one yet.</p>
      </template>

      <template v-else-if="node.kind === 'mqtt_publish'">
        <label>topic
          <input v-model="node.properties.topic" @input="touch" />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="node.properties.retain" @change="touch" />
          retain
        </label>
        <label>qos
          <select v-model.number="node.properties.qos" @change="touch">
            <option :value="0">0</option>
            <option :value="1">1</option>
          </select>
        </label>
        <ConfigRefField
          config-type="thingstudio/config/mqtt-broker"
          :model-value="node.properties.brokerConfigId || undefined"
          @update:model-value="(id) => setBrokerConfigId(id)"
        />
        <p class="hint">Broker config required -- won't compile without one. Uses the flow's own wifi_status node for WiFi credentials (add one if the flow doesn't have one yet); mqtt_as manages its own WiFi connection, so an "unmanaged" wifi_status config isn't accepted here.</p>
      </template>

      <template v-else-if="node.kind === 'mqtt_subscribe'">
        <label>topic
          <input v-model="node.properties.topic" @input="touch" />
        </label>
        <label>qos
          <select v-model.number="node.properties.qos" @change="touch">
            <option :value="0">0</option>
            <option :value="1">1</option>
          </select>
        </label>
        <ConfigRefField
          config-type="thingstudio/config/mqtt-broker"
          :model-value="node.properties.brokerConfigId || undefined"
          @update:model-value="(id) => setBrokerConfigId(id)"
        />
        <p class="hint">Broker config required -- won't compile without one. Uses the flow's own wifi_status node for WiFi credentials (add one if the flow doesn't have one yet); mqtt_as manages its own WiFi connection, so an "unmanaged" wifi_status config isn't accepted here.</p>
      </template>

      <template v-else-if="node.kind === 'debug'">
        <p class="hint">No properties -- this node just prints the inbound payload to the device console.</p>
      </template>

      <template v-else-if="node.kind === 'custom' && customDescriptor">
        <template v-for="f in customDescriptor.properties ?? []" :key="f.name">
          <label v-if="f.kind === 'boolean'" class="checkbox-label">
            <input type="checkbox" v-model="customProperties[f.name]" @change="touch" />
            {{ f.label }}
          </label>
          <label v-else>
            {{ f.label }}
            <select v-if="f.kind === 'select'" v-model="customProperties[f.name]" @change="touch">
              <option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <input v-else-if="f.kind === 'number'" type="number" v-model.number="customProperties[f.name]" @input="touch" />
            <input v-else type="text" v-model="customProperties[f.name]" @input="touch" />
          </label>
        </template>
        <p class="hint">Custom node ({{ customDescriptor.type }}) -- loaded this session only; reload its package after a page refresh.</p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { selectedNode, bumpPropertyVersion, propertyVersion } from "./store";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind, type KindStyle } from "./palette";
import { InjectNode, CustomNode } from "./nodes";
import ConfigRefField from "./ConfigRefField.vue";

const node = computed(() => {
  propertyVersion.value; // establish reactive dependency even though mutations happen off-Vue
  return selectedNode.value;
});

const customDescriptor = computed(() => (node.value instanceof CustomNode ? node.value.descriptor : null));

// A plain untyped view onto the selected custom node's properties, purely
// so the template above can use ordinary `customProperties[f.name]`
// v-model bindings without a TS cast inside the template expression --
// this project has no vue-tsc in its toolchain (package.json), so .vue
// templates aren't type-checked today, and keeping template expressions
// simple/uncast is one less thing to get wrong in the SFC compiler
// regardless. Reads/writes the exact same object node.properties already
// is, just via a loosely-typed local name.
const customProperties = computed<Record<string, unknown>>(() => (node.value?.properties ?? {}) as Record<string, unknown>);

const kindStyle = computed<KindStyle>(() => {
  if (!node.value) return DEFAULT_KIND_STYLE;
  if (node.value instanceof CustomNode) {
    const d = node.value.descriptor;
    return { color: d.color ?? DEFAULT_KIND_STYLE.color, bgcolor: d.bgcolor ?? DEFAULT_KIND_STYLE.bgcolor, icon: d.icon ?? "◆", label: d.label };
  }
  return NODE_PALETTE[node.value.kind as NodeKind] ?? DEFAULT_KIND_STYLE;
});

function touch(): void {
  bumpPropertyVersion();
}

// payloadType's own @change handler (template above) -- v-model has
// already written the new value into node.properties.payloadType by the
// time this fires, so retypeOutput() (nodes.ts) picks it up correctly.
// Real socket-instance swap, not just a `properties` edit, so it needs its
// own handler rather than reusing plain `touch()` the way every other
// field on this panel does. Deliberately does NOT try to force a visual
// repaint of the socket dot (tried, then removed -- ThingstudioSocket.vue's
// own header explains why, and what it would have taken to make that
// visible): nothing on this canvas currently displays a socket's type
// except the property panel itself, which `touch()` already refreshes.
function retypeInjectOutput(): void {
  if (node.value instanceof InjectNode) {
    node.value.retypeOutput();
  }
  touch();
}

// ConfigRefField's own `update:modelValue` hands back a fresh/selected
// config id -- written onto whichever field the current node kind uses
// (every wifi-referencing kind on this canvas uses the same
// `wifiConfigId` property name, wifi-status.ts's own convention), same
// `touch()` signal as every other field edit.
function setWifiConfigId(id: string): void {
  if (!node.value) return;
  (node.value.properties as Record<string, unknown>).wifiConfigId = id;
  touch();
}

// Same pattern as setWifiConfigId() above, for mqtt_publish/mqtt_subscribe's
// second, independent config reference -- kept as its own small function
// rather than generalizing both into one `setConfigId(key, id)` helper, so
// this change doesn't touch the already-working wifi_status/udp_send/
// udp_receive bindings for symmetry alone (CLAUDE.md's cheapest-correct-
// change principle).
function setBrokerConfigId(id: string): void {
  if (!node.value) return;
  (node.value.properties as Record<string, unknown>).brokerConfigId = id;
  touch();
}
</script>

<style scoped>
.property-panel {
  flex: 0 0 auto;
  width: 260px;
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
.code-label textarea {
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
