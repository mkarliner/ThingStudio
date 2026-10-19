// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/nodes.ts
//
// Rete node classes for the editor node types, ported from
// pocs/poc-rete/src/nodes.ts's five *fake* types onto the real property
// contracts app/nodes.ts's own header documents -- node.properties here
// has to match exactly what each node-library/*.ts's codegen reads:
//   - inject:       payloadType, payloadValue                (node-library/inject.ts -- no `repeat`, see that file's 2026-09-02 header note)
//   - startup:      payloadType, payloadValue                (node-library/startup.ts -- canvas presence 2026-09-24)
//   - function:     code                                     (node-library/function-node.ts)
//   - debug:        fullMessage                              (node-library/debug.ts -- opt-in, default false, added 2026-09-09)
//   - gpio_out:     pin                                       (node-library/gpio-out.ts)
//   - timer:        intervalMs                                (node-library/core-packages/timer.ts)
//   - interrupt:    pin, edge                                 (node-library/core-packages/interrupt.ts)
//   - eswitch:      pin, pull, lopen, debounceMs                     (node-library/core-packages/eswitch.ts)
//   - ebutton:      pin, pull, suppress, senseMode, debounceMs, longPressMs, doubleClickMs (node-library/core-packages/ebutton.ts)
//   - wifi_status:  pollMs, wifiConfigId                       (node-library/wifi-status.ts -- the flow's ONLY node with its own wifiConfigId, 2026-09-04, see that file's header)
//   - udp_send:     host, port, timeoutMs                      (node-library/udp-send.ts -- wifiConfigId removed 2026-09-04, derives from the flow's wifi_status node instead)
//   - udp_receive:  port, pollMs                                (node-library/udp-receive.ts -- same removal)
//   - http_request: url, method, timeoutMs                       (node-library/http-request.ts -- given canvas presence 2026-09-05, see below; never had a wifiConfigId of its own, unaffected by the 2026-09-04 removal)
//   - mqtt_publish:   topic, retain, qos, brokerConfigId          (node-library/mqtt-publish.ts -- wifiConfigId removed 2026-09-04, same reason)
//   - mqtt_subscribe: topic, qos, brokerConfigId                 (node-library/mqtt-subscribe.ts -- same removal)
//
// poc-rete's fake type set doesn't match 1:1
// (rete-migration-implementation-briefing.md's callout): "mqtt out" was
// originally dropped (never exposed on this canvas, even though
// node-library/mqtt-publish.ts existed) -- since fixed, see the
// mqtt_publish/mqtt_subscribe paragraph below. "timer" is new -- poc-rete had
// no equivalent to port, so its property shape/sizing is fresh work here,
// unverified in a real browser by anyone until Mike's hands-on pass.
// "interrupt" is newer still -- added after the rest of this file, when
// Mike's own hands-on test of the freshly-built interrupt node (Tier 1
// item 5) hit the fact that it had never been wired into the canvas at
// all (compiler/registry-only, matching gpio_in's old precedent). Same
// "unverified in a real browser" caveat applies, doubly so here since
// interrupt.ts's codegen itself hasn't had its own hardware pass yet.
//
// wifi_status/udp_send/udp_receive are newer still -- config-node-and-
// palette-implementation-briefing.md (2026-08-18), following interrupt's
// own wiring exactly as its own worked example. Each originally carried
// its own `wifiConfigId` property (empty string = "no config referenced
// yet", resolveWifiCredentials()'s own contract, wifi-status.ts) bound to
// a ConfigRefField in PropertyPanel.vue rather than raw ssid/password
// fields -- the fix for the credential-duplication problem that session
// existed to close. http_request stays registry-only, an explicit
// flagged follow-up at the time (see that briefing's own success-criteria
// section).
//
// **`http_request` given real canvas presence, 2026-09-05**
// (HttpRequestNode below) -- previously registry-only since introduction
// (this file's header above; outstanding-items/http-request-config-node-
// gap.md, canvas-presence-gaps.md), following mqtt-publish.ts's own
// worked example. A transform kind (both input and output ports), like
// FunctionNode -- the only other transform-kind class in this file, since
// every other network node type here is a pure source or sink.
//
// **`wifiConfigId` removed from udp_send/udp_receive/mqtt_publish/
// mqtt_subscribe, 2026-09-04** (Mike's own real-hardware finding,
// wifi-status.ts's header has the full story): the credential-duplication
// fix above stopped ssid/password being TYPED IN more than once, but
// nothing stopped each node's own independent config REFERENCE from
// silently disagreeing with another network node's -- wifi_status is now
// the flow's one and only source of WiFi credentials, and every other
// network node type derives from it instead of picking its own. Only
// wifi_status keeps a `wifiConfigId` property; the ConfigRefField this
// paragraph used to describe on udp_send/udp_receive's own panel sections
// is gone (PropertyPanel.vue).
//
// mqtt_publish/mqtt_subscribe are newer still (2026-08-21): given the same
// config-node migration (wifiConfigId, not raw ssid/password, at the
// time) AND, unlike wifi_status/udp_send/udp_receive, first-time canvas
// wiring at all -- they'd been registry-only since introduction, per this
// file's own now-corrected header above. Same day, on Mike's own follow-
// up request: a second config reference, `brokerConfigId`
// (`thingstudio/config/mqtt-broker`, config-types.ts), replacing what
// used to be raw `broker`/`port` properties on these two classes -- see
// mqtt-shared.ts's header for the broker-config design.
//
// **`wifiConfigId` removed 2026-09-04** along with udp_send/udp_receive's
// (see this file's header paragraph above and wifi-status.ts's own
// header) -- these two kinds now carry only `brokerConfigId`, one
// ConfigRefField, not two; the WiFi side derives from the flow's own
// wifi_status node instead of a config reference of their own.
//
// §6 wire-type system (docs/working-notes/wire-type-system-scoping.md):
// every port constructed below reads its real socket type from the
// matching node-library/*.ts's `ports` declaration (compiler/node-
// definition.ts) via portSocket(), instead of the sub-decision-3-era
// hardcoded `new AnySocket()` every port used to get. inject is the one
// dynamic case -- see InjectNode.retypeOutput() below.
//
// Live propagation (poc-rete's onFire/timer-interval instance behavior)
// is out of scope entirely (rete-migration-decision.md, "Not in scope") --
// these classes stay data-only: properties + ports, plus the small
// additions below (`highlighted`, `retypeOutput`).
//
// Phase 3 update: `highlighted` (a plain boolean, not a `properties` field)
// and `NODE_FACTORIES` were added here -- see each class's own comment and
// this file's bottom for why.
//
// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20): every class below gained an explicit `nodeType`
// field (e.g. "thingstudio/inject") holding exactly the string
// graph-adapter.ts/main.ts used to compute on the fly via
// `` `thingstudio/${n.kind}` ``. That string-concat assumed every node's
// compiler type is the `thingstudio/` namespace plus its `kind` -- true
// for the built-in classes, but wrong for a loaded custom node type (own
// namespace, e.g. "custom/dht22", no relationship to `kind`).
//
// **Every node is now one class** (2026-10-15, node-format-parity roadmap phase 0): `DescriptorNode`
// below is the single descriptor-driven base; a built-in subclass fixes its descriptor at class-build
// time and `CustomNode` passes the package's descriptor per instance. The concrete subclasses below are
// kept only for `instanceof` checks and node-library tests. The compiler-side hooks are the sole
// built-in/custom divergence -- the editor class is identical.
//
// **Multi-connection inputs, 2026-09-10** (Mike's ask -- outstanding-
// items/multi-connection-node-inputs.md): every `new ClassicPreset.Input
// (...)` call below now passes `true` as the third (`multipleConnections`)
// constructor argument, so any number of wires can land on one input --
// Node-RED's own semantics, Mike's explicit design call. Previously every
// input was implicitly single-connection (Rete's own `Input` default is
// `false`, asymmetric with `Output`'s `true` default) -- not a
// Thingstudio bug, just never overridden. Mechanically this is the whole
// fix: `compile.ts`'s codegen already fully supports fan-in with no
// change needed (its own header comment documents this as deliberate
// from the DAG-compiler rewrite onward, and `compiler.general.test.ts`'s
// "fan-in: two independent sources sharing one gpio_out sink" test
// already covered the identical mechanism -- multiple upstream links
// converging on one node, generated once, called once per incoming
// path); `graph-adapter.ts`'s `toGraphData()`/main.ts's flow-file `edges`
// builder already map over ALL of `editor.getConnections()` with no
// per-input uniqueness assumption. The one real behavior change is
// canvas-side: `rete-connection-plugin`'s `syncConnections()` used to
// silently REPLACE an input's existing wire with a new one dropped on the
// same socket (not a rejection -- Mike's "can't connect two wires" was
// actually "second wire silently evicts the first"); with
// `multipleConnections: true` that auto-eviction is skipped for that
// port (rete-connection-plugin's own built-in behavior, confirmed by
// reading its source -- nothing bespoke needed here), so a second wire
// now adds alongside the first instead of replacing it.

import { ClassicPreset } from "rete";
import { socketForPayloadType } from "./sockets";
import type { NodeKind } from "./palette";
import { injectNode } from "../../node-library/inject.js";
import { startupNode } from "../../node-library/startup.js";
import { functionNode } from "../../node-library/function-node.js";
import { descriptor as debugCoreDescriptor } from "../../node-library/core-packages/debug.js";
import { descriptor as gpioOutCoreDescriptor } from "../../node-library/core-packages/gpio-out.js";
import { descriptor as timerCoreDescriptor } from "../../node-library/core-packages/timer.js";
import { descriptor as interruptCoreDescriptor } from "../../node-library/core-packages/interrupt.js";
import { descriptor as eswitchCoreDescriptor } from "../../node-library/core-packages/eswitch.js";
import { descriptor as ebuttonCoreDescriptor } from "../../node-library/core-packages/ebutton.js";
import { adcNode } from "../../node-library/adc.js";
import { descriptor as encoderCoreDescriptor } from "../../node-library/core-packages/encoder.js";
import { descriptor as neopixelCoreDescriptor } from "../../node-library/core-packages/neopixel.js";
import { descriptor as wifiStatusCoreDescriptor } from "../../node-library/core-packages/wifi-status.js";
import { descriptor as wifiGateCoreDescriptor } from "../../node-library/core-packages/wifi-gate.js";
import { descriptor as udpSendCoreDescriptor } from "../../node-library/core-packages/udp-send.js";
import { descriptor as udpReceiveCoreDescriptor } from "../../node-library/core-packages/udp-receive.js";
import { descriptor as httpRequestCoreDescriptor } from "../../node-library/core-packages/http-request.js";
import { httpInNode } from "../../node-library/http-in.js";
import { descriptor as httpResponseCoreDescriptor } from "../../node-library/core-packages/http-response.js";
import { descriptor as delayCoreDescriptor } from "../../node-library/core-packages/delay.js";
import { descriptor as filterCoreDescriptor } from "../../node-library/core-packages/filter.js";
import { descriptor as journalCoreDescriptor } from "../../node-library/core-packages/journal.js";
import { ntpNode } from "../../node-library/ntp.js";
import { descriptor as bme280CoreDescriptor } from "../../node-library/core-packages/bme280.js";
import { touchI2cNode } from "../../node-library/touch-i2c.js";
import type { NodeDescriptor } from "../../compiler/node-definition.js";
import { guiBarNode, guiTrendNode, guiButtonNode, guiLabelNode, guiLedNode, guiModalNode, guiNavigatorNode, guiReadoutNode, guiScreenNode } from "../../node-library/gui.js";
import { descriptor as i2cCoreDescriptor } from "../../node-library/core-packages/i2c.js";
import { mqttPublishNode } from "../../node-library/mqtt-publish.js";
import { mqttSubscribeNode } from "../../node-library/mqtt-subscribe.js";
import { descriptor as pwmOutCoreDescriptor } from "../../node-library/core-packages/pwm-out.js";
import { displaySpiNode } from "../../node-library/display-spi.js";
import { descriptor as displayI2cCoreDescriptor } from "../../node-library/core-packages/display-i2c.js";
import { resolvePortType, resolveOutputCount, type PortDefinition } from "../../compiler/node-definition.js";
import type { CustomNodeDescriptor } from "../../node-library/custom-node.js";
import type { NodeStatusState } from "../../protocol/messages.js";

// Uniform pill height, ported from poc-rete's NODE_HEIGHT -- see that
// project's README "also worth recording" section for why this is a real
// Rete classic-preset layout budget that clips content, not a hint the
// way Litegraph's `size` is.
const NODE_HEIGHT = 34;

// Looks up one named port in a NodeDefinition's `ports.inputs`/`.outputs`
// and resolves it to a real socket for the given node instance's current
// `properties` -- the one place a node-library ports declaration becomes
// an actual ClassicPreset socket, shared by every node class's constructor
// below (and InjectNode's retypeOutput()) instead of five copies of the
// same find-then-resolve-then-construct sequence. Throws on a missing
// port rather than falling back to AnySocket -- a name here not matching
// the node-library declaration is this file and that one drifting out of
// sync with each other, a programmer error worth failing loudly on
// (CLAUDE.md's fault-handling priority), same reasoning graph-adapter.ts's
// own socketIndex() already applies to its analogous "key not found" case.
export function portSocket(defs: PortDefinition[] | undefined, name: string, properties: Record<string, unknown>) {
  const def = defs?.find((d) => d.name === name);
  if (!def) {
    throw new Error(`nodes.ts: no port definition named "${name}" -- node-library ports declaration is out of sync with this file`);
  }
  return socketForPayloadType(resolvePortType(def, properties));
}

// `highlighted` (added to every node class below, Phase 3 item 12): the
// reactive-state replacement for app/nodes.ts's `node.color`/`node.bgcolor`
// mutation + `canvas.setDirty(true, true)`. Rete node instances are plain
// classes, not Vue-reactive, so mutating this field alone doesn't repaint
// anything -- the same reason store.ts's `propertyVersion` bump exists.
// main.ts's highlightNode()/clearNodeHighlights() set this directly and
// follow up with `area.update("node", node.id)` to force
// ThingstudioNode.vue to re-render (poc-rete's own `lastValue`/`lastLabel`
// used this exact mechanism for its live-value dots). Not part of
// `properties` -- the compiler-facing adapter (graph-adapter.ts) never
// reads it, so it can't leak into generated source or a saved flow file.
//
// General gotcha worth remembering, found hands-on chasing a socket-
// tooltip bug during the §6 wire-type system work (tried, then removed --
// ThingstudioSocket.vue's own header has the full story): `area.update
// ("node", id)` only reaches state read directly by ThingstudioNode.vue's
// own template, like `highlighted` above. It does NOT reach anything
// rendered by a *nested* per-port Vue component (sockets, and by the same
// architecture presumably controls) -- rete-vue-plugin mounts each of
// those as its own independent Vue app, wired up once via `Ref.vue`'s
// `mounted()` hook and never refreshed again on prop changes, and sockets
// specifically have no `.id` at all (only nodes/connections do), so
// `area.update()` isn't even a route that reaches them. The only way to
// force one of those to refresh is a `:key` change on its `<Ref>` in the
// owning node component, forcing Vue to unmount and remount it. Left
// undone here since nothing currently needs a socket to visibly reflect a
// runtime change -- worth knowing before assuming `area.update("node",
// id)` alone covers "make the canvas reflect this mutation," if that ever
// comes up again (a live-value dot per port, a drag-time compatibility
// highlight, etc.).
//
// `status`/`statusText` (added 2026-09-10, connection-status-indicator
// feature, outstanding-items/node-status-indicators.md -- Mike's design
// call 2026-09-09/10): same off-`properties`, main.ts-mutated,
// `area.update()`-driven mechanism as `highlighted` just above, restoring
// poc-rete's own status-line concept (ThingstudioNode.vue's header) on a
// device-driven basis instead of that spike's hand-rolled propagate().
// Added to every node class here, not just the three kinds that can
// currently produce one, for the same reason `highlighted` is universal
// despite not every node type being able to NODE_ERROR in practice --
// ThingstudioNode.vue renders generically off `AnyThingstudioNode` and
// shouldn't need per-kind branching to know whether a status line is
// possible. What actually gates this to wifi_status/mqtt_publish/
// mqtt_subscribe (Mike's scope decision) is which node-library/*.ts
// codegens ever call `runtime.report_status()` -- no other kind's
// generated code can produce a NODE_STATUS push, so no other kind's
// fields are ever mutated from null. `status` is `null` (not e.g.
// "disconnected") until at least one push has arrived this
// connection/since the last redeploy -- main.ts's clearNodeStatuses()
// resets every node back to this same "never heard from" null state on
// every redeploy attempt (Mike's "clear on every redeploy" call), same
// point clearNodeHighlights() already resets `highlighted` from.
// inject/startup (node-library/inject.ts, startup.ts) are descriptor-driven (buildDescriptorNodeClass
// below); their output socket type tracks `payloadType` (the generic class's retypeOutputs, called from
// the panel's `retype` field).

// Output key convention for FunctionNode's dynamic ports (multi-output-
// port support, outstanding-items/connection-state-gate-router-nodes.md,
// 2026-09-12), shared with editor-setup.ts's resize logic
// (setFunctionNodeOutputCount) so both sides agree on what the output at
// position `i` is called. Deliberately NOT a numeric-looking string ("0",
// "1", ...): JS object property enumeration always lists integer-index-
// like keys first, in ascending numeric order, regardless of insertion
// order -- which would silently break graph-adapter.ts's socketIndex()
// (position in Object.keys(node.outputs) at serialize time, the thing
// compile.ts's per-output routing actually keys off) the moment a
// function node's first output isn't also its first-inserted one, e.g.
// after a shrink then a regrow. "out0"/"out1"/... aren't numeric-index-
// like strings, so they keep ordinary insertion-order semantics, and a
// resize that only ever adds/removes from the tail (which
// setFunctionNodeOutputCount does) always regrows in the same order it
// shrank from.
// Output key convention for a dynamic-output node's ports (the function node's outputCount -- multi-
// output-port support, outstanding-items/connection-state-gate-router-nodes.md, 2026-09-12). Reads the
// prefix from the descriptor (`dynamicOutputs.namePrefix`) so the class and graph-adapter.test.ts agree
// on what the output at position `i` is called (e.g. "out0"). Deliberately NOT a numeric-looking string
// ("0", "1", ...): JS object property enumeration always lists integer-index-like keys first, in ascending
// numeric order, regardless of insertion order -- which would silently break graph-adapter.ts's
// socketIndex() (position in Object.keys(node.outputs) at serialize time, the thing compile.ts's per-output
// routing actually keys off) the moment a function node's first output isn't also its first-inserted one,
// e.g. after a shrink then a regrow. "out0"/"out1"/... aren't numeric-index-like strings, so they keep
// ordinary insertion-order semantics, and a resize that only ever adds/removes from the tail (which
// setFunctionNodeOutputCount does) always regrows in the same order it shrank from.
export function functionOutputKey(index: number): string {
  return `${functionNode.dynamicOutputs!.namePrefix}${index}`;
}

// The function node's Rete class is descriptor-driven now (buildDescriptorNodeClass below, from
// node-library/function-node.ts's descriptor + its `dynamicOutputs` spec) -- its pill height grows with
// output count via the generic class's setDynamicOutputHeight (the spec's own rowHeightPx), so the old
// standalone functionNodeHeight() helper is gone with it.

// variable_get/variable_set deliberately have NO Rete class here --
// hidden from the canvas 2026-09-06 (see palette.ts's own header for
// why: Mike's call, pending a proper Node-RED-style context model).
// node-library/variable-get.ts and variable-set.ts still exist and are
// still registered with the compiler (registry.ts) unchanged -- a flow
// file that already references thingstudio/variable_get or
// thingstudio/variable_set still compiles -- only the canvas
// class/palette entry/property-panel section are gone, matching this
// project's own precedent for a registry-only node type (same state
// http_request was in before 2026-09-05).

// filter (drops messages that aren't worth sending: unchanged, inside a deadband, or too soon) and journal
// (node-library/filter.ts, journal.ts) are descriptor-driven (buildDescriptorNodeClass below). journal's two
// outputs make the generic class taller.

// The time of day from NTP (node-library/ntp.ts, replaces clock 2026-10-14). Two-faced: a message in asks for the
// time now; the output sends it, also after each sync. Network group: it joins the flow's WiFi itself --
// descriptor-driven (buildDescriptorNodeClass below).

// BME280/BMP280 sensor on a shared I2C bus -- a core package now (node-library/core-packages/bme280.ts),
// descriptor-driven (buildDescriptorNodeClass below).

// Touch panel (FT6336U) on a shared I2C bus (node-library/touch-i2c.ts) -- descriptor-driven
// (buildDescriptorNodeClass below).

// GUI nodes (node-library/gui.ts, 2026-10-08). Where widgets sit is the flow's `screens` section, not a node
// property; these hold only data properties (range, units, how long until stale). All nine -- gui_button
// included as of 2026-10-15 -- are descriptor-driven (buildDescriptorNodeClass below); their canvas title
// comes from each descriptor's own `title`.

// Generic I2C read/write/scan on a shared bus -- a core package now (node-library/core-packages/i2c.ts), built
// through buildDescriptorNodeClass like every other node.
// (buildDescriptorNodeClass below). address/register are text so hex ("0x29") can be typed; the compiler
// parses them.

// --- The one descriptor-driven node class (node-descriptor-unification-briefing.md) ---
//
// Every node -- a built-in or a loaded custom type -- is a `DescriptorNode`: its descriptor's ports,
// dynamic outputs, property defaults and palette metadata drive it, with no per-type hand-written class
// left. The two producers differ only in *when* the descriptor is known: a built-in subclass below fixes
// its descriptor at class-build time (`buildDescriptorNodeClass`), while a custom node passes the
// package's descriptor to the constructor, since that descriptor is only known at load time. The
// compiler-side hooks (`codegen*`) are the sole thing a custom package cannot carry (`custom-node.ts`
// builds its `NodeDefinition`); the editor-side class is now identical for both. `descriptor` on the
// instance is what PropertyPanel.vue's generic branch and ThingstudioNode.vue's palette read.
export class DescriptorNode extends ClassicPreset.Node {
  width: number;
  // Height is fixed for most nodes; a dynamic-output node (the function node) sets it per instance from
  // the output count in the constructor and on resize.
  height: number;
  /** The short palette key (e.g. "function"), or "custom" for a loaded custom type. */
  kind: string;
  nodeType: string;
  descriptor: NodeDescriptor;
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;
  properties: Record<string, unknown>;

  constructor(descriptor: NodeDescriptor) {
    super(descriptor.title ?? descriptor.label ?? descriptor.paletteId ?? descriptor.type);
    this.descriptor = descriptor;
    this.width = descriptor.width ?? 100;
    this.height = (descriptor.ports?.outputs?.length ?? 0) > 1 ? NODE_HEIGHT + 20 : NODE_HEIGHT;
    this.kind = descriptor.paletteId ?? "custom";
    this.nodeType = descriptor.type;
    this.properties = Object.fromEntries(
      (descriptor.properties ?? []).filter((f) => f.name !== undefined).map((f) => [f.name!, f.default]),
    );
    for (const input of descriptor.ports?.inputs ?? []) {
      this.addInput(input.name, new ClassicPreset.Input(portSocket(descriptor.ports?.inputs, input.name, this.properties), input.name, true));
    }
    const spec = descriptor.dynamicOutputs;
    if (spec) {
      const count = resolveOutputCount(spec, this.properties);
      for (let i = 0; i < count; i++) this.addDynamicOutputAt(i);
      this.setDynamicOutputHeight(count);
    } else {
      for (const output of descriptor.ports?.outputs ?? []) {
        this.addOutput(output.name, new ClassicPreset.Output(portSocket(descriptor.ports?.outputs, output.name, this.properties), output.name));
      }
    }
  }

  /** Adds the dynamic output at `index`, keyed per the descriptor's `dynamicOutputs` spec (e.g.
   * "out0"), from the single `ports.outputs` template. */
  addDynamicOutputAt(index: number): void {
    const spec = this.descriptor.dynamicOutputs!;
    const template = this.descriptor.ports?.outputs?.[0];
    if (!template) throw new Error(`nodes.ts: dynamic-output node "${this.descriptor.type}" has no ports.outputs template`);
    this.addOutput(`${spec.namePrefix}${index}`, new ClassicPreset.Output(portSocket(this.descriptor.ports?.outputs, template.name, this.properties), String(index + 1)));
  }

  /** Removes the dynamic output at `index`. The caller (editor-setup.ts) removes any wire on it first. */
  removeDynamicOutputAt(index: number): void {
    this.removeOutput(`${this.descriptor.dynamicOutputs!.namePrefix}${index}`);
  }

  /** Resizes the pill to fit `count` dynamic outputs. */
  setDynamicOutputHeight(count: number): void {
    this.height = NODE_HEIGHT + Math.max(0, count - 1) * this.descriptor.dynamicOutputs!.rowHeightPx;
  }

  /** Re-resolves every output socket from the current properties -- for a port whose `type` is a
   * function of properties (inject/startup's `payloadType`). Called from the property panel when a
   * field marked `retype` changes. */
  retypeOutputs(): void {
    for (const output of this.descriptor.ports?.outputs ?? []) {
      const port = this.outputs[output.name];
      if (port) port.socket = portSocket(this.descriptor.ports?.outputs, output.name, this.properties);
    }
  }
}

/** A built-in subclass fixed to one descriptor at class-build time. */
function buildDescriptorNodeClass(descriptor: NodeDescriptor) {
  return class extends DescriptorNode {
    constructor() {
      super(descriptor);
    }
  };
}

// First family migrated onto the canonical descriptor (its data now lives in node-library/debug.ts).
// The class name is kept because tests and AnyThingstudioNode reference it.
export class DebugNode extends buildDescriptorNodeClass(debugCoreDescriptor) {}

export class DelayNode extends buildDescriptorNodeClass(delayCoreDescriptor) {}

export class InjectNode extends buildDescriptorNodeClass(injectNode) {}

export class FunctionNode extends buildDescriptorNodeClass(functionNode) {}

export class StartupNode extends buildDescriptorNodeClass(startupNode) {}

export class GpioOutNode extends buildDescriptorNodeClass(gpioOutCoreDescriptor) {}

// Given canvas presence 2026-09-06 (outstanding-items/canvas-presence-
// gaps.md) -- previously registry-only since introduction, same batch as
// variable_get/variable_set (which got the same treatment, then were
// hidden again the same day -- see this file's own note a few lines up).
// Sink kind, one input -- same single-port shape as GpioOutNode just
// above, `duty` named for what it actually carries (pwm-out.ts's own
// header explains the naming choice).
export class PwmOutNode extends buildDescriptorNodeClass(pwmOutCoreDescriptor) {}

export class TimerNode extends buildDescriptorNodeClass(timerCoreDescriptor) {}

export class TouchI2cNode extends buildDescriptorNodeClass(touchI2cNode) {}

export class I2cNode extends buildDescriptorNodeClass(i2cCoreDescriptor) {}

export class Bme280Node extends buildDescriptorNodeClass(bme280CoreDescriptor) {}

export class NtpNode extends buildDescriptorNodeClass(ntpNode) {}

export class UdpSendNode extends buildDescriptorNodeClass(udpSendCoreDescriptor) {}

export class UdpReceiveNode extends buildDescriptorNodeClass(udpReceiveCoreDescriptor) {}

export class HttpRequestNode extends buildDescriptorNodeClass(httpRequestCoreDescriptor) {}

export class HttpInNode extends buildDescriptorNodeClass(httpInNode) {}

export class HttpResponseNode extends buildDescriptorNodeClass(httpResponseCoreDescriptor) {}

export class MqttPublishNode extends buildDescriptorNodeClass(mqttPublishNode) {}

export class MqttSubscribeNode extends buildDescriptorNodeClass(mqttSubscribeNode) {}

export class InterruptNode extends buildDescriptorNodeClass(interruptCoreDescriptor) {}

export class EswitchNode extends buildDescriptorNodeClass(eswitchCoreDescriptor) {}

export class EbuttonNode extends buildDescriptorNodeClass(ebuttonCoreDescriptor) {}

export class AdcNode extends buildDescriptorNodeClass(adcNode) {}

export class EncoderNode extends buildDescriptorNodeClass(encoderCoreDescriptor) {}

export class NeopixelNode extends buildDescriptorNodeClass(neopixelCoreDescriptor) {}

export class FilterNode extends buildDescriptorNodeClass(filterCoreDescriptor) {}

export class JournalNode extends buildDescriptorNodeClass(journalCoreDescriptor) {}

export class WifiStatusNode extends buildDescriptorNodeClass(wifiStatusCoreDescriptor) {}

export class WifiGateNode extends buildDescriptorNodeClass(wifiGateCoreDescriptor) {}

export class DisplaySpiNode extends buildDescriptorNodeClass(displaySpiNode) {}

export class DisplayI2cNode extends buildDescriptorNodeClass(displayI2cCoreDescriptor) {}

export class GuiScreenNode extends buildDescriptorNodeClass(guiScreenNode) {}

export class GuiLabelNode extends buildDescriptorNodeClass(guiLabelNode) {}

export class GuiReadoutNode extends buildDescriptorNodeClass(guiReadoutNode) {}

export class GuiBarNode extends buildDescriptorNodeClass(guiBarNode) {}

export class GuiTrendNode extends buildDescriptorNodeClass(guiTrendNode) {}

export class GuiLedNode extends buildDescriptorNodeClass(guiLedNode) {}

export class GuiButtonNode extends buildDescriptorNodeClass(guiButtonNode) {}

export class GuiNavigatorNode extends buildDescriptorNodeClass(guiNavigatorNode) {}

export class GuiModalNode extends buildDescriptorNodeClass(guiModalNode) {}

// The GPIO cluster -- interrupt/eswitch/ebutton/adc/encoder/neopixel -- is descriptor-driven
// (buildDescriptorNodeClass below). Their defaults match each node-library file's own codegen
// fallbacks (the invariant every hardware node class here followed).

// display_spi/display_i2c (node-library/display-spi.ts, display-i2c.ts) are descriptor-driven
// (buildDescriptorNodeClass below); their panels use PresetRefField (presetType) and, for display_spi,
// the PaletteField palette editor.

// The network family -- udp_send/udp_receive/http_request/http_in/http_response/mqtt_publish/
// mqtt_subscribe, plus wifi_status (a source with a real wifiConfigId) and wifi_gate (a pass-or-drop
// transform with no properties) -- is descriptor-driven (buildDescriptorNodeClass below). Their panels
// show the flow's WiFi config as an info-only field (the config is a flow singleton, not a node property).

// --- Custom nodes (docs/working-notes/custom-node-authoring-scoping.md) ---
//
// A loaded custom type is the same `DescriptorNode` a built-in is -- one class for every custom type,
// since the descriptor is passed per instance rather than fixed at class-build time. `kind` is the
// literal "custom" (DescriptorNode's own fallback when the descriptor has no `paletteId`), not the
// descriptor's own "source"/"transform"/"sink": PropertyPanel.vue and the palette treat "custom" as its
// own UI shape regardless of the compiler kind. `nodeType` carries the real, unprefixed type id (e.g.
// "custom/dht22"), which is what makes graph-adapter.ts/main.ts's read of `n.nodeType` work uniformly
// across first-party and custom nodes without a branch.
export class CustomNode extends DescriptorNode {
  // Custom packages have no `width` today, so keep them a little wider than the base default (100) --
  // a user-chosen label is likelier to be long. Drop this once the format carries `width`.
  width = 128;
  constructor(descriptor: CustomNodeDescriptor) {
    super(descriptor);
  }
}

// Every node class above is a DescriptorNode; the concrete subclasses exist only for `instanceof`
// checks (InjectNode's fire target) and node-library tests, so the union is just the base.
export type AnyThingstudioNode = DescriptorNode;

// One constructor per palette kind, shared between the app-shell's
// click-to-add/drag-drop handler (main.ts) and applyFlowFile()'s per-node
// loop (main.ts, Phase 3 item 11) -- both need "make me a fresh node of
// kind X" and neither should hardcode its own copy of this switch. Keyed
// by NodeKind (palette.ts), not the registry's `thingstudio/`-prefixed
// type string, since that prefix-stripping is the caller's job (main.ts
// does it once, from a flow file's saved `type` field). Custom nodes are
// deliberately NOT in this table -- constructing one needs a
// CustomNodeDescriptor, which NODE_FACTORIES' zero-argument factory shape
// has no room for; main.ts branches on "is this a loaded custom type"
// separately and calls `new CustomNode(descriptor)` directly.
export const NODE_FACTORIES: Record<NodeKind, () => AnyThingstudioNode> = {
  inject: () => new InjectNode(),
  startup: () => new StartupNode(),
  function: () => new FunctionNode(),
  debug: () => new DebugNode(),
  gpio_out: () => new GpioOutNode(),
  pwm_out: () => new PwmOutNode(),
  timer: () => new TimerNode(),
  interrupt: () => new InterruptNode(),
  eswitch: () => new EswitchNode(),
  ebutton: () => new EbuttonNode(),
  adc: () => new AdcNode(),
  encoder: () => new EncoderNode(),
  neopixel: () => new NeopixelNode(),
  display_spi: () => new DisplaySpiNode(),
  display_i2c: () => new DisplayI2cNode(),
  wifi_status: () => new WifiStatusNode(),
  wifi_gate: () => new WifiGateNode(),
  udp_send: () => new UdpSendNode(),
  udp_receive: () => new UdpReceiveNode(),
  http_request: () => new HttpRequestNode(),
  http_in: () => new HttpInNode(),
  http_response: () => new HttpResponseNode(),
  mqtt_publish: () => new MqttPublishNode(),
  mqtt_subscribe: () => new MqttSubscribeNode(),
  delay: () => new DelayNode(),
  filter: () => new FilterNode(),
  bme280: () => new Bme280Node(),
  touch_i2c: () => new TouchI2cNode(),
  i2c: () => new I2cNode(),
  gui_screen: () => new GuiScreenNode(),
  gui_label: () => new GuiLabelNode(),
  gui_readout: () => new GuiReadoutNode(),
  gui_bar: () => new GuiBarNode(),
  gui_trend: () => new GuiTrendNode(),
  journal: () => new JournalNode(),
  ntp: () => new NtpNode(),
  gui_led: () => new GuiLedNode(),
  gui_button: () => new GuiButtonNode(),
  gui_navigator: () => new GuiNavigatorNode(),
  gui_modal: () => new GuiModalNode(),
};
