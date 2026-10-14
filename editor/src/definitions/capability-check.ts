// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/capability-check.ts
//
// Node -> board capability check. A node declares what hardware it needs (`requires.capabilities`,
// compiler/node-definition.ts and node-library/custom-node.ts); the compile's Target carries what the
// processor and board actually have (`Target.capabilities`, target.ts). This is central, called once
// per node from compile(), not from each node's codegen hook -- for the same reason pin-checks live in
// pin-check.ts: a node that can't reach this (a custom node's Python) is still covered. Severity
// follows decisions/node-board-mapping.md:
//   - a required capability the target lacks: CompileError naming the node, the target and what's
//     missing (e.g. an ESP-NOW node on an RP2040).
//   - no target at all: a warning, never a block (the node can't be judged without knowing the board),
//     matching pin-check.ts's own no-target posture.

import { CompileError } from "../compiler/errors.js";
import type { CodegenContext } from "../compiler/node-definition.js";
import type { GraphNode } from "../compiler/graph.js";

function quoted(caps: readonly string[]): string {
  return caps.map((c) => `"${c}"`).join(", ");
}

/** Checks one node's `requires` against `ctx.target`. Throws CompileError on a known target missing a
 * required capability; warns (once, deduped by ctx) when no target is known. */
export function checkCapabilities(
  ctx: CodegenContext,
  node: GraphNode,
  requires: { readonly capabilities?: readonly string[] } | undefined,
): void {
  const needed = requires?.capabilities ?? [];
  if (needed.length === 0) return;
  const who = `node ${node.id} (${node.type})`;
  const target = ctx.target ?? null;
  if (!target) {
    ctx.warn?.(`${who} needs ${quoted(needed)}, not checked: no board or processor known.`);
    return;
  }
  const missing = needed.filter((c) => !target.capabilities.has(c));
  if (missing.length === 0) return;
  const has = [...target.capabilities].sort();
  throw new CompileError(
    `${who} needs ${quoted(missing)}, which ${target.label} doesn't provide` + (has.length ? ` (it has: ${has.join(", ")}).` : "."),
  );
}
