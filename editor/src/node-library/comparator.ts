// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/comparator.ts
//
// Tier 1 software-only node ("comparators/thresholds" in
// mvp-feature-priorities.md). Stateless transform: msg.payload (any of
// §6's typed payload set) in, msg.payload (bool) out -- payload compared
// against a configured constant threshold, not another wire's value
// (same single-input-transform constraint as boolean.ts). Probably the
// highest-value of the three software-only logic nodes for a "turn
// something on when X" trigger, and naturally single-input already since
// it's one value against one configured threshold, no fan-in needed.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { pyPayloadLiteral } from "./py-literals.js";

const OPERATORS: Record<string, string> = {
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  eq: "==",
  ne: "!=",
};

export const comparatorNode: NodeDefinition = {
  type: "thingstudio/comparator",
  kind: "transform",
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const operator = String(node.properties.operator ?? "gt");
    const pyOp = OPERATORS[operator];
    if (!pyOp) {
      throw new CompileError(`comparator node has unknown operator "${operator}" (expected one of: ${Object.keys(OPERATORS).join(", ")})`);
    }
    const payloadType = (node.properties.payloadType as string | undefined) ?? "number";
    const thresholdLiteral = pyPayloadLiteral(payloadType, node.properties.threshold, "comparator node threshold");

    return {
      functionName: ctx.uniqueName("comparator"),
      functionBody: `msg['payload'] = msg.get('payload') ${pyOp} ${thresholdLiteral}\nreturn msg`,
    };
  },
};
