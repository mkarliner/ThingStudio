// editor/src/node-library/gpio-out.ts
//
// Ported from pocs/poc-d/nodes.js and pocs/poc-d/compiler.js. Pattern 1 from
// node-definition-model.md: a native primitive call, parameterized by
// the node's configured property (`pin`) -- no separately-shipped
// "gpio_out module", the codegen IS the device-side implementation.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

export const gpioOutNode: NodeDefinition = {
  type: "thingstudio/gpio_out",
  kind: "sink",
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const pin = Math.round(Number(node.properties.pin));
    if (!Number.isFinite(pin) || pin < 0 || pin > 39) {
      throw new CompileError(`gpio_out pin ${String(node.properties.pin)} is out of range (0-39)`);
    }
    const pinVar = `_pin_${pin}`;
    return {
      imports: ["import machine"],
      statements: [{ key: `pin-${pin}`, code: `${pinVar} = machine.Pin(${pin}, machine.Pin.OUT)` }],
      functionName: ctx.uniqueName("gpio_out"),
      functionBody: `${pinVar}.value(1 if msg.get('payload') else 0)`,
    };
  },
};
