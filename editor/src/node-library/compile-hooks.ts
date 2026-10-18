// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/compile-hooks.ts
//
// The async pre-pass that runs every package's optional <name>.compile.py hook before a compile. Hooks
// run one at a time, in graph order, so results are deterministic and claim/order questions are settled
// before the synchronous compiler starts.
//
// The runner is injected: the real one runs a MicroPython WASI interpreter in a worker with a wall-clock
// budget (package-compile-hooks-spike.md); tests inject a fake. This file owns only the contract --
// building each context, validating each result, attributing errors and warnings.

import { CompileError } from "../compiler/errors.js";
import type { GraphConfigNode, GraphData, GraphNode } from "../compiler/graph.js";
import type { NodeDefinition } from "../compiler/node-definition.js";
import type { Target } from "../definitions/target.js";
import { buildCompileContext, type CompileContext } from "./compile-context.js";
import { throwIfHookErrors, validateCompileHookResult } from "./compile-hook.js";
import type { CompileHookResult } from "../compiler/node-definition.js";

/** Runs one hook. `hookSource` is the package's `.compile.py` text; the implementation is a sandboxed
 * interpreter, never the editor's own JavaScript. */
export interface CompileHookRunner {
  run(hookSource: string, ctx: CompileContext, properties: Record<string, unknown>, label: string): Promise<unknown>;
}

export interface RunCompileHooksOptions {
  readonly target?: Target | null;
  readonly redactConfig?: (config: GraphConfigNode) => Record<string, unknown>;
}

export interface CompileHooksOutcome {
  /** Node id -> validated result, for every node whose package ships a hook. */
  readonly results: ReadonlyMap<string, CompileHookResult>;
  /** Warnings, already formatted and in graph order. */
  readonly warnings: string[];
}

function packageLabel(node: GraphNode): string {
  return `${node.type} (node ${node.id})`;
}

/** Node types whose registry definition carries a compile hook. */
export function hookedNodeIds(graphData: GraphData, registry: ReadonlyMap<string, NodeDefinition>): string[] {
  return graphData.nodes.filter((n) => registry.get(n.type)?.compileHook !== undefined).map((n) => n.id);
}

export async function runCompileHooks(
  graphData: GraphData,
  registry: ReadonlyMap<string, NodeDefinition>,
  runner: CompileHookRunner,
  options: RunCompileHooksOptions = {},
): Promise<CompileHooksOutcome> {
  const results = new Map<string, CompileHookResult>();
  const warnings: string[] = [];
  for (const node of graphData.nodes) {
    const def = registry.get(node.type);
    if (!def || def.compileHook === undefined) continue;
    const label = packageLabel(node);
    const ctx = buildCompileContext({ graphData, node, descriptor: def, target: options.target, redactConfig: options.redactConfig });
    let raw: unknown;
    try {
      raw = await runner.run(def.compileHook, ctx, { ...node.properties }, label);
    } catch (err) {
      if (err instanceof CompileError) throw err;
      throw new CompileError(`${label}: compile hook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = validateCompileHookResult(raw, label);
    throwIfHookErrors(result, label);
    for (const warning of result.warnings) warnings.push(`${label}: ${warning}`);
    results.set(node.id, result);
  }
  return { results, warnings };
}
