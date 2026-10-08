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
import type { Target } from "../definitions/target.js";
import type { ScreensSection } from "../gui/screens.js";

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
  /**
   * The function body, NOT indented -- the compiler indents it under
   * `def <functionName>(msg):`.
   *
   * Single-output node (the default -- no `ports.outputs` beyond one
   * entry, and no `outputCount` hook returning >1): must return the
   * (possibly modified) msg, or None to stop propagation -- unchanged,
   * original contract, exactly as before multi-output existed.
   *
   * Multi-output node (`ports.outputs.length > 1`, or
   * `outputCount(properties) > 1` -- see NodeDefinition.outputCount
   * above): must return a value routed across every output, Node-RED's
   * own convention
   * (https://nodered.org/docs/user-guide/writing-functions#multiple-outputs).
   * compile.ts's emit() applies LOOSE tolerance when unpacking it (Mike's
   * call, 2026-09-12 -- a malformed return here is a mistake in the flow
   * author's own flow-local code, not a platform-level fault worth a
   * NodeError over, so this matches Node-RED's own forgiving behavior
   * rather than failing loudly): a non-list return targets output 0 only
   * (nothing sent on any other output) -- exactly what a function written
   * before multi-output existed already does, so every existing
   * single-output function stays fully compatible unchanged; a list
   * shorter than the output count treats every missing trailing slot as
   * None; a list longer than the output count silently ignores the extra
   * entries. Within one slot: `None` sends nothing, a single msg dict
   * sends one message, and a list of msg dicts sends every one of them,
   * in order, out that same output.
   */
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
  /**
   * Resolves a config node's `properties` by its string ID (config-node-
   * and-palette-implementation-briefing.md). Throws `CompileError`
   * ("referenced config \"<id>\" not found") on a missing ID -- this
   * project's fault-handling priority applied the same way nodes.ts's own
   * `portSocket()` throws loudly on a missing port rather than falling
   * back to something silent. A node's own codegen hook calls this itself
   * with whichever property holds a config reference (e.g.
   * `node.properties.wifiConfigId`) and validates the shape it gets back --
   * this method's job is just handing back the right bucket of properties,
   * not validating what's inside it.
   */
  resolveConfig(id: string): Record<string, unknown>;
  /**
   * Returns every node in the flow whose `type` matches exactly (e.g.
   * "thingstudio/wifi_status"), in graph order -- lets a node type derive
   * shared state from another node's own instance-level properties,
   * rather than only from a config node's static data (`resolveConfig`
   * above). First real use, 2026-09-04: `mqtt_publish`/`mqtt_subscribe`/
   * `http_request`/`udp_send`/`udp_receive` no longer carry their own
   * independent `wifiConfigId` property -- each derives WiFi credentials
   * from the flow's own `thingstudio/wifi_status` node instead (see
   * wifi-status.ts's `resolveFlowWifiCredentials()`), fixing a real bug
   * Mike found hands-on: nothing stopped two network nodes in one flow
   * from independently referencing two DIFFERENT wifi configs (one
   * "unmanaged", one with real credentials) for the one physical radio
   * they both actually share. Optional, not required, so every existing
   * hand-rolled `CodegenContext` mock in this repo's test suite that
   * doesn't touch WiFi resolution keeps compiling unchanged (cheap-by-
   * default, CLAUDE.md) -- compile.ts's own real implementation always
   * provides it. Not validated for count here -- zero, one, or many is
   * a call for whichever caller asks (today: exactly one is correct,
   * zero/many are both CompileErrors -- see resolveFlowWifiCredentials()).
   */
  findNodesOfType?(type: string): GraphNode[];
  /**
   * Every config of this type in the flow, in file order. Added 2026-09-25 for singleton config types
   * (config-types.ts's `singleton`, e.g. WiFi): a node asks for "the flow's WiFi config" rather than
   * holding its own reference -- see wifi-status.ts's resolveFlowWifiCredentials(). Optional for the same
   * reason as findNodesOfType.
   */
  findConfigsOfType?(type: string): { id: string; properties: Record<string, unknown> }[];
  /**
   * The processor/board this compile targets (definitions/target.ts), or
   * null/absent when none is known. Pin-taking nodes don't read it directly
   * -- they call definitions/pin-check.ts, which does. Optional for the same
   * reason as findNodesOfType: hand-rolled mocks keep compiling.
   */
  target?: Target | null;
  /**
   * Records a non-fatal problem (an "avoid" pin, no target known). Returned
   * in CompileResult.warnings, deduplicated, in first-seen order. Optional:
   * a mock without it just drops warnings.
   */
  warn?(message: string): void;
  /** The flow's GUI layouts (gui/screens.ts), for the GUI nodes. Optional: absent in flows without a GUI and
   * in hand-rolled mocks. */
  screens?: ScreensSection;
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
  /**
   * Overrides `ports.outputs?.length` for how many outputs THIS
   * PARTICULAR node instance has -- only needed when output count varies
   * per instance rather than being fixed by the node type (today: only
   * `function`, via its own `properties.outputCount`; see
   * function-node.ts). Absent for every other node type, where
   * `ports.outputs?.length ?? 1` is already the right, fixed answer.
   * compile.ts's emit() calls this (falling back to `ports.outputs?.length
   * ?? 1` when absent) to decide whether a transform's return value is a
   * plain msg-or-None (1 output, the original/default contract, unchanged)
   * or a Node-RED-style array routed across N outputs -- see
   * TransformCodegenResult.functionBody's own doc comment below for that
   * contract. Added for multi-output-port support,
   * docs/working-notes/outstanding-items/connection-state-gate-router-nodes.md,
   * 2026-09-12.
   */
  outputCount?(properties: Record<string, unknown>): number;
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
