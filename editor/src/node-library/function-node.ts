// editor/src/node-library/function-node.ts
//
// Ported from poc-d/nodes.js and poc-d/compiler.js. Pattern 3 from
// node-definition-model.md: the one node type whose device-side
// implementation is written by the flow author, not the node's
// implementer -- the `code` property is inlined verbatim as the
// function's body.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";

export const functionNode: NodeDefinition = {
  type: "thingstudio/function",
  kind: "transform",
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const userCode = String(node.properties.code ?? "").replace(/\r\n/g, "\n");
    if (!userCode.trim()) throw new CompileError("function node's code is empty");
    return {
      functionName: ctx.uniqueName("function"),
      functionBody: userCode,
    };
  },
};
