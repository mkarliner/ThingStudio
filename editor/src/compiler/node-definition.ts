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
import type { NodeDescriptor } from "./node-descriptor.js";

// The descriptor primitives (NodeKind/PayloadType/PortType/PortDefinition/resolvePortType) and the
// canonical NodeDescriptor now live in ./node-descriptor.ts -- re-exported here so every existing
// `from "./node-definition.js"` import keeps resolving.
export * from "./node-descriptor.js";

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
   * entry, and no `dynamicOutputs` spec resolving to >1): must return the
   * (possibly modified) msg, or None to stop propagation -- unchanged,
   * original contract, exactly as before multi-output existed.
   *
   * Multi-output node (`ports.outputs.length > 1`, or
   * `dynamicOutputs` resolving to >1 -- see NodeDescriptor.dynamicOutputs):
   * must return a value routed across every output, Node-RED's
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
  /** Whether any wire ends at this node's input / starts at this node's output. Lets a two-faced node choose its
   * mode (a wired input means the flow owns the node's state) and warn about an output nothing listens to.
   * Optional, like findNodesOfType: absent in hand-rolled mocks. */
  isInputWired?(nodeId: string): boolean;
  isOutputWired?(nodeId: string): boolean;
  /** The nodes this node's outputs are wired to directly, in link order (a gui screen finds its display this way). */
  findWiredTargets?(nodeId: string): GraphNode[];
  /** Records that `who` uses hardware `resource` ("GPIO 5") as `use` ("input, pull-up"); a different use from an
   * earlier claim throws a CompileError naming both. Call it through node-library/hardware-shared.ts's
   * claimResource() (decisions/hardware-singletons.md). Optional: absent in hand-rolled mocks. */
  claimResource?(resource: string, use: string, who: string): void;
}

/**
 * A built-in node type: the canonical data descriptor plus the TypeScript codegen hooks a custom
 * `.node.json` deliberately cannot carry. `type`/`kind`/`requires`/`allowUnwired`/`ports`/editor
 * metadata/property schema all come from `NodeDescriptor` (./node-descriptor.ts); a node being
 * migrated onto the descriptor fills in that data and the canvas/palette/panel/catalog read it from
 * here instead of their own hardcoded copies.
 */
export interface NodeDefinition extends NodeDescriptor {
  codegenSource?(node: GraphNode, ctx: CodegenContext): SourceCodegenResult;
  /**
   * Alternative to codegenSource for kind "source" nodes that wait on an
   * external event rather than poll-or-sleep -- see EventSourceCodegenResult.
   * A source node defines exactly one of codegenSource/codegenEventSource,
   * never both; compile.ts's graph walk picks whichever is present.
   *
   * A kind "sink" node may also define it: the node is then two-faced. Its
   * input is a normal sink call (codegenSink); its output wires carry what
   * this event source builds, in a coroutine of its own. Neither face is
   * called from the other, so state they share lives outside both (the GUI
   * subsystem keeps a button's state by node id). Loop wiring from such a
   * node's output back to its own input is legal -- two coroutines, not a
   * cycle. Used by gui_button and gui_modal. Not allowed on a transform: its
   * output wire already means "what the transform returned".
   */
  codegenEventSource?(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult;
  codegenTransform?(node: GraphNode, ctx: CodegenContext): TransformCodegenResult;
  codegenSink?(node: GraphNode, ctx: CodegenContext): SinkCodegenResult;
}
