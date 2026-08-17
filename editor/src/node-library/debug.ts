// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/debug.ts
//
// Tier 1 software-only node -- "print a value to the editor's inspector"
// (design doc §6). Real inspector wiring (`VALUE_STREAM`, §13) is Tier 2
// live value streaming (mvp-feature-priorities.md) -- not built yet. For
// now this prints to the device's serial console, the same fallback
// every POC used before any real inspector existed; upgrading to also
// emit over VALUE_STREAM once that protocol path exists is additive to
// this node, not a redesign -- the node doesn't change shape, just what
// its generated call does.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

export const debugNode: NodeDefinition = {
  type: "thingstudio/debug",
  kind: "sink",
  // `any` in -- debug prints whatever payload it receives (`msg.get
  // ('payload')` below, unconditionally), so it accepts every source type,
  // same reasoning as function's own `any` input.
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    return {
      functionName: ctx.uniqueName("debug"),
      functionBody: `print("DEBUG node=${node.id} payload=%r" % (msg.get('payload'),))`,
    };
  },
};
