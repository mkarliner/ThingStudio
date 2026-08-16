// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/nodes.ts
//
// Rete node classes for the five real editor node types, ported from
// pocs/poc-rete/src/nodes.ts's five *fake* types onto the real property
// contracts app/nodes.ts's own header documents -- node.properties here
// has to match exactly what each node-library/*.ts's codegen reads:
//   - inject:   payloadType, payloadValue, repeat        (node-library/inject.ts)
//   - function: code                                     (node-library/function-node.ts)
//   - debug:    (none -- debug.ts reads only node.id)     (node-library/debug.ts)
//   - gpio_out: pin                                       (node-library/gpio-out.ts)
//   - timer:    intervalMs                                (node-library/timer.ts)
//
// poc-rete's fake type set doesn't match 1:1
// (rete-migration-implementation-briefing.md's callout): "mqtt out" is
// dropped (never exposed on this canvas, even though
// node-library/mqtt-publish.ts exists), and "timer" is new -- poc-rete had
// no equivalent to port, so its property shape/sizing is fresh work here,
// unverified in a real browser by anyone until Mike's hands-on pass.
//
// Sockets are `any`-equivalent this session (sub-decision 3, sockets.ts) --
// no per-payload-type retyping the way poc-rete's InjectNode.retypeOutput()
// did, since there's only one socket class to retype *to* here. Live
// propagation (poc-rete's onFire/timer-interval instance behavior) is
// main.ts wiring, out of scope until Phase 3 -- these classes are
// data-only this session: properties + ports, nothing else.

import { ClassicPreset } from "rete";
import { AnySocket } from "./sockets";

// Uniform pill height, ported from poc-rete's NODE_HEIGHT -- see that
// project's README "also worth recording" section for why this is a real
// Rete classic-preset layout budget that clips content, not a hint the
// way Litegraph's `size` is.
const NODE_HEIGHT = 34;

export class InjectNode extends ClassicPreset.Node {
  width = 96;
  height = NODE_HEIGHT;
  kind = "inject" as const;

  properties: { payloadType: "bool" | "number" | "string"; payloadValue: string; repeat: "manual" | "1s" | "5s" | "30s" } = {
    payloadType: "bool",
    payloadValue: "true",
    repeat: "manual",
  };

  constructor() {
    super("inject");
    this.addOutput("msg", new ClassicPreset.Output(new AnySocket(), "msg"));
  }
}

export class FunctionNode extends ClassicPreset.Node {
  width = 100;
  height = NODE_HEIGHT;
  kind = "function" as const;

  properties: { code: string } = {
    code: "msg['payload'] = msg['payload']\nreturn msg\n",
  };

  constructor() {
    super("function");
    this.addInput("msg", new ClassicPreset.Input(new AnySocket(), "msg"));
    this.addOutput("msg", new ClassicPreset.Output(new AnySocket(), "msg"));
  }
}

export class DebugNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "debug" as const;

  // No `properties` at all -- node-library/debug.ts's codegenSink reads
  // only node.id, nothing configured on the node itself. Matches
  // app/nodes.ts's DebugNode exactly (it declares no `this.properties`
  // either).
  properties: Record<string, never> = {};

  constructor() {
    super("debug");
    this.addInput("msg", new ClassicPreset.Input(new AnySocket(), "msg"));
  }
}

export class GpioOutNode extends ClassicPreset.Node {
  width = 104;
  height = NODE_HEIGHT;
  kind = "gpio_out" as const;

  // Default 12 -- matches app/nodes.ts's GpioOutNode (LuatOS ESP32-C3 test
  // board's visible onboard LED).
  properties: { pin: number } = { pin: 12 };

  constructor() {
    super("gpio out");
    this.addInput("signal", new ClassicPreset.Input(new AnySocket(), "signal"));
  }
}

export class TimerNode extends ClassicPreset.Node {
  width = 84;
  height = NODE_HEIGHT;
  kind = "timer" as const;

  properties: { intervalMs: number } = { intervalMs: 1000 };

  constructor() {
    super("timer");
    this.addOutput("msg", new ClassicPreset.Output(new AnySocket(), "msg"));
  }
}

export type AnyThingstudioNode = InjectNode | FunctionNode | DebugNode | GpioOutNode | TimerNode;
