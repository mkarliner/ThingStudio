// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/nodes.ts
//
// Rete node classes for the editor node types, ported from
// pocs/poc-rete/src/nodes.ts's five *fake* types onto the real property
// contracts app/nodes.ts's own header documents -- node.properties here
// has to match exactly what each node-library/*.ts's codegen reads:
//   - inject:       payloadType, payloadValue                (node-library/inject.ts -- no `repeat`, see that file's 2026-09-02 header note)
//   - function:     code                                     (node-library/function-node.ts)
//   - debug:        fullMessage                              (node-library/debug.ts -- opt-in, default false, added 2026-09-09)
//   - gpio_out:     pin                                       (node-library/gpio-out.ts)
//   - timer:        intervalMs                                (node-library/timer.ts)
//   - interrupt:    pin, edge, debounce, debounceMs           (node-library/interrupt.ts)
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
import { functionNode } from "../../node-library/function-node.js";
import { debugNode } from "../../node-library/debug.js";
import { gpioOutNode } from "../../node-library/gpio-out.js";
import { timerNode } from "../../node-library/timer.js";
import { interruptNode } from "../../node-library/interrupt.js";
import { wifiStatusNode } from "../../node-library/wifi-status.js";
import { udpSendNode } from "../../node-library/udp-send.js";
import { udpReceiveNode } from "../../node-library/udp-receive.js";
import { httpRequestNode } from "../../node-library/http-request.js";
import { httpInNode } from "../../node-library/http-in.js";
import { httpResponseNode } from "../../node-library/http-response.js";
import { delayNode } from "../../node-library/delay.js";
import { mqttPublishNode } from "../../node-library/mqtt-publish.js";
import { mqttSubscribeNode } from "../../node-library/mqtt-subscribe.js";
import { pwmOutNode } from "../../node-library/pwm-out.js";
import { resolvePortType, type PortDefinition } from "../../compiler/node-definition.js";
import type { CustomNodeDescriptor } from "../../node-library/custom-node.js";

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
function portSocket(defs: PortDefinition[] | undefined, name: string, properties: Record<string, unknown>) {
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
export class InjectNode extends ClassicPreset.Node {
  width = 96;
  height = NODE_HEIGHT;
  kind = "inject" as const;
  nodeType = "thingstudio/inject";
  highlighted = false;

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

export class FunctionNode extends ClassicPreset.Node {
  width = 100;
  height = NODE_HEIGHT;
  kind = "function" as const;
  nodeType = "thingstudio/function";
  highlighted = false;

  properties: { code: string } = {
    code: "msg['payload'] = msg['payload']\nreturn msg\n",
  };

  constructor() {
    super("function");
    this.addInput("msg", new ClassicPreset.Input(portSocket(functionNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(functionNode.ports?.outputs, "msg", this.properties), "msg"));
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

  properties: { delayMs: number } = {
    delayMs: 1000,
  };

  constructor() {
    super("delay");
    this.addInput("msg", new ClassicPreset.Input(portSocket(delayNode.ports?.inputs, "msg", this.properties), "msg", true));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(delayNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class DebugNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "debug" as const;
  nodeType = "thingstudio/debug";
  highlighted = false;

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

export class WifiStatusNode extends ClassicPreset.Node {
  width = 120;
  height = NODE_HEIGHT;
  kind = "wifi_status" as const;
  nodeType = "thingstudio/wifi_status";
  highlighted = false;

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

export class UdpSendNode extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "udp_send" as const;
  nodeType = "thingstudio/udp_send";
  highlighted = false;

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
  | FunctionNode
  | DebugNode
  | GpioOutNode
  | PwmOutNode
  | TimerNode
  | InterruptNode
  | WifiStatusNode
  | UdpSendNode
  | UdpReceiveNode
  | HttpRequestNode
  | HttpInNode
  | HttpResponseNode
  | MqttPublishNode
  | MqttSubscribeNode
  | DelayNode
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
  function: () => new FunctionNode(),
  debug: () => new DebugNode(),
  gpio_out: () => new GpioOutNode(),
  pwm_out: () => new PwmOutNode(),
  timer: () => new TimerNode(),
  interrupt: () => new InterruptNode(),
  wifi_status: () => new WifiStatusNode(),
  udp_send: () => new UdpSendNode(),
  udp_receive: () => new UdpReceiveNode(),
  http_request: () => new HttpRequestNode(),
  http_in: () => new HttpInNode(),
  http_response: () => new HttpResponseNode(),
  mqtt_publish: () => new MqttPublishNode(),
  mqtt_subscribe: () => new MqttSubscribeNode(),
  delay: () => new DelayNode(),
};
