// editor/src/compiler/node-definition.ts
//
// The node codegen registry contract sketched in
// docs/working-notes/node-definition-model.md, made real. Every v1 node
// type registers one of these. `kind` picks which of the three codegen
// patterns POC-D already demonstrated (see that doc's "Three codegen
// patterns" section) applies:
//   - "source":    no msg input -- constructs the initial msg and drives
//                  a loop/repeat. POC-D's `inject` (pattern 2, folded
//                  into control flow).
//   - "transform": msg in, msg (or None, to stop propagation) out. A
//                  native transform is pattern 1; POC-D's `function`
//                  (pattern 3, verbatim user code) is also a transform.
//   - "sink":      msg in, no output, terminal. POC-D's `gpio_out`
//                  (pattern 1, native primitive call).

import type { GraphNode } from "./graph.js";

export type NodeKind = "source" | "transform" | "sink";

/** Code generated at module scope, before any coroutine bodies -- pin/bus setup, imports, etc. */
export interface SetupCode {
  /** Extra `import` lines this node needs; deduplicated across the whole compiled flow. */
  imports?: string[];
  /** Module-level statements (e.g. a pin init); deduplicated by `key` so two nodes claiming the same pin share one line. */
  statements?: { key: string; code: string }[];
}

export interface SourceCodegenResult extends SetupCode {
  /** Statement(s) that construct the initial `msg` dict for one iteration. Not indented -- the compiler places this at the top of the coroutine/loop body. */
  buildMsg: string;
  /** Milliseconds to sleep between iterations; 0 means "run once, then stop" (§15.5's `manual` inject). */
  repeatMs: number;
}

export interface TransformCodegenResult extends SetupCode {
  /** A Python function name, unique within the flow. */
  functionName: string;
  /** The function body, NOT indented -- the compiler indents it under `def <functionName>(msg):`. Must return the (possibly modified) msg, or None to stop propagation. */
  functionBody: string;
}

export interface SinkCodegenResult extends SetupCode {
  functionName: string;
  /** NOT indented; no return value expected. */
  functionBody: string;
}

/** Passed to every codegen hook so multiple instances of the same node type never collide on generated names. */
export interface CodegenContext {
  uniqueName(hint: string): string;
}

export interface NodeDefinition {
  /** e.g. "thingstudio/gpio_out" */
  type: string;
  kind: NodeKind;
  codegenSource?(node: GraphNode, ctx: CodegenContext): SourceCodegenResult;
  codegenTransform?(node: GraphNode, ctx: CodegenContext): TransformCodegenResult;
  codegenSink?(node: GraphNode, ctx: CodegenContext): SinkCodegenResult;
}
