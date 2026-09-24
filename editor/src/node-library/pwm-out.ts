// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/pwm-out.ts
//
// Tier 1 GPIO/timer batch. msg.payload (number, a duty fraction 0.0-1.0)
// in, no output -- terminal sink. Uses machine.PWM's duty_u16 API
// (0-65535), the form common to both target chip families (§3: ESP32 and
// RP2040/RP2350 both support it), rather than the ESP32-only legacy
// duty() (0-1023). Payload is clamped to [0, 1] before conversion rather
// than left to raise/wrap on an out-of-range value -- a flow author
// feeding a slightly-out-of-bounds computed value (e.g. an unclamped
// arithmetic-node scale result) shouldn't crash the chain over it. One
// real hardware caveat worth flagging now rather than after a confusing
// duty-cycle result: mvp-validation-plan.md's witness-rig section notes
// the current breadboard wiring produces real electrical ringing on fast
// GPIO edges, which would corrupt MEASURE_PWM's precision specifically --
// worth the wiring cleanup before this node's own hardware pass, not
// this node's problem to work around in software.

import { CompileError } from "../compiler/errors.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

// **Given canvas presence, 2026-09-06** (outstanding-items/canvas-
// presence-gaps.md) -- was registry-only since introduction. Input named
// `duty`, not `msg`/`signal` -- gpio_out's own `signal` names the port
// after what it carries semantically (a boolean level), and this node's
// payload is likewise not a generic message but specifically the duty
// fraction consumed below; `number` matches what's actually clamped and
// converted, not `any`.
export const pwmOutNode: NodeDefinition = {
  type: "thingstudio/pwm_out",
  kind: "sink",
  ports: {
    inputs: [{ name: "duty", type: "number" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const pin = checkPin(ctx, "pwm_out pin", node.properties.pin, "output");
    const freq = Math.round(Number(node.properties.freq ?? 1000));
    if (!Number.isFinite(freq) || freq <= 0) {
      throw new CompileError(`pwm_out freq "${String(node.properties.freq)}" must be a positive number`);
    }
    const pwmVar = `_pwm_${pin}`;

    return {
      imports: ["import machine"],
      statements: [{ key: `pin-${pin}-pwm`, code: `${pwmVar} = machine.PWM(machine.Pin(${pin}, machine.Pin.OUT), freq=${freq})` }],
      functionName: ctx.uniqueName("pwm_out"),
      functionBody: `${pwmVar}.duty_u16(int(max(0.0, min(1.0, msg.get('payload', 0))) * 65535))`,
    };
  },
};
