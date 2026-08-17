// SPDX-License-Identifier: Apache-2.0
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

// §6's fixed payload type set (design doc §6, "payload itself is typed
// from a small fixed set"). Single source of truth for both sides that
// need it: rete/sockets.ts maps each of these to a real socket class for
// the editor's wire-connect-time check, and this file's own `ports` field
// (below) is what a node-library/*.ts declares its ports' types against.
export type PayloadType = "int" | "number" | "bool" | "string" | "bytes" | "any";

// A port's type is usually fixed, but not always -- inject's single
// output is `bool`/`number`/`string` depending on its own `payloadType`
// property (node-library/inject.ts), the one node in the current 5-node
// canvas set whose port type isn't static. A function taking the node's
// resolved `properties` covers that case without a second, parallel
// mechanism for "ports that can retype" -- see resolvePortType below and
// rete/nodes.ts's InjectNode.retypeOutput().
export type PortType = PayloadType | ((properties: Record<string, unknown>) => PayloadType);

export interface PortDefinition {
  /** Must match the port's key in app/rete/nodes.ts's addInput/addOutput calls exactly. */
  name: string;
  type: PortType;
}

/** Resolves a possibly-dynamic PortDefinition against one node instance's
 * current properties. The one place `typeof type === "function"` gets
 * checked -- callers (rete/nodes.ts) never branch on that themselves. */
export function resolvePortType(port: PortDefinition, properties: Record<string, unknown>): PayloadType {
  return typeof port.type === "function" ? port.type(properties) : port.type;
}

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

/**
 * The fourth codegen pattern (docs/working-notes/node-definition-model.md's
 * "Three codegen patterns" plus this one) -- wait-on-event, not
 * poll-or-sleep. `SourceCodegenResult.repeatMs`'s contract (a millisecond
 * count to sleep) has no way to express "block until an external event
 * fires" -- there's no number of milliseconds that means that, so this is a
 * genuinely different result shape rather than `repeatMs` overloaded or
 * abused with a sentinel value. First real user: `interrupt` (Tier 1 item
 * 5), which awaits a `ThreadSafeEvent` set from a `machine.Pin.irq()`
 * handler running in hard-IRQ context
 * (`device-runtime/src/vendor/threadsafe_event/`).
 */
export interface EventSourceCodegenResult extends SetupCode {
  /**
   * Statement(s) that suspend the coroutine until the external event has
   * actually fired, and leave things ready for the next wait (e.g.
   * `await _evt.wait()` followed by `_evt.clear()`). Not indented -- the
   * compiler places this at the top of each loop iteration, before
   * `buildMsg`. Must genuinely block here -- this is the coroutine's only
   * suspension point, there is no sleep alongside it.
   */
  waitStatement: string;
  /**
   * Statement(s) that run once `waitStatement` returns, constructing the
   * `msg` dict for this firing. Not indented. May contain a bare `continue`
   * (this block is emitted directly inside the coroutine's `while True:`
   * loop, not a separate function) to drop this particular wake without
   * building or propagating a `msg` at all -- `interrupt`'s debounce
   * cooldown check uses exactly this to swallow a bounced edge and go
   * straight back to `waitStatement` for the next one.
   */
  buildMsg: string;
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
  // Editor-side only (wire-type-system-scoping.md, "Governing call"): read
  // by app/rete/nodes.ts to construct each port's real socket instead of a
  // hardcoded AnySocket. compile.ts's own graph walk does not read this --
  // confirmed when this field was added, matching the scoping note's
  // framing that §6's type check is a wire-connect-time editor concern,
  // not something codegen needs. Optional, and only populated for the 5
  // node types currently on the canvas (inject, function, debug, gpio_out,
  // timer) -- the other 11 registered types stay untouched, out of scope
  // per the scoping note's question 5. A node type with no `ports` here
  // simply isn't constructible on the canvas yet (rete/nodes.ts has no
  // class for it either), so there's no "falls back to what" case to
  // handle.
  ports?: {
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
  };
  codegenSource?(node: GraphNode, ctx: CodegenContext): SourceCodegenResult;
  /**
   * Alternative to codegenSource for kind "source" nodes that wait on an
   * external event rather than poll-or-sleep -- see EventSourceCodegenResult.
   * A source node defines exactly one of codegenSource/codegenEventSource,
   * never both; compile.ts's graph walk picks whichever is present.
   */
  codegenEventSource?(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult;
  codegenTransform?(node: GraphNode, ctx: CodegenContext): TransformCodegenResult;
  codegenSink?(node: GraphNode, ctx: CodegenContext): SinkCodegenResult;
}
