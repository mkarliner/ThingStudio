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

      <template v-else-if="node.kind === 'startup'">
        <label>payload type
          <select v-model="node.properties.payloadType" @change="retypeInjectOutput">
            <option value="bool">bool</option>
            <option value="number">number</option>
            <option value="string">string</option>
            <option value="reason">start reason</option>
          </select>
        </label>
        <label v-if="node.properties.payloadType !== 'reason'">value
          <input v-model="node.properties.payloadValue" @input="touch" />
        </label>
        <p class="hint">Sends this once each time the flow starts: after Deploy, and after the board resets or powers up.
          <code>msg.reason</code> says which.</p>
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

      <!-- GUI nodes (node-library/gui.ts, 2026-10-08). Placement (page, font, size) is in the flow's
           `screens` section, edited in the flow file until the GUI view exists. -->
      <template v-else-if="node.kind === 'gui_screen'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>width (px) <input type="number" min="1" v-model.number="node.properties.width" @input="touch" /></label>
        <label>height (px) <input type="number" min="1" v-model.number="node.properties.height" @input="touch" /></label>
        <label>frame format
          <select v-model="node.properties.frameFormat" @change="touch">
            <option value="gs4">gs4 (16 greys)</option>
            <option value="gs2">gs2 (4 greys)</option>
            <option value="mono">mono</option>
            <option value="rgb565">rgb565 (colour)</option>
          </select>
        </label>
        <label>fastest redraw (ms) <input type="number" min="0" v-model.number="node.properties.minInterval" @input="touch" /></label>
        <label><input type="checkbox" v-model="node.properties.wrap" @change="touch" /> next/prev wrap round</label>
        <ConfigRefField
          config-type="thingstudio/config/touch-panel"
          label="touch panel (blank: no touch)"
          :model-value="node.properties.touchPanelConfigId || undefined"
          @update:model-value="(id) => setConfigId('touchPanelConfigId', id)"
        />
        <p class="hint">Rotation is set on the display this screen is wired to; with one set, width and height here are the
          panel's own size.</p>
        <p class="hint">Sends a frame each time the screen changes. Wire it to a display node with the same size and
          frame format.</p>
        <ScreenOutline :screen-id="node.id" />
      </template>

      <template v-else-if="node.kind === 'gui_readout'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>units <input type="text" v-model="node.properties.units" @input="touch" /></label>
        <label>decimals <input type="number" min="0" max="6" v-model.number="node.properties.decimals" @input="touch" /></label>
        <label>lowest value <input type="number" v-model.number="node.properties.lo" @input="touch" /></label>
        <label>highest value <input type="number" v-model.number="node.properties.hi" @input="touch" /></label>
        <label>stale after (s, 0 = never) <input type="number" min="0" v-model.number="node.properties.staleAfter" @input="touch" /></label>
        <p class="hint">Shows msg.payload. Its space is sized for the lowest to highest value.</p>
      </template>

      <template v-else-if="node.kind === 'gui_label'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>room for (characters) <input type="number" min="1" v-model.number="node.properties.maxChars" @input="touch" /></label>
        <label>stale after (s, 0 = never) <input type="number" min="0" v-model.number="node.properties.staleAfter" @input="touch" /></label>
      </template>

      <template v-else-if="node.kind === 'gui_bar'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>empty at <input type="number" v-model.number="node.properties.lo" @input="touch" /></label>
        <label>full at <input type="number" v-model.number="node.properties.hi" @input="touch" /></label>
        <label>stale after (s, 0 = never) <input type="number" min="0" v-model.number="node.properties.staleAfter" @input="touch" /></label>
      </template>

      <template v-else-if="node.kind === 'gui_trend'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>bottom at <input type="number" step="any" v-model.number="node.properties.lo" @input="touch" /></label>
        <label>top at <input type="number" step="any" v-model.number="node.properties.hi" @input="touch" /></label>
        <label>columns (natural width) <input type="number" min="1" v-model.number="node.properties.columns" @input="touch" /></label>
        <label>column width (px) <input type="number" min="1" v-model.number="node.properties.colWidth" @input="touch" /></label>
        <label>height (px) <input type="number" min="8" v-model.number="node.properties.height" @input="touch" /></label>
        <label>stale after (s, 0 = never) <input type="number" min="0" v-model.number="node.properties.staleAfter" @input="touch" /></label>
        <p class="hint">Draws the series a journal sends, newest on the right, or any list of numbers (None is a gap).
          A wider space shows more history.</p>
      </template>

      <template v-else-if="node.kind === 'gui_led'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>stale after (s, 0 = never) <input type="number" min="0" v-model.number="node.properties.staleAfter" @input="touch" /></label>
        <p class="hint">On when msg.payload is true, off when false.</p>
      </template>

      <template v-else-if="node.kind === 'gui_button'">
        <label>topic <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>mode
          <select v-model="node.properties.mode" @change="touch">
            <option value="momentary">momentary: sends a value</option>
            <option value="toggle">toggle: sends the opposite of its state</option>
            <option value="navigate">navigate: changes page</option>
          </select>
        </label>
        <template v-if="node.properties.mode !== 'navigate'">
          <label>value type
            <select v-model="node.properties.valueType" @change="touch">
              <option value="bool">true / false</option>
              <option value="string">text</option>
              <option value="number">number</option>
            </select>
          </label>
          <label>send on
            <select v-model="node.properties.fireOn" @change="touch">
              <option value="release">release (inside the button)</option>
              <option value="press">press</option>
            </select>
          </label>
        </template>
        <template v-if="node.properties.mode === 'momentary'">
          <label>board label (drawn on the button) <input type="text" v-model="node.properties.text" :placeholder="node.properties.label || ''" @input="touch" /></label>
          <label>sends (the payload) <input type="text" v-model="node.properties.value" :placeholder="buttonDefault(node.properties.valueType, 0)" @input="touch" /></label>
          <label>room for (characters, if no text) <input type="number" min="1" v-model.number="node.properties.maxChars" @input="touch" /></label>
        </template>
        <template v-else-if="node.properties.mode === 'toggle'">
          <label>on sends <input type="text" v-model="node.properties.onValue" :placeholder="buttonDefault(node.properties.valueType, 0)" @input="touch" /></label>
          <label>off sends <input type="text" v-model="node.properties.offValue" :placeholder="buttonDefault(node.properties.valueType, 1)" @input="touch" /></label>
          <label>on shows <input type="text" v-model="node.properties.onText" @input="touch" /></label>
          <label>off shows <input type="text" v-model="node.properties.offText" @input="touch" /></label>
          <label><input type="checkbox" v-model="node.properties.initial" @change="touch" /> starts on (when nothing is wired in)</label>
          <label>wait for confirmation (s, 5 or more) <input type="number" min="5" v-model.number="node.properties.pendingTimeout" @input="touch" /></label>
        </template>
        <template v-else>
          <label>text <input type="text" v-model="node.properties.text" @input="touch" /></label>
          <label>goes to <input type="text" v-model="node.properties.target" placeholder="next, prev, back, home or a page name" @input="touch" /></label>
        </template>
        <p v-if="node.properties.mode === 'toggle'" class="hint">Wire its input to the real state (a plug's MQTT status) and the flow
          owns it: it shows <code>--</code> until the first report, a tap shows the requested state hollow until the input
          confirms it, and with no answer it goes back and flags the failure. Unwired, it keeps its own state. Its output
          sends the new state; wire it to whatever switches the device.</p>
        <p v-else-if="node.properties.mode === 'momentary'" class="hint">Sends "sends" when tapped (the payload; the topic is above). The board label is what is drawn on the button
          (blank: the flow label); a msg.payload on its input replaces it.</p>
        <p v-else class="hint">Acts on its own screen; needs no wires.</p>
      </template>

      <template v-else-if="node.kind === 'gui_navigator'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>screen <input type="text" v-model="node.properties.screen" placeholder="only needed with two screens" @input="touch" /></label>
        <p class="hint">msg.payload: next, prev, back, home or a page name. Sends the new page when it changes.</p>
      </template>

      <template v-else-if="node.kind === 'gui_modal'">
        <label>name <input type="text" v-model="node.properties.name" @input="touch" /></label>
        <label>screen <input type="text" v-model="node.properties.screen" placeholder="only needed with two screens" @input="touch" /></label>
        <label>priority <input type="number" v-model.number="node.properties.priority" @input="touch" /></label>
        <label>close after (s, 0 = never) <input type="number" min="0" v-model.number="node.properties.timeout" @input="touch" /></label>
        <p class="hint">Opens with msg.payload as its content; a payload of None closes it. The output sends how it closed:
          <code>ack</code>, <code>timeout</code> or <code>closed</code>.</p>
      </template>

      <template v-else-if="node.kind === 'display_spi'">
        <PresetRefField :key="node.id" preset-type="display_spi" :properties="node.properties" @applied="touch" />
        <label>orientation
          <select v-model="node.properties.orientation" @change="touch">
            <option value="">off (raw rotation)</option>
            <option value="0">0° (the panel's own)</option>
            <option value="90">90° clockwise</option>
            <option value="180">180°</option>
            <option value="270">270° clockwise</option>
          </select>
        </label>
        <p class="hint" v-if="node.properties.orientation">Width and height are the panel's own size; rotation is how the panel is
          mounted (0 to 3). A gui screen wired to this display turns its size and touch to match.</p>
        <label>controller
          <select v-model="node.properties.controller" @change="touch">
            <option value="st7789">ST7789</option>
            <option value="st7796">ST7796 (320x480)</option>
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
        <PaletteField :properties="node.properties" @changed="touch" />
        <label>SPI bus
          <input type="number" min="0" v-model.number="node.properties.spiBus" @input="touch" />
        </label>
        <label>baudrate
          <input type="number" min="1" v-model.number="node.properties.baudrate" @input="touch" />
        </label>
        <PinField label="sck pin" :model-value="node.properties.sck" @update:model-value="(v) => setProp('sck', v)" />
        <PinField label="mosi pin" :model-value="node.properties.mosi" @update:model-value="(v) => setProp('mosi', v)" />
        <PinField label="dc pin" :model-value="node.properties.dc" @update:model-value="(v) => setProp('dc', v)" />
        <PinField label="cs pin (-1 = not wired)" :optional="true" :model-value="node.properties.cs" @update:model-value="(v) => setProp('cs', v)" />
        <PinField label="reset pin (-1 = not wired)" :optional="true" :model-value="node.properties.reset" @update:model-value="(v) => setProp('reset', v)" />
        <PinField label="backlight pin (-1 = not wired)" :optional="true" :model-value="node.properties.backlight" @update:model-value="(v) => setProp('backlight', v)" />
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
          time. Indexed modes use the palette swatches under frame format: GS2 reads the first 4 colors, Mono the
          first 2.
        </p>
      </template>

      <template v-else-if="node.kind === 'display_i2c'">
        <PresetRefField :key="node.id" preset-type="display_i2c" :properties="node.properties" @applied="touch" />
        <label>controller
          <select v-model="node.properties.controller" @change="touch">
            <option value="ssd1306">SSD1306</option>
          </select>
        </label>
        <ConfigRefField
          config-type="thingstudio/config/i2c-bus"
          :model-value="node.properties.i2cConfigId || undefined"
          @update:model-value="(id) => setConfigId('i2cConfigId', id)"
        />
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
          corrupting the display's internal buffer indexing. The I2C bus holds the pins and clock, shared with
          every other I2C node on the same bus.
        </p>
      </template>

      <template v-else-if="nodeDescriptor">
        <p v-if="nodeDescriptor.description" class="hint">{{ nodeDescriptor.description }}</p>
        <template v-for="f in nodeDescriptor.properties ?? []" :key="f.name ?? f.label">
          <template v-if="!f.showIf || f.showIf(nodeProperties)">
            <PinField
              v-if="f.kind === 'pin'"
              :label="f.label"
              :optional="f.optional"
              :model-value="nodeProperties[f.name!]"
              @update:model-value="(v) => setProp(f.name!, v)"
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
              <input type="checkbox" v-model="nodeProperties[f.name!]" @change="touch" />
              {{ f.label }}
            </label>
            <label v-else>
              {{ f.label }}
              <select v-if="f.kind === 'select'" v-model="nodeProperties[f.name!]" @change="touch">
                <option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
              <input v-else-if="f.kind === 'number'" type="number" :min="f.min" :max="f.max" :step="f.step" :placeholder="f.placeholder" v-model.number="nodeProperties[f.name!]" @input="touch" />
              <input v-else-if="f.kind === 'password'" type="password" :placeholder="f.placeholder" v-model="nodeProperties[f.name!]" @input="touch" />
              <input v-else type="text" :placeholder="f.placeholder" v-model="nodeProperties[f.name!]" @input="touch" />
            </label>
            <p v-if="f.help" class="hint">{{ f.help }}</p>
          </template>
        </template>
        <p v-if="isCustomNode" class="hint">Custom node ({{ nodeDescriptor.type }}) -- loaded this session only; reload its package after a page refresh.</p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// What a gui_button sends when its value fields are blank, by value type (matches buttonConfig() in node-library/gui.ts).
function buttonDefault(valueType: unknown, i: 0 | 1): string {
  const d = ({ bool: ["true", "false"], string: ["ON", "OFF"], number: ["1", "0"] } as Record<string, string[]>)[String(valueType)] ?? ["true", "false"];
  return d[i]!;
}
import { computed } from "vue";
import { selectedNode, bumpPropertyVersion, propertyVersion, setFunctionNodeOutputCount } from "./store";
import { DEFAULT_KIND_STYLE, type KindStyle } from "./palette";
import { paletteStyleFor } from "./node-descriptors";
import { InjectNode, StartupNode, CustomNode, FunctionNode } from "./nodes";
import type { NodeDescriptor, PropertyFieldDescriptor } from "../../compiler/node-descriptor";
import { MAX_FUNCTION_OUTPUTS } from "../../node-library/function-node";
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

// Any node built from a canonical descriptor -- a migrated built-in (nodes.ts's
// buildDescriptorNodeClass) or a loaded CustomNode -- exposes a `descriptor`. Its property schema
// renders through the one generic branch at the end of the template; a still-bespoke kind has no
// descriptor and keeps its own block.
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
// Shared by inject and startup, which have the same dynamic output socket.
function retypeInjectOutput(): void {
  if (node.value instanceof InjectNode || node.value instanceof StartupNode) {
    node.value.retypeOutput();
  }
  touch();
}

const maxFunctionOutputs = MAX_FUNCTION_OUTPUTS;

// Pin fields moved to the shared PinField.vue (a number input for a numeric target, a dropdown for a
// named-pin board like the STM32 pyboard), which reads activeTarget itself.

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


// ConfigRefField's own `update:modelValue` hands back a fresh/selected config id -- written onto the
// node's own config-reference property, same `touch()` signal as every other field edit. (Migrated
// nodes go through the generic branch's setField; this stays for the still-bespoke gui_screen/
// display_i2c.)
/** Points the selected node at a config (e.g. its I2C bus). */
function setConfigId(key: string, id: string): void {
  if (!node.value) return;
  (node.value.properties as Record<string, unknown>)[key] = id;
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
