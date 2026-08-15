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

export type PayloadType = "bool" | "number" | "string";
export type PayloadValue = boolean | number | string;

function castValue(type: PayloadType, raw: string): PayloadValue {
  if (type === "bool") return raw === "true" || raw === true;
  if (type === "number") return Number(raw);
  return String(raw);
}

// ---------------------------------------------------------------------
// inject — manually (or on a repeat interval) fires a fake msg
// ---------------------------------------------------------------------
export class InjectNode extends ClassicPreset.Node {
  width = 160;
  height = 90;
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
  width = 140;
  height = 70;
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
  width = 130;
  height = 60;
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
  width = 130;
  height = 60;
  kind = "gpio_out" as const;

  properties: { pin: number } = { pin: 12 };

  constructor() {
    super("gpio out");
    this.addInput("signal", new ClassicPreset.Input(new BoolSocket(), "signal"));
  }
}

// ---------------------------------------------------------------------
// mqtt publish — fake sink, accepts any payload type
// ---------------------------------------------------------------------
export class MqttPublishNode extends ClassicPreset.Node {
  width = 150;
  height = 60;
  kind = "mqtt_publish" as const;

  properties: { topic: string; qos: "0" | "1" | "2"; retain: boolean } = {
    topic: "thingstudio/out",
    qos: "0",
    retain: false,
  };

  constructor() {
    super("mqtt out");
    this.addInput("msg", new ClassicPreset.Input(new AnySocket(), "msg"));
  }
}

export type AnyThingstudioNode = InjectNode | FunctionNode | DebugNode | GpioOutNode | MqttPublishNode;
