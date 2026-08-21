// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/nodes.ts
//
// Rete node classes for the editor node types, ported from
// pocs/poc-rete/src/nodes.ts's five *fake* types onto the real property
// contracts app/nodes.ts's own header documents -- node.properties here
// has to match exactly what each node-library/*.ts's codegen reads:
//   - inject:       payloadType, payloadValue, repeat        (node-library/inject.ts)
//   - function:     code                                     (node-library/function-node.ts)
//   - debug:        (none -- debug.ts reads only node.id)     (node-library/debug.ts)
//   - gpio_out:     pin                                       (node-library/gpio-out.ts)
//   - timer:        intervalMs                                (node-library/timer.ts)
//   - interrupt:    pin, edge, debounce, debounceMs           (node-library/interrupt.ts)
//   - wifi_status:  pollMs, wifiConfigId                       (node-library/wifi-status.ts)
//   - udp_send:     host, port, timeoutMs, wifiConfigId        (node-library/udp-send.ts)
//   - udp_receive:  port, pollMs, wifiConfigId                 (node-library/udp-receive.ts)
//   - mqtt_publish:   broker, port, topic, retain, qos, wifiConfigId   (node-library/mqtt-publish.ts)
//   - mqtt_subscribe: broker, port, topic, qos, wifiConfigId           (node-library/mqtt-subscribe.ts)
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
// own wiring exactly as its own worked example. Each carries a
// `wifiConfigId` property (empty string = "no config referenced yet",
// resolveWifiCredentials()'s own contract, wifi-status.ts) bound to a
// ConfigRefField in PropertyPanel.vue rather than raw ssid/password
// fields -- the actual fix for the credential-duplication problem this
// session exists to close. Same "unverified in a real browser until
// Mike's hands-on pass" caveat as every prior canvas-wiring session.
// http_request stays registry-only, an explicit flagged follow-up -- see
// that briefing's own success-criteria section.
//
// mqtt_publish/mqtt_subscribe are newer still (2026-08-21): given the same
// config-node migration (wifiConfigId, not raw ssid/password) AND, unlike
// wifi_status/udp_send/udp_receive, first-time canvas wiring at all --
// they'd been registry-only since introduction, per this file's own
// now-corrected header above. Same ConfigRefField pattern, EXCEPT
// mqtt-shared.ts's parseMqttBrokerProps rejects a referenced config whose
// security is "unmanaged" outright (mqtt_as always needs real credentials
// to drive its own connect/reconnect loop) -- so PropertyPanel.vue's hint
// text for these two kinds does NOT repeat the "pick unmanaged" advice the
// other three kinds' hints give.
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
import { mqttPublishNode } from "../../node-library/mqtt-publish.js";
import { mqttSubscribeNode } from "../../node-library/mqtt-subscribe.js";
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

  properties: { payloadType: "bool" | "number" | "string"; payloadValue: string; repeat: "manual" | "1s" | "5s" | "30s" } = {
    payloadType: "bool",
    payloadValue: "true",
    repeat: "manual",
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
    this.addInput("msg", new ClassicPreset.Input(portSocket(functionNode.ports?.inputs, "msg", this.properties), "msg"));
    this.addOutput("msg", new ClassicPreset.Output(portSocket(functionNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class DebugNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "debug" as const;
  nodeType = "thingstudio/debug";
  highlighted = false;

  // No `properties` at all -- node-library/debug.ts's codegenSink reads
  // only node.id, nothing configured on the node itself. Matches
  // app/nodes.ts's DebugNode exactly (it declares no `this.properties`
  // either).
  properties: Record<string, never> = {};

  constructor() {
    super("debug");
    this.addInput("msg", new ClassicPreset.Input(portSocket(debugNode.ports?.inputs, "msg", this.properties), "msg"));
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
    this.addInput("signal", new ClassicPreset.Input(portSocket(gpioOutNode.ports?.inputs, "signal", this.properties), "signal"));
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

  properties: { host: string; port: number; timeoutMs: number; wifiConfigId: string } = {
    host: "",
    port: 9999,
    timeoutMs: 2000,
    wifiConfigId: "",
  };

  constructor() {
    super("udp send");
    this.addInput("msg", new ClassicPreset.Input(portSocket(udpSendNode.ports?.inputs, "msg", this.properties), "msg"));
  }
}

export class UdpReceiveNode extends ClassicPreset.Node {
  width = 110;
  height = NODE_HEIGHT;
  kind = "udp_receive" as const;
  nodeType = "thingstudio/udp_receive";
  highlighted = false;

  properties: { port: number; pollMs: number; wifiConfigId: string } = {
    port: 9998,
    pollMs: 20,
    wifiConfigId: "",
  };

  constructor() {
    super("udp receive");
    this.addOutput("msg", new ClassicPreset.Output(portSocket(udpReceiveNode.ports?.outputs, "msg", this.properties), "msg"));
  }
}

export class MqttPublishNode extends ClassicPreset.Node {
  width = 128;
  height = NODE_HEIGHT;
  kind = "mqtt_publish" as const;
  nodeType = "thingstudio/mqtt_publish";
  highlighted = false;

  // wifiConfigId: "" sentinel, same convention as every other config-node-
  // referencing kind above -- see WifiStatusNode's own comment. retain
  // defaults false / qos defaults 0, matching mqtt-publish.ts's own
  // Number(...??...) defaults exactly (a freshly-dropped node and a
  // freshly-omitted property on a hand-edited flow file compile the same).
  properties: { broker: string; port: number; topic: string; retain: boolean; qos: 0 | 1; wifiConfigId: string } = {
    broker: "",
    port: 1883,
    topic: "",
    retain: false,
    qos: 0,
    wifiConfigId: "",
  };

  constructor() {
    super("mqtt publish");
    this.addInput("msg", new ClassicPreset.Input(portSocket(mqttPublishNode.ports?.inputs, "msg", this.properties), "msg"));
  }
}

export class MqttSubscribeNode extends ClassicPreset.Node {
  width = 132;
  height = NODE_HEIGHT;
  kind = "mqtt_subscribe" as const;
  nodeType = "thingstudio/mqtt_subscribe";
  highlighted = false;

  properties: { broker: string; port: number; topic: string; qos: 0 | 1; wifiConfigId: string } = {
    broker: "",
    port: 1883,
    topic: "",
    qos: 0,
    wifiConfigId: "",
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
      this.addInput(input.name, new ClassicPreset.Input(socketForPayloadType(input.type), input.name));
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
  | TimerNode
  | InterruptNode
  | WifiStatusNode
  | UdpSendNode
  | UdpReceiveNode
  | MqttPublishNode
  | MqttSubscribeNode
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
  timer: () => new TimerNode(),
  interrupt: () => new InterruptNode(),
  wifi_status: () => new WifiStatusNode(),
  udp_send: () => new UdpSendNode(),
  udp_receive: () => new UdpReceiveNode(),
  mqtt_publish: () => new MqttPublishNode(),
  mqtt_subscribe: () => new MqttSubscribeNode(),
};
