// Thingstudio poc-rete — the same 5 fake node types as pocs/poc-c/nodes.js
// (inject, function, gpio_out, mqtt_publish, debug), same mocked properties
// and behavior, ported from Litegraph's LGraphNode subclassing onto Rete's
// ClassicPreset.Node. See rete-spike-briefing.md for what this spike is for.
//
// Deliberate difference from poc-c: node bodies here carry NO inline
// widgets/controls for properties (not even function's one-off "edit code…"
// button — see checkpoint 4). All property editing lives in
// PropertyPanel.vue, a genuinely separate component reading the same
// selection state, per architecture-review-briefing.md's finding that this
// "falls out of component-based rendering for free" in Rete rather than
// needing Litegraph's one-off modal generalized. Node bodies are therefore
// closer to Node-RED's actual compact pill shape than poc-c's Litegraph
// nodes were — a side effect of the architecture, not a separate feature
// built for this spike (see mvp-feature-priorities.md's deferred
// "compact node appearance" item).

import { ClassicPreset } from "rete";
import { AnySocket, BoolSocket, socketForPayloadType } from "./sockets";

// Uniform pill height for every node type (Mike's steer, 2026-08-15,
// against the real Node-RED screenshot: consistent node height regardless
// of node kind, ports distributed vertically along the edge rather than
// stacked as extra body rows). Only possible because ThingstudioNode.vue
// positions sockets absolutely along the pill's left/right edge instead of
// the default classic Vue preset's layout (title row, then a stacked row
// per input/output) — see FunctionNode below for what that replaces.
const NODE_HEIGHT = 34;

export type PayloadType = "bool" | "number" | "string";
export type PayloadValue = boolean | number | string;

function castValue(type: PayloadType, raw: string): PayloadValue {
  // `raw` is always the panel's string input value (unlike poc-c's JS,
  // where a Litegraph widget could hand back a native boolean too) — the
  // `|| raw === true` half of poc-c's original check is dead code once
  // that's pinned down by the type, not just dropped silently.
  if (type === "bool") return raw === "true";
  if (type === "number") return Number(raw);
  return String(raw);
}

// ---------------------------------------------------------------------
// inject — manually (or on a repeat interval) fires a fake msg
// ---------------------------------------------------------------------
export class InjectNode extends ClassicPreset.Node {
  width = 96;
  height = NODE_HEIGHT;
  kind = "inject" as const;

  properties: { payloadType: PayloadType; payloadValue: string; repeat: "manual" | "1s" | "5s" | "30s" } = {
    payloadType: "bool",
    payloadValue: "true",
    repeat: "manual",
  };

  private timer: ReturnType<typeof setInterval> | null = null;
  onFire: ((value: PayloadValue) => void) | null = null;

  constructor() {
    super("inject");
    this.addOutput("msg", new ClassicPreset.Output(socketForPayloadType(this.properties.payloadType), "msg"));
  }

  // Called by PropertyPanel.vue when payloadType changes — dropping the
  // output socket type invalidates any now-mismatched existing links,
  // same rule poc-c's Litegraph version enforces via disconnectOutput(0).
  retypeOutput(): ClassicPreset.Socket {
    const socket = socketForPayloadType(this.properties.payloadType);
    this.outputs.msg!.socket = socket;
    return socket;
  }

  setupTimer(): void {
    if (this.timer) clearInterval(this.timer);
    const ms = { manual: 0, "1s": 1000, "5s": 5000, "30s": 30000 }[this.properties.repeat];
    if (ms) this.timer = setInterval(() => this.fire(), ms);
  }

  fire(): void {
    this.onFire?.(castValue(this.properties.payloadType, this.properties.payloadValue));
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

// ---------------------------------------------------------------------
// function — fake, pass-through only (real node runs precompiled
// MicroPython per §6, not JS; this exercises the "edit a code property in a
// separate panel" interaction, checkpoint 4's primary example).
// ---------------------------------------------------------------------
export class FunctionNode extends ClassicPreset.Node {
  // Historical note, kept for provenance: under the *default* classic Vue
  // preset (title row, then a stacked row per input/output), this was the
  // only one of the 5 types with both an input row and an output row, and
  // originally shipped at height=70 (copy-pasted from poc-c's Litegraph
  // card size), which squeezed/misplaced the input socket — confirmed root
  // cause at the time was `rete-vue-plugin`'s `Node.vue` setting the field
  // as a real inline CSS height, not just a layout hint (still true, see
  // NODE_HEIGHT above and MqttPublishNode below). Fixed then by bumping to
  // 160×100. Superseded now that ThingstudioNode.vue lays its one input and
  // one output out on the *same* row (both socket edges of a single pill,
  // Node-RED's own layout) instead of stacking — width still needs to fit
  // the wider "function" label, height no longer does.
  width = 100;
  height = NODE_HEIGHT;
  kind = "function" as const;

  properties = {
    code:
      "# fake — real node runs precompiled MicroPython (§6), not JS\n" +
      "# this editor does not execute anything\n" +
      "msg['payload'] = msg['payload']\n" +
      "return msg\n",
  };

  constructor() {
    super("function");
    this.addInput("msg", new ClassicPreset.Input(new AnySocket(), "msg"));
    this.addOutput("msg", new ClassicPreset.Output(new AnySocket(), "msg"));
  }
}

// ---------------------------------------------------------------------
// debug — logs received values to the sidebar, like Node-RED's debug tab
// ---------------------------------------------------------------------
export class DebugNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "debug" as const;

  properties = {};

  constructor() {
    super("debug");
    this.addInput("msg", new ClassicPreset.Input(new AnySocket(), "msg"));
  }
}

// ---------------------------------------------------------------------
// gpio out — fake digital output, deliberately typed bool-only
// ---------------------------------------------------------------------
export class GpioOutNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "gpio_out" as const;

  properties: { pin: number } = { pin: 12 };

  // Live-value indicator, restored per editor-look-and-feel-briefing.md's
  // "worth deciding" note — poc-c drew this as an `onDrawForeground` LED
  // dot; here it's plain reactive state read by ThingstudioNode.vue (as a
  // Node-RED-style status line below the node, not an in-body row — see
  // that file), set from editor-setup.ts's propagate() on every signal
  // received. `undefined` (never fired yet) is distinct from `false` (fired,
  // currently off) so "no status yet" and "off" read differently, matching
  // real Node-RED's own status-line convention (no status shown until a
  // node actually reports one).
  lastValue: boolean | undefined = undefined;

  constructor() {
    super("gpio out");
    this.addInput("signal", new ClassicPreset.Input(new BoolSocket(), "signal"));
  }
}

// ---------------------------------------------------------------------
// mqtt publish — fake sink, accepts any payload type
// ---------------------------------------------------------------------
export class MqttPublishNode extends ClassicPreset.Node {
  width = 104;
  // Same NODE_HEIGHT as every other type — `lastLabel` renders as a
  // Node-RED-style status line positioned *below* the node (absolutely
  // positioned, outside this declared box), not an extra in-pill row, so it
  // doesn't need the extra height budget an in-body row would (contrast
  // gpio_out's LED, which overlays inside the pill with no extra height
  // either). See ThingstudioNode.vue's `.ts-status` element.
  height = NODE_HEIGHT;
  kind = "mqtt_publish" as const;

  properties: { topic: string; qos: "0" | "1" | "2"; retain: boolean } = {
    topic: "thingstudio/out",
    qos: "0",
    retain: false,
  };

  // Live-value indicator, restored alongside gpio_out's LED — poc-c's
  // onDrawForeground label ("→ topic: value"), set from propagate().
  lastLabel: string | undefined = undefined;

  constructor() {
    super("mqtt out");
    this.addInput("msg", new ClassicPreset.Input(new AnySocket(), "msg"));
  }
}

export type AnyThingstudioNode = InjectNode | FunctionNode | DebugNode | GpioOutNode | MqttPublishNode;
