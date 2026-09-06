// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/variable-get.ts
//
// Paired with variable-set.ts -- see that file's header for the shared
// in-RAM store's scope and the flash-persistence gap. Reads the named
// variable's current value and replaces msg.payload with it, passing the
// rest of msg through -- lets a get node be wired after any trigger
// (inject today; a timer once Tier 1's GPIO/timer batch lands) to fetch
// and forward a stored value on demand. A configured, typed default
// covers the not-yet-set case so downstream nodes always see a
// well-typed payload rather than a bare `None` the payload type system
// (§6) doesn't know about.
//
// **Given canvas presence, 2026-09-06** (outstanding-items/canvas-
// presence-gaps.md) -- was registry-only since introduction. Output port
// type is dynamic (a function of `payloadType`, resolvePortType's
// contract), same pattern inject.ts's own output already uses -- the
// value this node actually emits is exactly whatever `payloadType` says,
// known at compile/canvas time from the node's own config, so "any"
// would be strictly less honest than the real answer. Input port is
// `any`: msg.payload is never read (only overwritten), same shape as
// function.ts's own pass-through input.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, PayloadType, TransformCodegenResult } from "../compiler/node-definition.js";
import { pyPayloadLiteral, pyStringLiteral } from "./py-literals.js";
import { FLOW_VARS_DICT } from "./variable-set.js";

export const variableGetNode: NodeDefinition = {
  type: "thingstudio/variable_get",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: (properties) => (properties.payloadType as PayloadType | undefined) ?? "bool" }],
  },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const name = String(node.properties.name ?? "").trim();
    if (!name) throw new CompileError("variable_get node's name is empty");
    const payloadType = (node.properties.payloadType as string | undefined) ?? "bool";
    const defaultLiteral = pyPayloadLiteral(payloadType, node.properties.default ?? "false", "variable_get node default");

    return {
      statements: [{ key: "flow-vars-dict", code: `${FLOW_VARS_DICT} = {}` }],
      functionName: ctx.uniqueName("variable_get"),
      functionBody: `msg['payload'] = ${FLOW_VARS_DICT}.get(${pyStringLiteral(name)}, ${defaultLiteral})\nreturn msg`,
    };
  },
};
