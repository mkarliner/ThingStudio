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
//   - timer:        intervalMs                                (node-library/timer.ts)
//   - interrupt:    pin, edge, debounce, debounceMs           (node-library/interrupt.ts)
//   - eswitch:      pin, lopen, debounceMs                     (node-library/eswitch.ts, 2026-09-17)
//   - ebutton:      pin, suppress, senseMode, debounceMs, longPressMs, doubleClickMs (node-library/ebutton.ts, 2026-09-17)
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
// for all 9 classes here, but wrong for a loaded custom node type (own
// namespace, e.g. "custom/dht22", no relationship to `kind`). Zero
// behavior change for the 9 classes below: `nodeType` is set to exactly
// what the old concatenation already produced, verified against the
// existing test suite. `CustomNode` (bottom of this file) is the new,
// generic, descriptor-driven class this work actually adds -- one class
// for every loaded custom type instead of one hand-written subclass per
// type, closing the "keep hand-writing a Litegraph/Rete subclass per node
// type, or move to a data-driven descriptor consumed by one generic node
// class" question node-definition-model.md flagged as open back at POC
// time and never revisited since (the 9 first-party classes below simply
// never grew past hand-writing being cheap enough not to bother).
// First-party classes are deliberately left as hand-written subclasses,
// not migrated onto the generic path -- no reason to touch 9 already
// hardware-validated node classes for symmetry alone.
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
import { debugNode } from "../../node-library/debug.js";
import { gpioOutNode } from "../../node-library/gpio-out.js";
import { timerNode } from "../../node-library/timer.js";
import { interruptNode } from "../../node-library/interrupt.js";
import { eswitchNode } from "../../node-library/eswitch.js";
import { ebuttonNode } from "../../node-library/ebutton.js";
import { wifiStatusNode } from "../../node-library/wifi-status.js";
import { wifiGateNode } from "../../node-library/wifi-gate.js";
import { udpSendNode } from "../../node-library/udp-send.js";
import { udpReceiveNode } from "../../node-library/udp-receive.js";
import { httpRequestNode } from "../../node-library/http-request.js";
import { httpInNode } from "../../node-library/http-in.js";
import { httpResponseNode } from "../../node-library/http-response.js";
import { delayNode } from "../../node-library/delay.js";
import { filterNode, type FilterMode } from "../../node-library/filter.js";
import { bme280Node } from "../../node-library/bme280.js";
import { touchI2cNode } from "../../node-library/touch-i2c.js";
import type { NodeDefinition } from "../../compiler/node-definition.js";
import { guiBarNode, guiButtonNode, guiLabelNode, guiLedNode, guiModalNode, guiNavigatorNode, guiReadoutNode, guiScreenNode } from "../../node-library/gui.js";
import { i2cGenericNode } from "../../node-library/i2c-generic.js";
import { mqttPublishNode } from "../../node-library/mqtt-publish.js";
import { mqttSubscribeNode } from "../../node-library/mqtt-subscribe.js";
import { pwmOutNode } from "../../node-library/pwm-out.js";
import { displaySpiNode } from "../../node-library/display-spi.js";
import { displayI2cNode } from "../../node-library/display-i2c.js";
import { resolvePortType, type PortDefinition } from "../../compiler/node-definition.js";
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
export class InjectNode extends ClassicPreset.Node {
  width = 96;
  height = NODE_HEIGHT;
  kind = "inject" as const;
  nodeType = "thingstudio/inject";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // Behavior change, 2026-09-02 (inject click-only live-fire feature,
  // node-library/inject.ts's own header): `repeat` is gone -- inject fires
  // only on a real §13 TRIGGER (a canvas click while live-connected,
  // main.ts), never on a timer.
  properties: { payloadType: "bool" | "number" | "string"; payloadValue: string } = {
    payloadType: "bool",
    payloadValue: "true",
  };

  constructor() {
    super("inject");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(injectNode.ports?.outputs, "msg", this.properties), "msg"));
  }

  // Swaps the output socket for the one matching the current
  // `payloadType` property -- poc-rete's InjectNode.retypeOutput()
  // (pocs/poc-rete/src/nodes.ts), ported onto the real coercion-aware
  // socket classes instead of that spike's strict same-class ones.
  // PropertyPanel.vue calls this from the payload-type select's `@change`
  // (the constructor above only sets the *initial* socket, same gap
  // poc-rete's own version existed to close).
  //
  // Deliberately does NOT drop or flag any now-invalid existing
  // connection a retype might produce. wire-type-system-scoping.md's
  // question 3 resolved what that behavior *should* eventually be (drop
  // the wire, flag the drop via the `highlighted` mechanism above) but
  // also that it's currently unreachable in practice: gpio_out's `signal`
  // is the only concretely-typed input on today's 5-node canvas, and
  // "anything -> bool" is unconditionally allowed (sockets.ts, bucket 1)
  // -- no payloadType change can produce a wire this app would ever need
  // to drop yet. Recording that as intent here, not building it blind:
  // add the drop-and-flag behavior when a non-bool-typed input actually
  // lands on the canvas (one of the other 11 node-library/registry.ts
  // types), not before.
  retypeOutput(): ClassicPreset.Socket {
    const socket = portSocket(injectNode.ports?.outputs, "msg", this.properties);
    this.outputs.msg!.socket = socket;
    return socket;
  }
}

// Fires once at flow start: right after a DEPLOY, and after a reset that
// resumes the saved flow (listener.py's _resume_flow). Same properties and
// dynamic output socket as InjectNode, but no click-to-fire.
// node-library/startup.ts has the design story.
export class StartupNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "startup" as const;
  nodeType = "thingstudio/startup";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // "reason": the payload is why the flow started (node-library/startup.ts); payloadValue is unused.
  properties: { payloadType: "bool" | "number" | "string" | "reason"; payloadValue: string } = {
    payloadType: "bool",
    payloadValue: "true",
  };

  constructor() {
    super("startup");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(startupNode.ports?.outputs, "msg", this.properties), "msg"));
  }

  /** Same as InjectNode.retypeOutput(). */
  retypeOutput(): ClassicPreset.Socket {
    const socket = portSocket(startupNode.ports?.outputs, "msg", this.properties);
    this.outputs.msg!.socket = socket;
    return socket;
  }
}

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
export function functionOutputKey(index: number): string {
  return `out${index}`;
}

// Grows the pill with output count rather than packing ports tighter into
// a fixed height (Mike's call, 2026-09-12, over CustomNode's existing
// "pack into NODE_HEIGHT regardless of count" precedent for inputs --
// legible at a function node's realistic 2-4 output range matters more
// here than staying pixel-uniform with every other node type). 18px/row
// is comfortably wider than ThingstudioNode.vue's own 10px SOCKET_SIZE,
// leaving real spacing between adjacent output dots instead of just
// clearing overlap.
const FUNCTION_OUTPUT_ROW_HEIGHT = 18;
export function functionNodeHeight(outputCount: number): number {
  return NODE_HEIGHT + Math.max(0, outputCount - 1) * FUNCTION_OUTPUT_ROW_HEIGHT;
}

export class FunctionNode extends ClassicPreset.Node {
  width = 100;
  height = NODE_HEIGHT;
  kind = "function" as const;
  nodeType = "thingstudio/function";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // `outputCount` (multi-output-port support, outstanding-items/
  // connection-state-gate-router-nodes.md, 2026-09-12): defaults to 1,
  // matching every function node saved before this property existed.
  // Kept in `properties`, not a separate field, so it round-trips through
  // the flow file the same way every other node property already does --
  // no flow-file-format change needed, same "reuse the existing
  // properties bag" precedent config nodes already established
  // (config-node-and-palette-implementation-briefing.md).
  properties: { code: string; outputCount: number } = {
    code: "msg['payload'] = msg['payload']\nreturn msg\n",
    outputCount: 1,
  };

  constructor() {
    super("function");
    this.addInput("msg", new ClassicPreset.Input(portSocket(functionNode.ports?.inputs, "msg", this.properties), "msg", true));
    for (let i = 0; i < this.properties.outputCount; i++) {
      this.addOutput(functionOutputKey(i), new ClassicPreset.Output(portSocket(functionNode.ports?.outputs, "msg", this.properties), String(i + 1)));
    }
  }
}

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

export class DelayNode extends ClassicPreset.Node {
  width = 100;
  height = NODE_HEIGHT;
  kind = "delay" as const;
  nodeType = "thingstudio/delay";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { delayMs: number } = {
    delayMs: 1000,
  };

  constructor() {
    super("delay");
    this.addInput("msg", new ClassicPreset.Input(portSocket(delayNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(delayNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// Drops messages that aren't worth sending: unchanged, inside a deadband, or too soon
// (node-library/filter.ts).
export class FilterNode extends ClassicPreset.Node {
  width = 100;
  height = NODE_HEIGHT;
  kind = "filter" as const;
  nodeType = "thingstudio/filter";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { mode: FilterMode; threshold: number; intervalMs: number; ignoreFirst: boolean; perTopic: boolean } = {
    mode: "change",
    threshold: 1,
    intervalMs: 1000,
    ignoreFirst: false,
    perTopic: true,
  };

  constructor() {
    super("filter");
    this.addInput("msg", new ClassicPreset.Input(portSocket(filterNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(filterNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// BME280/BMP280 sensor on a shared I2C bus (node-library/bme280.ts).
export class Bme280Node extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "bme280" as const;
  nodeType = "thingstudio/bme280";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { i2cConfigId: string; address: number; intervalMs: number } = {
    i2cConfigId: "",
    address: 0x76,
    intervalMs: 5000,
  };

  constructor() {
    super("bme280");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(bme280Node.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// Touch panel (FT6336U) on a shared I2C bus (node-library/touch-i2c.ts).
export class TouchI2cNode extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "touch_i2c" as const;
  nodeType = "thingstudio/touch_i2c";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { touchPanelConfigId: string } = { touchPanelConfigId: "" };

  constructor() {
    super("touch");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(touchI2cNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// GUI nodes (node-library/gui.ts, 2026-10-08). Where widgets sit is the flow's `screens` section, not a node
// property; these hold only data properties (range, units, how long until stale).
function guiClass<K extends string, P extends Record<string, unknown>>(kind: K, nodeType: string, width: number, props: () => P, def: NodeDefinition, hasInput: boolean, outputName: string | null) {
  return class extends ClassicPreset.Node {
    width = width;
    height = NODE_HEIGHT;
    kind = kind;
    nodeType = nodeType;
    highlighted = false;
    status: NodeStatusState | null = null;
    statusText: string | null = null;
    properties: P = props();

    constructor() {
      super(kind);
      if (hasInput) this.addInput("msg", new ClassicPreset.Input(portSocket(def.ports?.inputs, "msg", this.properties), "msg", true));
      if (outputName) this.addOutput(outputName, new ClassicPreset.Output(portSocket(def.ports?.outputs, outputName, this.properties), outputName));
    }
  };
}

export const GuiScreenNode = guiClass("gui_screen", "thingstudio/gui_screen", 110, () => ({ name: "screen", width: 320, height: 240, frameFormat: "gs4" as "gs4" | "gs2" | "mono" | "rgb565", minInterval: 200, wrap: true, touchPanelConfigId: "" }), guiScreenNode, false, "frame");
export const GuiLabelNode = guiClass("gui_label", "thingstudio/gui_label", 100, () => ({ name: "", maxChars: 8, staleAfter: 0 }), guiLabelNode, true, null);
export const GuiReadoutNode = guiClass("gui_readout", "thingstudio/gui_readout", 110, () => ({ name: "", units: "", decimals: 1, lo: 0, hi: 100, staleAfter: 0 }), guiReadoutNode, true, null);
export const GuiBarNode = guiClass("gui_bar", "thingstudio/gui_bar", 90, () => ({ name: "", lo: 0, hi: 100, staleAfter: 0 }), guiBarNode, true, null);
export const GuiLedNode = guiClass("gui_led", "thingstudio/gui_led", 90, () => ({ name: "", staleAfter: 0 }), guiLedNode, true, null);
export const GuiButtonNode = guiClass(
  "gui_button",
  "thingstudio/gui_button",
  100,
  () => ({
    name: "",
    mode: "momentary" as "momentary" | "toggle" | "navigate",
    text: "",
    maxChars: 8,
    valueType: "bool" as "bool" | "string" | "number",
    value: "true",
    onValue: "true",
    offValue: "false",
    onText: "ON",
    offText: "OFF",
    initial: false,
    fireOn: "release" as "release" | "press",
    target: "",
    pendingTimeout: 5,
  }),
  guiButtonNode,
  true,
  "msg",
);
export const GuiNavigatorNode = guiClass("gui_navigator", "thingstudio/gui_navigator", 120, () => ({ name: "navigator", screen: "" }), guiNavigatorNode, true, "page");
export const GuiModalNode = guiClass("gui_modal", "thingstudio/gui_modal", 100, () => ({ name: "", screen: "", priority: 0, timeout: 0 }), guiModalNode, true, "msg");

// Generic I2C read/write/scan on a shared bus (node-library/i2c-generic.ts). address/register are text so hex
// ("0x29") can be typed; the compiler parses them.
export class I2cNode extends ClassicPreset.Node {
  width = 90;
  height = NODE_HEIGHT;
  kind = "i2c" as const;
  nodeType = "thingstudio/i2c";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { i2cConfigId: string; operation: "read" | "write" | "scan"; address: string; register: string; length: number } = {
    i2cConfigId: "",
    operation: "read",
    address: "",
    register: "",
    length: 1,
  };

  constructor() {
    super("i2c");
    this.addInput("msg", new ClassicPreset.Input(portSocket(i2cGenericNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(i2cGenericNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class DebugNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "debug" as const;
  nodeType = "thingstudio/debug";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // `fullMessage` added 2026-09-09 (wifi-status-completeness.md): opt-in,
  // default `false` -- see node-library/debug.ts's own header for why.
  properties: { fullMessage: boolean } = { fullMessage: false };

  constructor() {
    super("debug");
    this.addInput("msg", new ClassicPreset.Input(portSocket(debugNode.ports?.inputs, "msg", this.properties), "msg", true));
  }
}

export class GpioOutNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "gpio_out" as const;
  nodeType = "thingstudio/gpio_out";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // Default 12 -- matches app/nodes.ts's GpioOutNode (LuatOS ESP32-C3 test
  // board's visible onboard LED).
  properties: { pin: number } = { pin: 12 };

  constructor() {
    super("gpio out");
    this.addInput("signal", new ClassicPreset.Input(portSocket(gpioOutNode.ports?.inputs, "signal", this.properties), "signal", true));
  }
}

// Given canvas presence 2026-09-06 (outstanding-items/canvas-presence-
// gaps.md) -- previously registry-only since introduction, same batch as
// variable_get/variable_set (which got the same treatment, then were
// hidden again the same day -- see this file's own note a few lines up).
// Sink kind, one input -- same single-port shape as GpioOutNode just
// above, `duty` named for what it actually carries (pwm-out.ts's own
// header explains the naming choice).
export class PwmOutNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "pwm_out" as const;
  nodeType = "thingstudio/pwm_out";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { pin: number; freq: number } = { pin: 12, freq: 1000 };

  constructor() {
    super("pwm out");
    this.addInput("duty", new ClassicPreset.Input(portSocket(pwmOutNode.ports?.inputs, "duty", this.properties), "duty", true));
  }
}

export class TimerNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "timer" as const;
  nodeType = "thingstudio/timer";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { intervalMs: number } = { intervalMs: 1000 };

  constructor() {
    super("timer");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(timerNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class InterruptNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "interrupt" as const;
  nodeType = "thingstudio/interrupt";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // Defaults match interrupt.ts's own codegen defaults exactly (edge
  // "rising", debounce true, debounceMs 50) -- a freshly-dropped node's
  // properties and a freshly-omitted property on a hand-edited flow file
  // should compile to the same thing.
  properties: { pin: number; edge: "rising" | "falling" | "both"; debounce: boolean; debounceMs: number } = {
    pin: 4,
    edge: "rising",
    debounce: true,
    debounceMs: 50,
  };

  constructor() {
    super("interrupt");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(interruptNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// eswitch/ebutton added 2026-09-17 -- eswitch.ts/ebutton.ts's own headers
// have the full design story (wrapping Peter Hinch's ESwitch/EButton,
// topic-carries-event-identity single output). Defaults here match each
// file's own codegen defaults exactly, same invariant InterruptNode's own
// comment states just above.
export class EswitchNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "eswitch" as const;
  nodeType = "thingstudio/eswitch";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { pin: number; lopen: 0 | 1; debounceMs: number; pull: "none" | "up" | "down" } = {
    pin: 4,
    lopen: 1,
    debounceMs: 50,
    pull: "none",
  };

  constructor() {
    super("eswitch");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(eswitchNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class EbuttonNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "ebutton" as const;
  nodeType = "thingstudio/ebutton";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: {
    pin: number;
    suppress: boolean;
    senseMode: "auto" | "0" | "1";
    debounceMs: number;
    longPressMs: number;
    doubleClickMs: number;
    pull: "none" | "up" | "down";
  } = {
    pin: 5,
    suppress: false,
    senseMode: "auto",
    debounceMs: 50,
    longPressMs: 1000,
    doubleClickMs: 400,
    pull: "none",
  };

  constructor() {
    super("ebutton");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(ebuttonNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// display_spi/display_i2c added 2026-09-17 -- framebuffer-display-node-
// scoping.md's converged design (Mike's steer): two node families split
// by bus (SPI/I2C), each taking a single pre-rendered framebuf-format
// `frame` (bytes) input and pushing it to a vendored driver
// (display-spi.ts/display-i2c.ts's own headers have the full design
// story, including the VENDOR_FILES scaling concern this design tracks
// but doesn't solve). Defaults here match each file's own codegen
// defaults exactly, same invariant every other hardware node class in
// this file follows -- a freshly-dropped node's properties and a
// freshly-omitted property on a hand-edited flow file should compile to
// the same thing. `cs`/`reset`/`backlight` default to -1 (display-spi.ts's
// "not wired" sentinel, not a Thingstudio-specific convention -- see that
// file's header).
export class DisplaySpiNode extends ClassicPreset.Node {
  width = 128;
  height = NODE_HEIGHT;
  kind = "display_spi" as const;
  nodeType = "thingstudio/display_spi";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: {
    controller: "st7789" | "st7796";
    frameFormat: "rgb565" | "gs4" | "gs2" | "mono";
    palette: number[];
    spiBus: number;
    baudrate: number;
    sck: number;
    mosi: number;
    dc: number;
    cs: number;
    reset: number;
    backlight: number;
    width: number;
    height: number;
    rotation: number;
    colorOrder: "rgb" | "bgr";
    invertColors: boolean;
    dataLatchOrder: boolean;
    xstart: number;
    ystart: number;
  } = {
    controller: "st7789",
    // frameFormat/palette added 2026-09-18 (display-spi.ts's own header
    // has the full story) -- "rgb565" is the default so a freshly-dropped
    // node still compiles identically to before this property existed,
    // same invariant this class's own header comment states. gs2/mono
    // (also 2026-09-18, same day) widen the union but don't change this
    // default. DEFAULT_PALETTE_GS4 (display-spi.ts) is mirrored here
    // rather than imported -- this file already duplicates other codegen
    // defaults (e.g. rotation/xstart/ystart) rather than importing them,
    // same pattern.
    frameFormat: "rgb565",
    palette: [
      0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0x07ff, 0xf81f, 0x8410, 0x4208, 0xc618, 0xfd20, 0x8000, 0x0400, 0x0010, 0x0410,
    ],
    spiBus: 2,
    baudrate: 40000000,
    sck: 12,
    mosi: 11,
    dc: 13,
    cs: -1,
    reset: -1,
    backlight: -1,
    width: 135,
    height: 240,
    rotation: 0,
    // colorOrder/invertColors/dataLatchOrder added 2026-09-22, closing the
    // PropertyPanel.vue gap MVP item 5 named explicitly ("colorOrder,
    // invertColors, dataLatchOrder are missing today") -- picked up
    // alongside the presets work (docs/working-notes/outstanding-items/
    // presets-design.md) since a "save this display's SPI setup as a
    // preset" feature is a lot less useful if three of its real properties
    // can't be seen or set from the panel that's doing the saving. Values
    // match display-spi.ts's own codegen fallback defaults exactly (its
    // `?? "bgr"` / `=== undefined ? false` / `=== undefined ? true`), same
    // "a freshly-dropped node and a freshly-omitted flow-file property
    // compile to the same thing" invariant this class's own header states
    // -- NOT the CYD-tuned `rotation: 1` default that same header
    // paragraph in display-spi.ts also mentions; this class's `rotation: 0`
    // above predates that CYD default change and is left alone here, out
    // of scope for this change.
    colorOrder: "bgr",
    invertColors: false,
    dataLatchOrder: true,
    xstart: -1,
    ystart: -1,
  };

  constructor() {
    super("display spi");
    this.addInput("frame", new ClassicPreset.Input(portSocket(displaySpiNode.ports?.inputs, "frame", this.properties), "frame", true));
  }
}

export class DisplayI2cNode extends ClassicPreset.Node {
  width = 128;
  height = NODE_HEIGHT;
  kind = "display_i2c" as const;
  nodeType = "thingstudio/display_i2c";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // Bus, pins and clock live in a shared I2C bus config (node-library/i2c-shared.ts, 2026-09-26).
  properties: {
    controller: "ssd1306";
    i2cConfigId: string;
    addr: number;
    width: number;
    height: number;
  } = {
    controller: "ssd1306",
    i2cConfigId: "",
    addr: 0x3c,
    width: 128,
    height: 64,
  };

  constructor() {
    super("display i2c");
    this.addInput("frame", new ClassicPreset.Input(portSocket(displayI2cNode.ports?.inputs, "frame", this.properties), "frame", true));
  }
}

export class WifiStatusNode extends ClassicPreset.Node {
  width = 120;
  height = NODE_HEIGHT;
  kind = "wifi_status" as const;
  nodeType = "thingstudio/wifi_status";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // wifiConfigId: "" means "no config referenced" -- resolveWifiCredentials()'s
  // own contract (wifi-status.ts), same "empty string sentinel, not
  // undefined" convention as every other string property already on this
  // canvas (e.g. gpio_out has no string property, but inject's
  // payloadValue defaults to a real value, never undefined -- properties
  // objects on this canvas are always fully populated, never partial).
  properties: { pollMs: number; wifiConfigId: string } = { pollMs: 5000, wifiConfigId: "" };

  constructor() {
    super("wifi status");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(wifiStatusNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// Pass-or-drop WiFi link gate, built 2026-09-14 (wifi-gate.ts's own header
// has the full scope story): a transform, not a source/sink, so it needs
// both an input and an output port like DelayNode/FunctionNode above --
// unlike WifiStatusNode (a pure source) it sits mid-flow. No configurable
// properties (same "no properties" shape as HttpResponseNode above) --
// it derives its WiFi config from the flow's own sole wifi_status node,
// same as UdpSendNode/UdpReceiveNode below.
export class WifiGateNode extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "wifi_gate" as const;
  nodeType = "thingstudio/wifi_gate";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: Record<string, never> = {};

  constructor() {
    super("wifi gate");
    this.addInput("msg", new ClassicPreset.Input(portSocket(wifiGateNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(wifiGateNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class UdpSendNode extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "udp_send" as const;
  nodeType = "thingstudio/udp_send";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { host: string; port: number; timeoutMs: number } = {
    host: "",
    port: 9999,
    timeoutMs: 2000,
  };

  constructor() {
    super("udp send");
    this.addInput("msg", new ClassicPreset.Input(portSocket(udpSendNode.ports?.inputs, "msg", this.properties), "msg", true));
  }
}

export class UdpReceiveNode extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "udp_receive" as const;
  nodeType = "thingstudio/udp_receive";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: { port: number; pollMs: number } = {
    port: 9998,
    pollMs: 20,
  };

  constructor() {
    super("udp receive");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(udpReceiveNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class HttpRequestNode extends ClassicPreset.Node {
  width = 130;
  height = NODE_HEIGHT;
  kind = "http_request" as const;
  nodeType = "thingstudio/http_request";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // Defaults match http-request.ts's own codegen defaults exactly (GET,
  // 5000ms timeout) -- a freshly-dropped node and a freshly-omitted
  // property on a hand-edited flow file compile the same, same
  // convention every other class here follows. url has no sensible
  // non-empty default (unlike udp_send's own empty-string host, which at
  // least compiles to a CompileError with the same message either way) --
  // parseHttpUrl (http-request.ts) already rejects an empty url with a
  // clear CompileError, so "" here just reaches that same error path
  // immediately rather than needing its own placeholder check.
  properties: { url: string; method: "GET" | "POST"; timeoutMs: number } = {
    url: "",
    method: "GET",
    timeoutMs: 5000,
  };

  constructor() {
    super("http request");
    this.addInput("msg", new ClassicPreset.Input(portSocket(httpRequestNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(httpRequestNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// http_in/http_response added 2026-09-08 (outstanding-items.md's "HTTP
// in / HTTP response nodes" P3 MVP item; http-server-shared.ts's own
// header has the full architecture and v1 scope cuts -- exact
// (method, path) match only, no :name params, no body-to-payload
// parsing). http_in is a source (one output, fires on a real matching
// inbound HTTP request); http_response is a sink (one input, completes
// whichever request the msg came from). Given real canvas presence from
// the start -- no registry-only interim period, unlike http_request's
// own history (this file's header table).
export class HttpInNode extends ClassicPreset.Node {
  width = 120;
  height = NODE_HEIGHT;
  kind = "http_in" as const;
  nodeType = "thingstudio/http_in";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // Defaults match http-server-shared.ts's own codegen defaults exactly
  // (GET, 10000ms response timeout) -- a freshly-dropped node and a
  // freshly-omitted property on a hand-edited flow file compile the same,
  // same convention every other class here follows. path "/" is a valid,
  // real route (unlike http_request's url, which has no sensible non-empty
  // default) -- kept as the default anyway since a flow author still needs
  // to pick their own path deliberately.
  properties: { port: number; path: string; method: "GET" | "POST"; responseTimeoutMs: number } = {
    port: 8080,
    path: "/",
    method: "GET",
    responseTimeoutMs: 10000,
  };

  constructor() {
    super("http in");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(httpInNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class HttpResponseNode extends ClassicPreset.Node {
  width = 130;
  height = NODE_HEIGHT;
  kind = "http_response" as const;
  nodeType = "thingstudio/http_response";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // No properties -- status/body come from msg.statusCode/msg.payload at
  // runtime (Node-RED's own field names), matching this node's own
  // codegen (http-response.ts). Same "no configurable properties" shape
  // as DebugNode above.
  properties: Record<string, never> = {};

  constructor() {
    super("http response");
    this.addInput("msg", new ClassicPreset.Input(portSocket(httpResponseNode.ports?.inputs, "msg", this.properties), "msg", true));
  }
}

export class MqttPublishNode extends ClassicPreset.Node {
  width = 128;
  height = NODE_HEIGHT;
  kind = "mqtt_publish" as const;
  nodeType = "thingstudio/mqtt_publish";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // brokerConfigId: "" sentinel, same convention as WifiStatusNode's own
  // wifiConfigId. Just one config reference now, not two -- this class's
  // own wifiConfigId was removed 2026-09-04 (this file's header
  // paragraph); the WiFi network now comes from the flow's own
  // wifi_status node instead (mqtt-shared.ts's header). retain defaults
  // false / qos defaults 0, matching mqtt-publish.ts's own
  // Number(...??...) defaults exactly (a freshly-dropped node and a
  // freshly-omitted property on a hand-edited flow file compile the same).
  properties: { topic: string; retain: boolean; qos: 0 | 1; brokerConfigId: string } = {
    topic: "",
    retain: false,
    qos: 0,
    brokerConfigId: "",
  };

  constructor() {
    super("mqtt publish");
    this.addInput("msg", new ClassicPreset.Input(portSocket(mqttPublishNode.ports?.inputs, "msg", this.properties), "msg", true));
  }
}

export class MqttSubscribeNode extends ClassicPreset.Node {
  width = 132;
  height = NODE_HEIGHT;
  kind = "mqtt_subscribe" as const;
  nodeType = "thingstudio/mqtt_subscribe";
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  // brokerConfigId: "" sentinel -- wifiConfigId removed 2026-09-04, see
  // MqttPublishNode's own comment above (identical reasoning).
  properties: { topic: string; qos: 0 | 1; brokerConfigId: string } = {
    topic: "",
    qos: 0,
    brokerConfigId: "",
  };

  constructor() {
    super("mqtt subscribe");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(mqttSubscribeNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

// --- Custom nodes (docs/working-notes/custom-node-authoring-scoping.md) ---
//
// One generic class for every loaded custom node type, instead of a
// hand-written subclass per type -- driven entirely by the type's
// CustomNodeDescriptor (custom-node.ts), loaded at runtime from a
// `.node.json`/`.node.py` package (custom-node-io.ts), never known about
// at editor-build time. `kind` here is deliberately the *literal* string
// "custom", not the descriptor's own `kind` ("source"/"transform"/"sink")
// -- PropertyPanel.vue and palette.ts both switch on `.kind` to mean "which
// UI shape," and "custom" is its own single UI shape (a generic
// descriptor-driven form) regardless of which of the three compiler kinds
// the underlying node actually is. `nodeType` is the thing that carries
// the real, descriptor-declared, unprefixed type id (e.g. "custom/dht22")
// -- exactly the field every other class above now carries too, which is
// what makes graph-adapter.ts/main.ts's read of `n.nodeType` work
// uniformly across first-party and custom nodes without a branch.
export class CustomNode extends ClassicPreset.Node {
  width = 128;
  height = NODE_HEIGHT;
  kind = "custom" as const;
  nodeType: string;
  descriptor: CustomNodeDescriptor;
  highlighted = false;
  status: NodeStatusState | null = null;
  statusText: string | null = null;

  properties: Record<string, unknown>;

  constructor(descriptor: CustomNodeDescriptor) {
    super(descriptor.label);
    this.descriptor = descriptor;
    this.nodeType = descriptor.type;
    this.properties = Object.fromEntries((descriptor.properties ?? []).map((f) => [f.name, f.default]));

    for (const input of descriptor.ports?.inputs ?? []) {
      this.addInput(input.name, new ClassicPreset.Input(socketForPayloadType(input.type), input.name, true));
    }
    for (const output of descriptor.ports?.outputs ?? []) {
      this.addOutput(output.name, new ClassicPreset.Output(socketForPayloadType(output.type), output.name));
    }
  }
}

export type AnyThingstudioNode =
  | InjectNode
  | StartupNode
  | FunctionNode
  | DebugNode
  | GpioOutNode
  | PwmOutNode
  | TimerNode
  | InterruptNode
  | EswitchNode
  | EbuttonNode
  | DisplaySpiNode
  | DisplayI2cNode
  | WifiStatusNode
  | WifiGateNode
  | UdpSendNode
  | UdpReceiveNode
  | HttpRequestNode
  | HttpInNode
  | HttpResponseNode
  | MqttPublishNode
  | MqttSubscribeNode
  | DelayNode
  | FilterNode
  | Bme280Node
  | TouchI2cNode
  | I2cNode
  | InstanceType<typeof GuiScreenNode>
  | InstanceType<typeof GuiLabelNode>
  | InstanceType<typeof GuiReadoutNode>
  | InstanceType<typeof GuiBarNode>
  | InstanceType<typeof GuiLedNode>
  | InstanceType<typeof GuiButtonNode>
  | InstanceType<typeof GuiNavigatorNode>
  | InstanceType<typeof GuiModalNode>
  | CustomNode;

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
  gui_led: () => new GuiLedNode(),
  gui_button: () => new GuiButtonNode(),
  gui_navigator: () => new GuiNavigatorNode(),
  gui_modal: () => new GuiModalNode(),
};
