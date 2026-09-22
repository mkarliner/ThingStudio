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
  remains the one display_spi property with no form field (a 16-entry
  RGB565 color picker is a separate, larger UI piece, out of scope here) --
  a saved preset still captures whatever palette a node has via the raw
  properties snapshot (PresetRefField.vue's own header), it just can't be
  edited from this panel afterward.

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
        <label>outputs
          <input
            type="number"
            :min="1"
            :max="maxFunctionOutputs"
            :value="node.properties.outputCount"
            @change="setFunctionOutputCount(($event.target as HTMLInputElement).valueAsNumber)"
          />
        </label>
        <p class="hint">Return an array to route to multiple outputs, Node-RED style: e.g. <code>return [msg, null]</code> sends to output 1 only. A plain <code>return msg</code> still works and always targets output 1.</p>
      </template>

      <template v-else-if="node.kind === 'gpio_out'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'pwm_out'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
        <label>frequency (Hz)
          <input type="number" min="1" v-model.number="node.properties.freq" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'timer'">
        <label>interval (ms)
          <input type="number" min="1" v-model.number="node.properties.intervalMs" @input="touch" />
        </label>
      </template>

      <template v-else-if="node.kind === 'delay'">
        <label>delay (ms)
          <input type="number" min="1" v-model.number="node.properties.delayMs" @input="touch" />
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

      <template v-else-if="node.kind === 'eswitch'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
        <label>pull
          <select v-model="node.properties.pull" @change="touch">
            <option value="none">none -- external pull or self-pulling switch (default)</option>
            <option value="up">up -- enable the pin's internal pull-up</option>
            <option value="down">down -- enable the pin's internal pull-down</option>
          </select>
        </label>
        <label>open level (lopen)
          <select v-model.number="node.properties.lopen" @change="touch">
            <option :value="1">1 -- switch to gnd, pulled up (default)</option>
            <option :value="0">0 -- switch to 3V3, pulled down</option>
          </select>
        </label>
        <label>debounce (ms)
          <input type="number" min="1" v-model.number="node.properties.debounceMs" @input="touch" />
        </label>
        <p class="hint">
          Debounced (polling, not IRQ-driven -- see device-runtime/src/vendor/primitives_events/README.md). One
          output: msg.topic is "close" or "open", msg.payload is the same state as a bool. No internal pull
          enabled by default -- wire an external pull resistor, use a switch module with one built in, or set
          pull above if the pin needs the RP2040/ESP32's own internal one.
        </p>
      </template>

      <template v-else-if="node.kind === 'ebutton'">
        <label>pin
          <input type="number" min="0" max="39" v-model.number="node.properties.pin" @input="touch" />
        </label>
        <label>pull
          <select v-model="node.properties.pull" @change="touch">
            <option value="none">none -- external pull or self-pulling button (default)</option>
            <option value="up">up -- enable the pin's internal pull-up</option>
            <option value="down">down -- enable the pin's internal pull-down</option>
          </select>
        </label>
        <label>sense
          <select v-model="node.properties.senseMode" @change="touch">
            <option value="auto">auto -- assume not pressed at boot (default)</option>
            <option value="0">0 -- unpressed reads as gnd</option>
            <option value="1">1 -- unpressed reads as 3V3</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="node.properties.suppress" @change="touch" />
          suppress (delay/suppress release in favor of double/long)
        </label>
        <label>debounce (ms)
          <input type="number" min="1" v-model.number="node.properties.debounceMs" @input="touch" />
        </label>
        <label>long press (ms)
          <input type="number" min="1" v-model.number="node.properties.longPressMs" @input="touch" />
        </label>
        <label>double click (ms)
          <input type="number" min="1" v-model.number="node.properties.doubleClickMs" @input="touch" />
        </label>
        <p class="hint">
          Debounced (polling, not IRQ-driven). One output: msg.topic is "press"/"release"/"long"/"double",
          msg.payload is the button's current pressed state as a bool. No internal pull enabled by default --
          wire an external pull resistor, use a button module with one built in, or set pull above if the pin
          needs the RP2040/ESP32's own internal one. double-click time must be less than long-press time.
        </p>
      </template>

      <template v-else-if="node.kind === 'display_spi'">
        <PresetRefField :key="node.id" preset-type="display_spi" :properties="node.properties" @applied="touch" />
        <label>controller
          <select v-model="node.properties.controller" @change="touch">
            <option value="st7789">ST7789</option>
          </select>
        </label>
        <label>frame format
          <select v-model="node.properties.frameFormat" @change="touch">
            <option value="rgb565">RGB565 (full color, default)</option>
            <option value="gs4">GS4 4-bit indexed (1/4 the memory, 16-color palette)</option>
            <option value="gs2">GS2 2-bit indexed (1/8 the memory, 4-color palette)</option>
            <option value="mono">Mono 1-bit indexed (1/16 the memory, 2-color palette)</option>
          </select>
        </label>
        <label>SPI bus
          <input type="number" min="0" v-model.number="node.properties.spiBus" @input="touch" />
        </label>
        <label>baudrate
          <input type="number" min="1" v-model.number="node.properties.baudrate" @input="touch" />
        </label>
        <label>sck pin
          <input type="number" min="0" max="39" v-model.number="node.properties.sck" @input="touch" />
        </label>
        <label>mosi pin
          <input type="number" min="0" max="39" v-model.number="node.properties.mosi" @input="touch" />
        </label>
        <label>dc pin
          <input type="number" min="0" max="39" v-model.number="node.properties.dc" @input="touch" />
        </label>
        <label>cs pin (-1 = not wired)
          <input type="number" min="-1" max="39" v-model.number="node.properties.cs" @input="touch" />
        </label>
        <label>reset pin (-1 = not wired)
          <input type="number" min="-1" max="39" v-model.number="node.properties.reset" @input="touch" />
        </label>
        <label>backlight pin (-1 = not wired)
          <input type="number" min="-1" max="39" v-model.number="node.properties.backlight" @input="touch" />
        </label>
        <label>width (px)
          <input type="number" min="1" v-model.number="node.properties.width" @input="touch" />
        </label>
        <label>height (px)
          <input type="number" min="1" v-model.number="node.properties.height" @input="touch" />
        </label>
        <label>rotation (0-7)
          <input type="number" min="0" max="7" v-model.number="node.properties.rotation" @input="touch" />
        </label>
        <label>color order
          <select v-model="node.properties.colorOrder" @change="touch">
            <option value="bgr">BGR (default)</option>
            <option value="rgb">RGB</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="node.properties.invertColors" @change="touch" />
          invert colors
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="node.properties.dataLatchOrder" @change="touch" />
          data latch order (MH bit)
        </label>
        <label>xstart (-1 = auto)
          <input type="number" min="-1" v-model.number="node.properties.xstart" @input="touch" />
        </label>
        <label>ystart (-1 = auto)
          <input type="number" min="-1" v-model.number="node.properties.ystart" @input="touch" />
        </label>
        <p class="hint">
          One input: msg.payload must already be a framebuf.FrameBuffer buffer matching frame format above --
          RGB565 (width * height * 2 bytes) by default, or an indexed format: GS4 4-bit (framebuf.GS4_HMSB, a
          quarter the memory, palette indices 0-15), GS2 2-bit (framebuf.GS2_HMSB, an eighth, indices 0-3), or
          Mono 1-bit (framebuf.MONO_HMSB -- not MONO_VLSB/MONO_HLSB, see this node's own docs page for why --
          a sixteenth, indices 0-1). Build the source buffer upstream with a function node using
          framebuf.FrameBuffer, or a future graphics-framework node. Note: MicroPython's framebuf.RGB565 stores
          each pixel in CPU-native (little-endian) byte order, but SPI TFT controllers including this one expect
          big-endian pixel bytes on the wire -- byte-swap an RGB565 buffer (swap each pair of bytes) before
          sending, or colors come out wrong (e.g. green renders as red); indexed modes don't need this, the
          palette is defined in real RGB565 order already. Wrong-length input raises a NODE_ERROR rather than
          corrupting the panel silently. Pins vary board to board -- there's no sensible default for more than
          one board, so set them from your board's pinout. -1 on cs/reset/backlight means that pin isn't wired
          (some boards tie reset/cs high or omit backlight control entirely). -1 on xstart/ystart (the default)
          lets the vendored st7789py_mpy driver's own built-in offset table handle 240x240 and 135x240 panels
          (TiDAL's own panel needs xstart=52, ystart=40 -- the driver applies this automatically at -1); any
          other resolution needs xstart/ystart set explicitly or the driver raises a clear error at flow-boot
          time. Every indexed mode's palette (always 16 RGB565 colors, even for GS2/Mono -- GS2 reads only the
          first 4, Mono only the first 2) isn't editable from this panel yet -- set it via the flow file's own
          "palette" property (an array of 16 numbers) if you need something other than the built-in default.
        </p>
      </template>

      <template v-else-if="node.kind === 'display_i2c'">
        <PresetRefField :key="node.id" preset-type="display_i2c" :properties="node.properties" @applied="touch" />
        <label>controller
          <select v-model="node.properties.controller" @change="touch">
            <option value="ssd1306">SSD1306</option>
          </select>
        </label>
        <label>I2C bus
          <input type="number" min="0" v-model.number="node.properties.i2cBus" @input="touch" />
        </label>
        <label>frequency (Hz)
          <input type="number" min="1" v-model.number="node.properties.freq" @input="touch" />
        </label>
        <label>scl pin
          <input type="number" min="0" max="39" v-model.number="node.properties.scl" @input="touch" />
        </label>
        <label>sda pin
          <input type="number" min="0" max="39" v-model.number="node.properties.sda" @input="touch" />
        </label>
        <label>address
          <input type="number" min="0" max="127" v-model.number="node.properties.addr" @input="touch" />
        </label>
        <label>width (px)
          <input type="number" min="1" v-model.number="node.properties.width" @input="touch" />
        </label>
        <label>height (px, multiple of 8)
          <input type="number" min="8" step="8" v-model.number="node.properties.height" @input="touch" />
        </label>
        <p class="hint">
          One input: msg.payload must already be a MONO_VLSB-encoded framebuf.FrameBuffer buffer, width *
          (height / 8) bytes -- build it upstream. Wrong-length input raises a NODE_ERROR rather than silently
          corrupting the display's internal buffer indexing. Pins/address vary board to board -- set them from
          your board's pinout.
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

      <template v-else-if="node.kind === 'wifi_gate'">
        <p class="hint">No properties. Passes the message through unchanged if the WiFi station link is currently up, or drops it (same as a function node's own "return null") if it isn't. Checks the live link state at message-arrival-time, not wifi_status's own emitted messages -- wifi_status only emits on a connection-identity change, so a fast-firing source gated off its output wire could be checking stale state. Uses the flow's own wifi_status node for WiFi credentials -- add one if the flow doesn't have one yet.</p>
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

      <template v-else-if="node.kind === 'http_in'">
        <label>port
          <input type="number" min="1" max="65535" v-model.number="node.properties.port" @input="touch" />
        </label>
        <label>path
          <input v-model="node.properties.path" @input="touch" placeholder="/status" />
        </label>
        <label>method
          <select v-model="node.properties.method" @change="touch">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>
        <label>response timeout (ms)
          <input type="number" min="1" v-model.number="node.properties.responseTimeoutMs" @input="touch" />
        </label>
        <p class="hint">Exact path match only -- no ":name" path parameters yet. Fires once per matching inbound request; pair with an http_response node to actually reply (a request that never reaches one times out with a 500). Uses the flow's own wifi_status node for WiFi credentials -- add one if the flow doesn't have one yet.</p>
      </template>

      <template v-else-if="node.kind === 'http_response'">
        <p class="hint">No properties -- reads msg.statusCode (default 200) and msg.payload (the response body) at runtime, Node-RED's own field names. Must fire on a msg that originally came from an http_in node.</p>
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
        <label class="checkbox-label">
          <input type="checkbox" v-model="node.properties.fullMessage" @change="touch" />
          full message
        </label>
        <p class="hint">Prints the inbound payload to the device console. Check "full message" to print the whole message (topic, and any other fields a source node adds -- e.g. wifi_status's ip/subnet/gateway/dns/rssi) instead of just payload.</p>
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
import { selectedNode, bumpPropertyVersion, propertyVersion, setFunctionNodeOutputCount } from "./store";
import { NODE_PALETTE, DEFAULT_KIND_STYLE, type NodeKind, type KindStyle } from "./palette";
import { InjectNode, CustomNode, FunctionNode } from "./nodes";
import { MAX_FUNCTION_OUTPUTS } from "../../node-library/function-node";
import ConfigRefField from "./ConfigRefField.vue";
import PresetRefField from "./PresetRefField.vue";

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

const maxFunctionOutputs = MAX_FUNCTION_OUTPUTS;

// Real port add/remove (not just a `properties` edit) -- routed through
// store.ts's setFunctionNodeOutputCount ref, filled in by
// editor-setup.ts's createThingstudioEditor(), which is where the live
// Rete editor/area instances actually live (this panel never imports
// them directly, same reasoning ConfigRefField.vue's own header gives for
// staying editor-instance-agnostic). A bare-NaN input (field cleared
// mid-edit) is ignored rather than resized to 1 -- less surprising than
// snapping the port count to 1 on every keystroke while someone's typing
// a two-digit number.
function setFunctionOutputCount(count: number): void {
  if (!(node.value instanceof FunctionNode) || !Number.isFinite(count)) return;
  void setFunctionNodeOutputCount.value?.(node.value, count);
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
