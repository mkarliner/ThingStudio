// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/inject.ts
//
// Ported from pocs/poc-d/nodes.js (editor descriptor) and pocs/poc-d/compiler.js
// (codegen), generalized onto the real registry contract
// (compiler/node-definition.ts). Pattern 2 from node-definition-model.md:
// folded into control flow, not a callable -- inject's properties become
// the msg construction directly, not a function call in the chain.
//
// Behavior change, 2026-09-02 (docs/working-notes/outstanding-items/
// inject-click-fire-missing.md): rewritten from a codegenSource
// (poll/repeat) node onto the event-source pattern (node-definition.ts's
// EventSourceCodegenResult, interrupt.ts's own precedent) -- inject no
// longer has a `repeat` property at all, and no periodic "1s"/"5s"/"30s"
// option survives this change: every inject node now fires exactly once
// per real §13 TRIGGER message (a canvas click while live-connected,
// main.ts), never on a timer and never automatically at deploy time. This
// was a deliberate, explicit product decision (not a gap being closed
// gradually) -- a prior session's handoff brief claimed a click-fire
// feature had already been built, but git history showed it never had
// been (git log/git show on this file across the full repo history came
// back empty for any commit touching a trigger/event mechanism here); the
// "run once automatically when deployed, no live re-fire" behavior this
// file had before today was the ONLY behavior inject had ever actually
// shipped with. The removed `REPEAT_MS`/`manual`/"1s"/"5s"/"30s" mapping
// is not preserved anywhere as a fallback -- an old saved flow file with a
// `repeat` property on an inject node simply has that property ignored
// now (flow-file.ts's loader assigns properties by plain
// `Object.assign`, so an extra unused key is harmless, not an error).
//
// Wiring, mirroring interrupt.ts's own event-source shape exactly:
// a ThreadSafeEvent constructed once at module (setup) scope, self-
// registered with the device-side runtime under this node's own ID via
// `runtime.register_trigger` (device-runtime/src/runtime.py) -- the same
// self-registration shape register_cleanup() already established for
// udp_send/udp_receive's sockets. listener.py's dispatch loop calls
// `runtime.fire_trigger(nodeId)` on an incoming §13 TRIGGER message,
// which sets the event; this node's coroutine is blocked on that event's
// `.wait()`, so firing it is what actually runs the chain. Unlike
// interrupt's hard-IRQ-driven event (machine.Pin.irq() running in hard-IRQ
// context, the entire reason interrupt.ts needs the real thread-safety
// ThreadSafeEvent provides), TRIGGER always arrives from listener.py's own
// asyncio task -- ordinary soft/coroutine context, no hard-IRQ boundary is
// ever crossed here. ThreadSafeEvent is still reused rather than a plain
// `asyncio.Event`, for consistency with the one other event-source node
// this codebase has, and because it costs nothing extra: MicroPython's
// real vendored ThreadSafeEvent (device-runtime/src/vendor/threadsafe_event)
// has no construction-time loop-binding cost to avoid the way CPython's
// asyncio.Event does on Python 3.9 (see editor/test/fixtures/pymock/
// threadsafe_event.py's own header for that CPython-only hazard and how
// this project's off-device test stand-in works around it).
//
// The `startup` node (fire once automatically at boot, no click needed)
// is explicitly NOT built here -- a deliberate scope decision, tracked
// separately (docs/working-notes/outstanding-items/init-node-on-flow-
// start.md), not something this rewrite quietly drops. A flow that wants
// its old "runs once when deployed" behavior back needs that node once it
// exists; today, a freshly-deployed flow with only inject sources does
// nothing at all until a user clicks one.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition, PayloadType } from "../compiler/node-definition.js";
import { pyPayloadLiteral } from "./py-literals.js";

export const injectNode: NodeDefinition = {
  type: "thingstudio/inject",
  kind: "source",
  // The one dynamic port in the current node set (node-definition.ts's
  // PortType header comment) -- output type tracks the `payloadType`
  // property exactly the way codegenEventSource's own `payloadType` read
  // below does, so this can't drift from what actually gets emitted.
  // Falls back to "bool" for an unset/unrecognized value, matching
  // codegenEventSource's own `?? "bool"` default.
  ports: {
    outputs: [{ name: "msg", type: (properties) => (properties.payloadType as PayloadType | undefined) ?? "bool" }],
  },
  codegenEventSource(node: GraphNode, _ctx: CodegenContext): EventSourceCodegenResult {
    const payloadType = (node.properties.payloadType as string | undefined) ?? "bool";
    const payloadLiteral = pyPayloadLiteral(payloadType, node.properties.payloadValue, "inject payload");

    // Fixed, node-ID-derived variable name -- NOT ctx.uniqueName -- same
    // reasoning as interrupt.ts's own pin-derived names: this node's ID is
    // already unique within the flow (the compiler's own per-node ID), and
    // it's also exactly the string runtime.register_trigger needs to key
    // on, so deriving the Python variable name from it too keeps both
    // uses obviously in sync instead of tracking them as two separate
    // values that happen to agree today.
    const evtVar = `_inject_evt_${node.id}`;
    const nodeIdStr = String(node.id);

    return {
      imports: ["from threadsafe_event import ThreadSafeEvent"],
      statements: [
        {
          key: `inject-${node.id}`,
          code: [`${evtVar} = ThreadSafeEvent()`, `runtime.register_trigger(${JSON.stringify(nodeIdStr)}, ${evtVar})`].join("\n"),
        },
      ],
      waitStatement: `await ${evtVar}.wait()\n${evtVar}.clear()`,
      buildMsg: `msg = {'payload': ${payloadLiteral}, 'topic': ''}`,
    };
  },
};
