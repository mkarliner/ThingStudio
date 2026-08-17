// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/gpio-out.ts
//
// Ported from pocs/poc-d/nodes.js and pocs/poc-d/compiler.js. Pattern 1 from
// node-definition-model.md: a native primitive call, parameterized by
// the node's configured property (`pin`) -- no separately-shipped
// "gpio_out module", the codegen IS the device-side implementation.
//
// Setup-statement key is `pin-N-out`, not just `pin-N` -- namespaced by
// mode since gpio-in.ts and pwm-out.ts (Tier 1's GPIO/timer batch) claim
// pins too now. See gpio-in.ts's header for why: without the mode in the
// key, a flow that (incorrectly) wires the same physical pin as both an
// input and an output would silently dedup onto ONE wrongly-configured
// Pin object instead of two independently-correct ones.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

export const gpioOutNode: NodeDefinition = {
  type: "thingstudio/gpio_out",
  kind: "sink",
  // The one concretely-typed *input* that exists on today's 5-node canvas
  // (wire-type-system-scoping.md's scope-of-protection analysis) --
  // `signal` feeds `machine.Pin.value(1 if msg.get('payload') else 0)`
  // below, which is exactly bucket 1's truthiness conversion, already
  // unconditional and hardware-proven regardless of the feeding type. A
  // `bool`-typed input is what makes that bucket-1 "anything -> bool: allow"
  // rule load-bearing rather than decorative -- every real wire into this
  // port stays allowed.
  ports: {
    inputs: [{ name: "signal", type: "bool" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const pin = Math.round(Number(node.properties.pin));
    if (!Number.isFinite(pin) || pin < 0 || pin > 39) {
      throw new CompileError(`gpio_out pin ${String(node.properties.pin)} is out of range (0-39)`);
    }
    const pinVar = `_pin_${pin}`;
    return {
      imports: ["import machine"],
      statements: [{ key: `pin-${pin}-out`, code: `${pinVar} = machine.Pin(${pin}, machine.Pin.OUT)` }],
      functionName: ctx.uniqueName("gpio_out"),
      functionBody: `${pinVar}.value(1 if msg.get('payload') else 0)`,
    };
  },
};
