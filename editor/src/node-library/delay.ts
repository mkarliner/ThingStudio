// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/delay.ts
//
// From mikes-questions-and-points.md's original node-prioritisation list
// ("delay, gets a messages and relays it after an interval") -- every
// other item on that list was triaged 2026-08-17 (decisions.md, "Config
// nodes / Tier 1 scope"); this one was never explicitly addressed until
// now (outstanding-items.md, "Network / config nodes"). A transform, same
// kind as `function`: msg in, the identical msg back out, after waiting
// `delayMs`. Cheapest implementation that's actually correct (CLAUDE.md) --
// no queueing, no per-message concurrency, no rate-limiting modes (Node-
// RED's own `delay` node has several; nothing in the original ask calls
// for more than the simplest one).
//
// **Real, honest limitation, not silently glossed over**: compile.ts runs
// one source's entire downstream chain synchronously within that source's
// own coroutine (`msgVar = await <transformFn>(msgVar)`, one call after
// another) -- so this node's `await asyncio.sleep_ms(delayMs)` blocks that
// SOURCE's own next iteration for at least `delayMs`, not just this one
// message's trip through the chain. A `timer` node (intervalMs=200) feeding
// a `delay` node (delayMs=5000) will NOT tick every 200ms once a message
// reaches the delay -- it ticks roughly every `delayMs + intervalMs`
// instead, because the timer's own coroutine can't loop back to its next
// `sleep_ms(intervalMs)` until the current iteration's whole chain
// (including this node's sleep) returns. This is not a new failure mode
// this node introduces -- any slow transform already has the same effect
// on its own source (http-request.ts's `timeoutMs` is the same shape of
// cost, just usually shorter and I/O-bound rather than deliberate) -- but
// `delay` makes the blocking the ENTIRE point of the node rather than a
// side effect, so it's worth naming explicitly here rather than leaving
// someone to discover it by watching a timer's cadence drift. A real
// non-blocking, per-message-concurrent delay (each message getting its
// own independent timer, not serialized behind its source's coroutine)
// would need a genuinely different compiler primitive -- effectively its
// own spawned task per message -- which is a real future direction, not a
// one-way door this simple version forecloses: `properties.delayMs` and
// this node's `type` string are stable either way, so a future
// non-blocking mode is additive (a new property, or a distinct node
// type), not a breaking change to what's built here.
//
// Other than the delay itself, nothing about the msg is inspected or
// modified -- matches `function`'s own `any`-in/`any`-out shape
// (wire-type-system-scoping.md's bucket-1 "anything -> bool" reasoning
// applies here too, same as every other pass-through transform).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";

export const delayNode: NodeDefinition = {
  type: "thingstudio/delay",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const delayMs = Math.round(Number(node.properties.delayMs ?? 1000));
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      throw new CompileError(`delay node's delayMs "${String(node.properties.delayMs)}" must be a positive number`);
    }

    return {
      functionName: ctx.uniqueName("delay"),
      functionBody: `await asyncio.sleep_ms(${delayMs})\nreturn msg`,
    };
  },
};
