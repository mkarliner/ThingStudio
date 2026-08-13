// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/inject.ts
//
// Ported from pocs/poc-d/nodes.js (editor descriptor) and pocs/poc-d/compiler.js
// (codegen), generalized onto the real registry contract
// (compiler/node-definition.ts). Pattern 2 from node-definition-model.md:
// folded into control flow, not a callable -- inject's properties become
// the msg construction and the loop condition directly, not a function
// call in the chain.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { pyPayloadLiteral } from "./py-literals.js";

const REPEAT_MS: Record<string, number> = { manual: 0, "1s": 1000, "5s": 5000, "30s": 30000 };

export const injectNode: NodeDefinition = {
  type: "thingstudio/inject",
  kind: "source",
  codegenSource(node: GraphNode, _ctx: CodegenContext): SourceCodegenResult {
    const payloadType = (node.properties.payloadType as string | undefined) ?? "bool";
    const payloadLiteral = pyPayloadLiteral(payloadType, node.properties.payloadValue, "inject payload");
    const repeat = (node.properties.repeat as string | undefined) ?? "manual";
    const repeatMs = REPEAT_MS[repeat];
    if (repeatMs === undefined) throw new CompileError(`unknown inject repeat value "${repeat}"`);

    return {
      buildMsg: `msg = {'payload': ${payloadLiteral}, 'topic': ''}`,
      repeatMs,
    };
  },
};
