// SPDX-License-Identifier: Apache-2.0
// editor/src/compiler/compile.ts
//
// The general graph -> Python compiler (design doc §6), replacing
// pocs/poc-d/compiler.js, which only knew exactly one hardcoded 3-node shape
// (`inject -> function -> gpio_out`, checked for by literally counting
// each type). This walks an arbitrary graph via a per-node-type codegen
// registry instead -- the contract in node-definition.ts, made real from
// docs/working-notes/node-definition-model.md's sketch.
//
// Deliberately conservative about which shapes it accepts for v1, per
// docs/working-notes/validation/mvp-validation-plan.md's Tier 0
// adversarial cases: fan-out (one output wired to more than one input)
// and fan-in are rejected with a clear error rather than guessed at; so
// are cycles, unknown node types, and nodes unreachable from any source.
// Multiple independent sources (multiple inject/timer-style chains in
// one flow) ARE supported -- each becomes its own spawned coroutine,
// matching §5's "each independently-triggered subgraph is a coroutine."

import { CompileError } from "./errors.js";
import type { GraphData, GraphLink, GraphNode } from "./graph.js";
import type { CodegenContext, NodeDefinition } from "./node-definition.js";

export interface CompileResult {
  source: string;
}

export function compile(graphData: GraphData, registry: Map<string, NodeDefinition>): CompileResult {
  const nodesById = new Map<number, GraphNode>();
  for (const n of graphData.nodes) {
    if (nodesById.has(n.id)) throw new CompileError(`duplicate node id ${n.id}`);
    nodesById.set(n.id, n);
  }

  for (const n of graphData.nodes) {
    if (!registry.has(n.type)) throw new CompileError(`unknown node type "${n.type}" (node ${n.id})`);
  }

  // At most one outgoing link per node (no fan-out) and at most one
  // incoming link per node (no fan-in) -- neither shape is supported yet.
  const outgoing = new Map<number, GraphLink>();
  const incoming = new Map<number, GraphLink>();
  for (const link of graphData.links) {
    const [, originId, , targetId] = link;
    if (!nodesById.has(originId)) throw new CompileError(`link references unknown origin node ${originId}`);
    if (!nodesById.has(targetId)) throw new CompileError(`link references unknown target node ${targetId}`);
    if (outgoing.has(originId)) {
      throw new CompileError(`node ${originId} has more than one outgoing connection (fan-out) -- not supported yet`);
    }
    if (incoming.has(targetId)) {
      throw new CompileError(`node ${targetId} has more than one incoming connection (fan-in) -- not supported yet`);
    }
    outgoing.set(originId, link);
    incoming.set(targetId, link);
  }

  const sources = graphData.nodes.filter((n) => registry.get(n.type)!.kind === "source");
  if (sources.length === 0) {
    throw new CompileError("graph has no source node (e.g. inject) to drive any flow");
  }
  for (const s of sources) {
    if (incoming.has(s.id)) {
      throw new CompileError(`source node ${s.id} (${s.type}) has an incoming connection -- sources take no input`);
    }
  }

  // Walk each source's chain, detecting cycles as we go, and record
  // which nodes are reachable so anything left over can be rejected as
  // disconnected.
  const reachable = new Set<number>();
  const chains: { source: GraphNode; rest: GraphNode[] }[] = [];
  for (const source of sources) {
    reachable.add(source.id);
    const rest: GraphNode[] = [];
    const visited = new Set<number>([source.id]);
    let current = outgoing.get(source.id);
    while (current) {
      const targetId = current[3];
      // Structurally, this can't actually trigger given the fan-in<=1
      // check above: revisiting a node during this walk would require
      // it to have two distinct incoming links (one from wherever it
      // was first reached, one closing the loop), which fan-in checking
      // already rejects before any walk starts. Kept as a defensive
      // invariant rather than removed -- a cycle with a source node
      // still gets rejected, just via the fan-in or "disconnected"
      // error paths (see compiler.adversarial.test.ts's "rejects a
      // cycle" case for exactly which one fires and why).
      if (visited.has(targetId)) {
        throw new CompileError(`cycle detected in the flow starting at node ${source.id} (revisits node ${targetId})`);
      }
      visited.add(targetId);
      reachable.add(targetId);
      const node = nodesById.get(targetId)!;
      rest.push(node);
      current = outgoing.get(targetId);
    }
    chains.push({ source, rest });
  }

  for (const n of graphData.nodes) {
    if (!reachable.has(n.id)) {
      throw new CompileError(`node ${n.id} (${n.type}) is disconnected from any source`);
    }
  }

  // --- codegen ---

  const usedNames = new Set<string>();
  const ctx: CodegenContext = {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (usedNames.has(candidate)) candidate = `_${hint}_${i++}`;
      usedNames.add(candidate);
      return candidate;
    },
  };

  const imports = new Set<string>(["import runtime"]);
  const setupStatements = new Map<string, string>(); // key -> code, dedup'd (e.g. two nodes claiming the same pin)
  const functionDefs: string[] = [];
  const coroutines: string[] = [];
  const spawnCalls: string[] = [];

  chains.forEach(({ source, rest }, chainIndex) => {
    const sourceDef = registry.get(source.type)!;
    if (!sourceDef.codegenSource) {
      throw new CompileError(`node type "${source.type}" declares kind "source" but has no codegenSource`);
    }
    const src = sourceDef.codegenSource(source, ctx);
    mergeSetup(src, imports, setupStatements);

    const steps: ChainStep[] = [];
    let sinkSeen = false;
    for (const node of rest) {
      if (sinkSeen) {
        throw new CompileError(`node ${node.id} (${node.type}) appears after a sink node in the same chain -- sinks must be terminal`);
      }
      const nodeDef = registry.get(node.type)!;
      if (nodeDef.kind === "transform") {
        if (!nodeDef.codegenTransform) {
          throw new CompileError(`node type "${node.type}" declares kind "transform" but has no codegenTransform`);
        }
        const t = nodeDef.codegenTransform(node, ctx);
        mergeSetup(t, imports, setupStatements);
        functionDefs.push(`def ${t.functionName}(msg):\n${indent(t.functionBody, 4)}`);
        steps.push({ kind: "transform", call: `msg = ${t.functionName}(msg)` });
      } else if (nodeDef.kind === "sink") {
        if (!nodeDef.codegenSink) {
          throw new CompileError(`node type "${node.type}" declares kind "sink" but has no codegenSink`);
        }
        const sres = nodeDef.codegenSink(node, ctx);
        mergeSetup(sres, imports, setupStatements);
        functionDefs.push(`def ${sres.functionName}(msg):\n${indent(sres.functionBody, 4)}`);
        steps.push({ kind: "sink", call: `${sres.functionName}(msg)` });
        sinkSeen = true;
      } else {
        throw new CompileError(`node ${node.id} (${node.type}) of kind "${nodeDef.kind}" cannot appear mid-chain (only "transform" and "sink" can)`);
      }
    }

    const chainBody = assembleChain(steps);

    // The sleep/yield must sit at the SAME nesting level as buildMsg --
    // never inside one of assembleChain's `if msg is not None:` blocks --
    // so a short-circuited chain still yields every iteration instead of
    // busy-looping the event loop. This is the exact hazard class §5 and
    // POC-D's hardware bugs warn about (docs/working-notes/validation/
    // mvp-validation-plan.md's Tier 0 fault-isolation section).
    const bodyLines = [src.buildMsg];
    if (chainBody) bodyLines.push(chainBody);
    if (src.repeatMs > 0) bodyLines.push(`await asyncio.sleep_ms(${src.repeatMs})`);

    const loopBody = src.repeatMs > 0 ? `while True:\n${indent(bodyLines.join("\n"), 4)}` : bodyLines.join("\n");

    const coroName = ctx.uniqueName(`flow_${chainIndex}`);
    coroutines.push(`async def ${coroName}():\n${indent(loopBody, 4)}`);
    spawnCalls.push(`runtime.spawn(${coroName}())`);
  });

  const lines: string[] = [
    `# --- generated by the Thingstudio compiler (${new Date().toISOString()}) ---`,
    `# See design doc §6 for the graph/compiler model this implements.`,
    ...Array.from(imports),
    "asyncio = runtime.asyncio",
    "",
    ...Array.from(setupStatements.values()),
    "",
    ...functionDefs,
    "",
    ...coroutines,
    "",
    ...spawnCalls,
    "",
  ];

  return { source: lines.join("\n") };
}

type ChainStep = { kind: "transform"; call: string } | { kind: "sink"; call: string };

/**
 * Builds nested `if msg is not None:` blocks so a transform that stops
 * propagation skips only the remaining downstream calls, not anything
 * the caller appends after this (the sleep/yield above all rely on that).
 */
function assembleChain(steps: ChainStep[]): string {
  function build(i: number): string {
    if (i >= steps.length) return "";
    const step = steps[i]!;
    if (step.kind === "sink") return step.call;
    const rest = build(i + 1);
    if (!rest) return step.call;
    return `${step.call}\nif msg is not None:\n${indent(rest, 4)}`;
  }
  return build(0);
}

function mergeSetup(
  result: { imports?: string[]; statements?: { key: string; code: string }[] },
  imports: Set<string>,
  setupStatements: Map<string, string>,
): void {
  for (const imp of result.imports ?? []) imports.add(imp);
  for (const stmt of result.statements ?? []) {
    if (!setupStatements.has(stmt.key)) setupStatements.set(stmt.key, stmt.code);
  }
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}
