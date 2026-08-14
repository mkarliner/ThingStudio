// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/variable-set.ts
//
// Tier 1 software-only node, paired with variable-get.ts. Stores
// msg.payload under a named key in a flow-wide, in-RAM dict, then passes
// msg through unchanged. NOT flash-persisted across redeploys or power
// cycles yet -- design doc §5's flash-backed key/value store (keyed by
// node ID, surviving redeploy by default) is real, planned Tier 2 work
// ("Flow persistence" in mvp-feature-priorities.md), not built yet. This
// gives real value now within one deployed flow's lifetime -- sharing a
// running value between a variable-set node and a variable-get node
// elsewhere in the flow (a counter, a last-seen value, a toggle) -- and
// is the natural place to swap in the real flash-backed store's API once
// it lands, without changing this node's shape.
//
// The shared store is one flat dict, keyed by the node's configured
// `name` property, not by node ID -- deliberately, since the whole point
// is letting a set node and a get node with the SAME name share a value;
// keying by node ID (like the future flash store) would make that
// impossible. Name collisions across unrelated variable nodes are the
// flow author's responsibility to avoid, same trust model as §6's
// unsandboxed function node.
//
// This same dict also backs `flow` scope inside a function node's own
// generated code (function-node.ts, mvp-feature-priorities.md's
// 2026-08-14 addendum) -- `flow.get('x')`/`flow.set('x', ...)` there
// reads/writes this exact `_flow_vars`, not a second store, so a
// variable_get/variable_set node and a function node's `flow` object
// interoperate on the same name directly.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { pyStringLiteral } from "./py-literals.js";

/** Shared with variable-get.ts -- must match exactly. Deduped as a setup
 * statement keyed by "flow-vars-dict" regardless of which node type (or
 * how many instances of either) compiles first. */
export const FLOW_VARS_DICT = "_flow_vars";

export const variableSetNode: NodeDefinition = {
  type: "thingstudio/variable_set",
  kind: "transform",
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const name = String(node.properties.name ?? "").trim();
    if (!name) throw new CompileError("variable_set node's name is empty");

    return {
      statements: [{ key: "flow-vars-dict", code: `${FLOW_VARS_DICT} = {}` }],
      functionName: ctx.uniqueName("variable_set"),
      functionBody: `${FLOW_VARS_DICT}[${pyStringLiteral(name)}] = msg.get('payload')\nreturn msg`,
    };
  },
};
