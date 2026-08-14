// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/timer.ts
//
// Tier 1 GPIO/timer batch's "timers/intervals" item (mvp-feature-
// priorities.md). Distinct from inject: inject's repeat is one of four
// fixed presets (manual/1s/5s/30s) with a fixed configured payload
// (inject.ts); timer takes an arbitrary interval and emits a
// monotonically increasing tick count instead of a fixed value -- a
// heartbeat-with-sequence-number building block, and genuinely new
// capability rather than inject with different defaults. Each instance
// gets its own counter, initialized once as a module-level statement
// (ctx.uniqueName already guarantees the variable name -- and therefore
// the setup-statement key -- is unique per node instance, no dedup
// needed the way pin claims need it).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";

export const timerNode: NodeDefinition = {
  type: "thingstudio/timer",
  kind: "source",
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const intervalMs = Math.round(Number(node.properties.intervalMs ?? 1000));
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new CompileError(`timer node's intervalMs "${String(node.properties.intervalMs)}" must be a positive number`);
    }
    const counterVar = ctx.uniqueName("timer_count");

    return {
      statements: [{ key: counterVar, code: `${counterVar} = 0` }],
      // `global` is required here since this is inlined directly into
      // the coroutine body (compile.ts), not a separate top-level def --
      // without it, `+= 1` would create a new coroutine-local name
      // instead of mutating the module-level counter.
      buildMsg: `global ${counterVar}\n${counterVar} += 1\nmsg = {'payload': ${counterVar}, 'topic': ''}`,
      repeatMs: intervalMs,
    };
  },
};
