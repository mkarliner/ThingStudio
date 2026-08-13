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
// A real DAG, matching Node-RED's own basic wiring model, not just a
// straight-line chain per source: a node's output can fan out to more
// than one downstream input (each branch beyond the first gets its own
// shallow copy of `msg`, the same reason Node-RED clones outgoing
// messages -- so one branch mutating its `msg` can't leak into a
// sibling), and a node's input can be fed by more than one upstream
// output (fan-in needs no synchronization: whichever message arrives
// just triggers the node, so a node reachable from two different
// branches/sources simply gets called once per path that reaches it,
// with its Python function generated exactly once and reused). Cycles
// are still rejected -- a DAG, not a general graph -- via cycle detection
// that now has to be real (see walkForCycles below) rather than a
// side effect of "each node has at most one incoming link," which is
// what made a reachable cycle structurally impossible before fan-in was
// allowed. Unknown node types and nodes unreachable from any source are
// still rejected too. Multiple independent sources (multiple
// inject/timer-style chains in one flow) ARE supported -- each becomes
// its own spawned coroutine, matching §5's "each independently-triggered
// subgraph is a coroutine."

import { CompileError } from "./errors.js";
import type { GraphData, GraphLink, GraphNode } from "./graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult, TransformCodegenResult } from "./node-definition.js";

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

  // childrenOf: originId -> its outgoing links, in link order. Any number
  // of links per origin (fan-out) and any number of links per target
  // (fan-in, tracked implicitly -- nothing needs an explicit "incoming"
  // list beyond the counts/checks below).
  const childrenOf = new Map<number, GraphLink[]>();
  const incomingCount = new Map<number, number>();
  for (const link of graphData.links) {
    const [, originId, , targetId] = link;
    if (!nodesById.has(originId)) throw new CompileError(`link references unknown origin node ${originId}`);
    if (!nodesById.has(targetId)) throw new CompileError(`link references unknown target node ${targetId}`);
    if (!childrenOf.has(originId)) childrenOf.set(originId, []);
    childrenOf.get(originId)!.push(link);
    incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) + 1);
  }

  const sources = graphData.nodes.filter((n) => registry.get(n.type)!.kind === "source");
  if (sources.length === 0) {
    throw new CompileError("graph has no source node (e.g. inject) to drive any flow");
  }
  for (const s of sources) {
    if (incomingCount.has(s.id)) {
      throw new CompileError(`source node ${s.id} (${s.type}) has an incoming connection -- sources take no input`);
    }
  }

  // Sinks are terminal from anywhere in the graph, fan-in or not -- a
  // sink with any outgoing link at all is rejected up front, rather than
  // relying on the codegen walk to notice.
  for (const n of graphData.nodes) {
    if (registry.get(n.type)!.kind === "sink" && (childrenOf.get(n.id)?.length ?? 0) > 0) {
      throw new CompileError(`node ${n.id} (${n.type}) is a sink but has an outgoing connection -- sinks must be terminal`);
    }
  }

  // Cycle detection + reachability in one pass: DFS from every source,
  // 3-color (white implicit / gray = on the current recursion stack /
  // black = fully processed). Hitting a GRAY node is a real back edge --
  // a cycle, reachable from a real source, which fan-in now makes
  // actually constructible (previously "at most one incoming link"
  // structurally ruled this out; see compiler.adversarial.test.ts). A
  // node already BLACK is a legitimate reconvergence -- a diamond within
  // one source's own tree, or a node shared between two different
  // sources -- not a cycle; stop descending (its subtree's already been
  // validated) but it's still reachable.
  const color = new Map<number, "gray" | "black">();
  const reachable = new Set<number>();
  function walkForCycles(sourceId: number, nodeId: number): void {
    const existing = color.get(nodeId);
    if (existing === "black") return;
    if (existing === "gray") {
      throw new CompileError(`cycle detected in the flow starting at node ${sourceId} (revisits node ${nodeId})`);
    }
    color.set(nodeId, "gray");
    reachable.add(nodeId);
    for (const link of childrenOf.get(nodeId) ?? []) {
      walkForCycles(sourceId, link[3]);
    }
    color.set(nodeId, "black");
  }
  for (const s of sources) walkForCycles(s.id, s.id);

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

  // Memoized per-node codegen for transform/sink nodes: generated exactly
  // once regardless of how many places in the DAG reach it (fan-in from
  // multiple sources, or a diamond within one source's own tree), so a
  // shared downstream node's Python function is defined once and simply
  // called from every place that reaches it -- matching Node-RED's own
  // fan-in semantics (no synchronization/merge, the node just fires once
  // per incoming message, however many times that ends up being per run).
  const transformCodegen = new Map<number, TransformCodegenResult>();
  const sinkCodegen = new Map<number, SinkCodegenResult>();

  function getTransform(node: GraphNode): TransformCodegenResult {
    let t = transformCodegen.get(node.id);
    if (!t) {
      const def = registry.get(node.type)!;
      if (!def.codegenTransform) throw new CompileError(`node type "${node.type}" declares kind "transform" but has no codegenTransform`);
      t = def.codegenTransform(node, ctx);
      mergeSetup(t, imports, setupStatements);
      functionDefs.push(`def ${t.functionName}(msg):\n${indent(t.functionBody, 4)}`);
      transformCodegen.set(node.id, t);
    }
    return t;
  }

  function getSink(node: GraphNode): SinkCodegenResult {
    let s = sinkCodegen.get(node.id);
    if (!s) {
      const def = registry.get(node.type)!;
      if (!def.codegenSink) throw new CompileError(`node type "${node.type}" declares kind "sink" but has no codegenSink`);
      s = def.codegenSink(node, ctx);
      mergeSetup(s, imports, setupStatements);
      functionDefs.push(`def ${s.functionName}(msg):\n${indent(s.functionBody, 4)}`);
      sinkCodegen.set(node.id, s);
    }
    return s;
  }

  /**
   * Emits code for everything downstream of `nodeId`, reading/writing
   * whichever msg dict is currently bound to `msgVar`. Returns "" if
   * there's nothing downstream (a transform with no outgoing wire just
   * drops the message, matching Node-RED -- not an error). NOT indented;
   * callers indent the whole result as one block.
   */
  function emit(nodeId: number, msgVar: string): string {
    const node = nodesById.get(nodeId)!;
    const kind = registry.get(node.type)!.kind;

    if (kind === "sink") {
      const s = getSink(node);
      return nodeCallWithFaultBoundary(node.id, `${s.functionName}(${msgVar})`);
    }
    if (kind !== "transform") {
      // Defensive, not reachable in practice: a "source"-kind node
      // showing up as someone else's downstream target is already
      // rejected above (the "source node has an incoming connection"
      // check runs before any codegen walk starts) -- kept as an
      // invariant, same reasoning as the cycle-detection comment above.
      throw new CompileError(`node ${node.id} (${node.type}) of kind "${kind}" cannot appear downstream of another node (only "transform" and "sink" can)`);
    }

    const t = getTransform(node);
    const callLine = nodeCallWithFaultBoundary(node.id, `${msgVar} = ${t.functionName}(${msgVar})`);

    const children = childrenOf.get(nodeId) ?? [];
    const branchesBody = emitChildren(children, msgVar);
    if (!branchesBody) return callLine;

    // The sleep/yield the caller appends after the whole per-source body
    // must sit outside this `if`, at the same nesting level as buildMsg --
    // assembled by the caller, same hazard §5/POC-D's hardware bugs warn
    // about (a short-circuited/None chain must still yield every
    // iteration, not busy-loop the event loop).
    return `${callLine}\nif ${msgVar} is not None:\n${indent(branchesBody, 4)}`;
  }

  /**
   * Fan-out: the first branch reuses msgVar directly (no clone -- matches
   * Node-RED's own "first wire gets the original object" behavior);
   * every branch after that gets its own shallow copy. Critically, EVERY
   * clone is taken up front, before any branch actually runs -- matching
   * Node-RED's own send-time cloning, where all of a node's outgoing
   * copies are made before any downstream node gets to process (and
   * potentially mutate) one of them. Interleaving "clone, then run that
   * branch, then clone the next" instead would let an earlier branch's
   * in-place mutation of msgVar (a function node doing `msg['x'] = ...`
   * and returning the same dict) leak into a later branch's "clone,"
   * since that later clone would be copying already-mutated state.
   */
  function emitChildren(children: GraphLink[], msgVar: string): string {
    if (children.length === 0) return "";
    const cloneStmts: string[] = [];
    const branchVars = children.map((_link, i) => {
      if (i === 0) return msgVar;
      const v = ctx.uniqueName("msg_branch");
      cloneStmts.push(`${v} = dict(${msgVar})`);
      return v;
    });
    const branchCodes = children.map((link, i) => emit(link[3], branchVars[i]!)).filter((code) => code.length > 0);
    return [...cloneStmts, ...branchCodes].join("\n");
  }

  sources.forEach((source, chainIndex) => {
    const sourceDef = registry.get(source.type)!;
    if (!sourceDef.codegenSource) {
      throw new CompileError(`node type "${source.type}" declares kind "source" but has no codegenSource`);
    }
    const src = sourceDef.codegenSource(source, ctx);
    mergeSetup(src, imports, setupStatements);

    const chainBody = emitChildren(childrenOf.get(source.id) ?? [], "msg");

    const bodyLines = [src.buildMsg];
    if (chainBody) bodyLines.push(chainBody);
    if (src.repeatMs > 0) bodyLines.push(`await asyncio.sleep_ms(${src.repeatMs})`);

    const loopBody = src.repeatMs > 0 ? `while True:\n${indent(bodyLines.join("\n"), 4)}` : bodyLines.join("\n");

    const coroName = ctx.uniqueName(`flow_${chainIndex}`);
    coroutines.push(`async def ${coroName}():\n${indent(loopBody, 4)}`);
    // Second arg is the fallback node ID design doc §5's per-task boundary
    // (device-runtime/src/runtime.py) attributes an exception to when it
    // happens outside any node's own try/except below -- e.g. a bug in
    // buildMsg itself, before any node-specific call runs.
    spawnCalls.push(`runtime.spawn(${coroName}(), "${source.id}")`);
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

/**
 * Wraps one node's generated call in a try/except that tags any exception
 * with this node's own ID before re-raising, via runtime.NodeError
 * (device-runtime/src/runtime.py) -- design doc §5/§11's "named per-node
 * functions/variables tied to node IDs... makes §13's NODE_ERROR reports
 * actually traceable back to the node that failed," made concrete. Without
 * this, an exception anywhere in a multi-node chain (one coroutine per
 * chain, not per node -- see the spawnCalls comment above) could only be
 * blamed on the whole chain's source node, not the specific node that
 * actually raised -- which is exactly what the validation plan's
 * fault-isolation bar checks ("confirm NODE_ERROR reports the correct
 * node ID," mvp-validation-plan.md). `call` is NOT indented; the caller
 * handles indentation for the whole multi-line result the same way it
 * already does for a single-line call.
 */
function nodeCallWithFaultBoundary(nodeId: number, call: string): string {
  return `try:\n${indent(call, 4)}\nexcept Exception as _e:\n    raise runtime.NodeError("${nodeId}", _e)`;
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}
