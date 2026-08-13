// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/boolean.ts
//
// Tier 1 software-only node (docs/working-notes/mvp-feature-priorities.md).
// A stateless transform: msg.payload (bool) in, msg.payload (bool) out.
// and/or/xor compare against a configured constant, not another node's
// live output -- a "real" two-input AND gate combining two wires can't be
// built yet, deliberately: it needs cross-message state/synchronization,
// which mvp-feature-priorities.md's 2026-08-13 note flags as a distinct,
// not-yet-designed future need (a Node-RED-style `join` node), not
// something to bolt onto this node ad hoc. Still useful as a gate: AND
// with a fixed False silences a chain without deleting the wire, handy
// for disabling part of a flow during testing.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { pyPayloadLiteral } from "./py-literals.js";

const OPERATORS = new Set(["not", "and", "or", "xor"]);

export const booleanNode: NodeDefinition = {
  type: "thingstudio/boolean",
  kind: "transform",
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const operator = String(node.properties.operator ?? "not");
    if (!OPERATORS.has(operator)) {
      throw new CompileError(`boolean node has unknown operator "${operator}" (expected one of: ${Array.from(OPERATORS).join(", ")})`);
    }

    let expr: string;
    if (operator === "not") {
      expr = "not msg.get('payload')";
    } else {
      const operandLiteral = pyPayloadLiteral("bool", node.properties.operand ?? "true", "boolean node operand");
      // Both sides of and/or/xor are real Python bools here (the left
      // side explicitly coerced, the right side always one of
      // True/False from pyPayloadLiteral), so the result stays a bool in
      // every case -- `and`/`or` return whichever operand short-circuits
      // to, `^` is bool XOR when both operands are bool.
      if (operator === "and") expr = `bool(msg.get('payload')) and ${operandLiteral}`;
      else if (operator === "or") expr = `bool(msg.get('payload')) or ${operandLiteral}`;
      else expr = `bool(msg.get('payload')) ^ ${operandLiteral}`; // xor
    }

    return {
      functionName: ctx.uniqueName("boolean"),
      functionBody: `msg['payload'] = ${expr}\nreturn msg`,
    };
  },
};
