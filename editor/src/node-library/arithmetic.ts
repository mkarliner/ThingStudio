// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/arithmetic.ts
//
// Tier 1 software-only node. Stateless transform: msg.payload (number)
// in, msg.payload (number) out, against configured constants -- not
// another wire's value (same single-input-transform constraint as
// boolean.ts; see that file's header). `scale` covers the single most
// common real use: turning a raw sensor/ADC reading into engineering
// units (voltage divider, thermistor linear approx, unit conversion).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";

function num(value: unknown, label: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new CompileError(`arithmetic node's ${label} "${String(value)}" is not a valid number`);
  return n;
}

const OPERATORS = new Set(["scale", "round", "abs", "clamp"]);

export const arithmeticNode: NodeDefinition = {
  type: "thingstudio/arithmetic",
  kind: "transform",
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const operator = String(node.properties.operator ?? "scale");
    if (!OPERATORS.has(operator)) {
      throw new CompileError(`arithmetic node has unknown operator "${operator}" (expected one of: ${Array.from(OPERATORS).join(", ")})`);
    }

    let expr: string;
    if (operator === "scale") {
      const scale = num(node.properties.scale ?? 1, "scale");
      const offset = num(node.properties.offset ?? 0, "offset");
      expr = `msg.get('payload') * ${scale} + ${offset}`;
    } else if (operator === "round") {
      const decimals = Math.round(num(node.properties.decimals ?? 0, "decimals"));
      expr = `round(msg.get('payload'), ${decimals})`;
    } else if (operator === "abs") {
      expr = "abs(msg.get('payload'))";
    } else {
      const min = num(node.properties.min ?? 0, "min");
      const max = num(node.properties.max ?? 0, "max");
      if (min > max) throw new CompileError(`arithmetic node's clamp min (${min}) is greater than max (${max})`);
      expr = `max(${min}, min(${max}, msg.get('payload')))`;
    }

    return {
      functionName: ctx.uniqueName("arithmetic"),
      functionBody: `msg['payload'] = ${expr}\nreturn msg`,
    };
  },
};
