<!--
  editor/src/app/rete/PropertyPanel.vue

  Phase 3 item 13: real property panel, replacing app/nodes.ts's inline
  Litegraph widgets and main.ts's one-off `#code-modal` (the function
  node's only editing surface today). Ported from
  pocs/poc-rete/src/PropertyPanel.vue -- see that file's own header for why
  this pattern (an ordinary Vue component reading shared `selectedNode`
  state, no Rete API involved at all) generalizes to every node type for
  free, unlike a per-node-type modal hook.

  Trimmed from the poc-rete version in two ways, both because this app's
  real node set and scope differ from that spike's:
    - No `mqtt_publish` block -- that node type was never exposed on this
      canvas (nodes.ts's own header), even though node-library/
      mqtt-publish.ts exists for a later Tier.
    - No "inject now" button, and inject's repeat select doesn't call
      `setupTimer()` on change -- that was poc-rete's hook into its own
      hand-rolled live-propagation machinery (InjectNode.fire()/
      setupTimer()), which doesn't exist on the real InjectNode class
      (nodes.ts) and is explicitly out of scope for this migration
      (rete-migration-decision.md, "rete-engine / canvas-side live value
      propagation"). Editing `repeat` just updates `properties` and
      touches propertyVersion, same as every other field here.

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
  fields (pollMs/host/port/timeoutMs) plus a ConfigRefField bound to
  `wifiConfigId` -- the actual fix for "entering ssid credentials multiple
  times," everything upstream of this component (data model, compiler
  resolution, the store) exists to make this one property-panel change
  possible and correct. No raw ssid/password inputs anywhere in this file
  any more for these three kinds -- that's deliberate, not an oversight,
  see wifi-status.ts's own header on why.
-->
<template>
  <div class="property-panel">
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
        <label>repeat
          <select v-model="node.properties.repeat" @change="touch">
            <option value="manual">manual</option>
            <option value="1s">1s</option>
            <option value="5s">5s</option>
            <option value="30s">30s</option>
          </select>
        </label>
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
        <p class="hint">No config selected -- the interface still comes up, but nothing connects (matches today's "no ssid" behavior).</p>
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
        <ConfigRefField
          config-type="thingstudio/config/wifi"
          :model-value="node.properties.wifiConfigId || undefined"
          @update:model-value="(id) => setWifiConfigId(id)"
        />
      </template>

      <template v-else-if="node.kind === 'udp_receive'">
        <label>port
          <input type="number" min="1" max="65535" v-model.number="node.properties.port" @input="touch" />
        </label>
        <label>poll interval (ms)
          <input type="number" min="1" v-model.number="node.properties.pollMs" @input="touch" />
        </label>
        <ConfigRefField
          config-type="thingstudio/config/wifi"
          :model-value="node.properties.wifiConfigId || undefined"
          @update:model-value="(id) => setWifiConfigId(id)"
        />
      </template>

      <template v-else-if="node.kind === 'debug'">
        <p class="hint">No properties -- this node just prints the inbound payload to the device console.</p>
      </template>
    </template>
    <p v-else class="hint">Select a node to edit its properties.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { selectedNode, bumpPropertyVersion, propertyVersion } from "./store";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind } from "./palette";
import { InjectNode } from "./nodes";
import ConfigRefField from "./ConfigRefField.vue";

const node = computed(() => {
  propertyVersion.value; // establish reactive dependency even though mutations happen off-Vue
  return selectedNode.value;
});

const kindStyle = computed(() => (node.value ? (NODE_PALETTE[node.value.kind as NodeKind] ?? DEFAULT_KIND_STYLE) : DEFAULT_KIND_STYLE));

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
</script>

<style scoped>
.property-panel {
  padding: 12px;
  color: #ddd;
  font: 12px/1.4 system-ui, sans-serif;
  overflow-y: auto;
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
