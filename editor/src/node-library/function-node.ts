// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/function-node.ts
//
// Ported from pocs/poc-d/nodes.js and pocs/poc-d/compiler.js. Pattern 3 from
// node-definition-model.md: the one node type whose device-side
// implementation is written by the flow author, not the node's
// implementer -- the `code` property is inlined verbatim as the
// function's body.
//
// `context`/`flow` scopes added per mvp-feature-priorities.md's
// 2026-08-14 addendum ("stateful nodes and cross-message
// synchronization") -- the general fix for a real hands-on gap
// (editor-hands-on-briefing.md): "why doesn't inject -> invert-payload
// function -> gpio_out flash the LED" -- it can't, because inject
// rebuilds the same literal payload from scratch every tick, so a
// downstream function always inverts the same starting value to the
// same result. `timer` (timer.ts) works around that one case with a
// hardcoded per-instance counter; this is the general mechanism a flow
// author can reach for from any function node, matching Node-RED's own
// `context`/`flow` get/set available directly inside Function node code.
//
// Two scopes, not three: `global` (Node-RED's third scope, shared
// *across* flows) is moot for now -- design doc §6 is single-flow-per-
// device in v1, nothing to be global across yet.
//   - `context`: private to ONE function node instance. A fresh dict per
//     instance (`ctx.uniqueName` guarantees no collision between two
//     function nodes, the same mechanism timer.ts already relies on for
//     its own per-instance counter).
//   - `flow`: shared flow-wide -- backed by the SAME dict
//     variable_get/variable_set already read/write (`FLOW_VARS_DICT` from
//     variable-set.ts), not a second, disconnected flow-scope store. A
//     function node's `flow.get('x')`/`flow.set('x', ...)` and a
//     variable_get/variable_set node named "x" interoperate directly.
//
// Both scopes are exposed as a tiny `_Store` wrapper (get/set methods,
// matching Node-RED's own context/flow API shape) around a plain dict --
// declared once (deduped by `key`, same pattern every other shared-setup
// node in this library uses) regardless of how many function nodes are
// in the flow. `context`/`flow` are bound as ordinary local names at the
// top of the generated function body -- a plain read of the module-level
// `_Store` instance, no `global` declaration needed, since the function
// body never rebinds the module-level name itself, only calls methods on
// it (same reasoning variable-set.ts's `_flow_vars[key] = value` already
// relies on: mutating what a global name points to needs no `global`
// keyword, only rebinding the name itself does).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { FLOW_VARS_DICT } from "./variable-set.js";

const CONTEXT_STORE_CLASS = `class _Store:
    def __init__(self, d):
        self._d = d
    def get(self, key, default=None):
        return self._d.get(key, default)
    def set(self, key, value):
        self._d[key] = value`;

// Node-RED's own function-edit dialog has no hard cap on output count in
// the UI; an unbounded stepper here just invites fat-fingering an absurd
// port fan-out for no real use case. 10 is a generous, arbitrary-but-
// reasonable ceiling -- not a wire-format or protocol limit (GraphLink's
// slot fields are plain numbers, node-definition-model.md), so raising it
// later costs nothing beyond changing this one constant.
/** Removes the leading whitespace every non-blank line shares, like Python's textwrap.dedent. */
export function dedent(code: string): string {
  const lines = code.split("\n");
  let common: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const lead = /^[ \t]*/.exec(line)![0];
    if (common === null) common = lead;
    else {
      let n = 0;
      while (n < common.length && n < lead.length && common[n] === lead[n]) n++;
      common = common.slice(0, n);
    }
    if (common === "") return code;
  }
  if (!common) return code;
  return lines.map((l) => (l.startsWith(common!) ? l.slice(common!.length) : l.trim() === "" ? "" : l)).join("\n");
}

export const MAX_FUNCTION_OUTPUTS = 10;

export const functionNode: NodeDefinition = {
  type: "thingstudio/function",
  kind: "transform",
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "function",
  label: "function",
  group: "general",
  priority: 30,
  color: "#6e5b2e",
  bgcolor: "#3f341f",
  icon: "ƒ",
  width: 100,
  description:
    "The body of a MicroPython function: `msg` in, return the message, None, or a list with one entry per " +
    "output. `context` (this node only) and `flow` (shared flow-wide) hold state between messages.",
  // `any` in, `any` out -- the flow author's code can do anything to
  // `msg.payload` (verbatim user code, per this file's own header), so
  // there's no narrower static type to declare here. This is also what
  // makes `function -> gpio_out` (an `any` output into a `bool` input)
  // the wire-type-system-scoping.md-called-out common case that needs no
  // conversion node: bucket 1's "anything -> bool" allow covers it
  // (sockets.ts).
  //
  // Single "any" entry regardless of the node's actual output count --
  // `dynamicOutputs` below is what tells the canvas and compile.ts how many
  // outputs THIS INSTANCE really has (per-instance, unlike every other node
  // type's fixed port list); every output on a function node is equally
  // untyped `any` regardless of index, so one entry fully describes the
  // TYPE every output shares. Count is a separate question, answered below.
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  // Node-RED-style configurable output count (multi-output-port support,
  // docs/working-notes/outstanding-items/connection-state-gate-router-nodes.md,
  // 2026-09-12): a per-instance property, expressed as data (the descriptor's
  // `dynamicOutputs`) rather than a codegen hook. A missing or non-numeric
  // `properties.outputCount` -- every flow saved before this feature existed
  // -- resolves to 1, preserving the original single-output contract exactly;
  // compile.ts's emit() only takes the multi-output path at all once this
  // resolves to more than 1.
  dynamicOutputs: { property: "outputCount", min: 1, max: MAX_FUNCTION_OUTPUTS, namePrefix: "out", rowHeightPx: 18 },
  properties: [
    { name: "code", label: "code", kind: "textarea", rows: 10, default: "msg['payload'] = msg['payload']\nreturn msg\n" },
    {
      name: "outputCount",
      label: "outputs",
      kind: "number",
      default: 1,
      min: 1,
      max: MAX_FUNCTION_OUTPUTS,
      help:
        "Return an array to route to multiple outputs, Node-RED style: e.g. `return [msg, null]` sends to output 1 " +
        "only. A plain `return msg` still works and always targets output 1.",
    },
  ],
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    // Dedented: code pasted with every line indented the same (copied out of a list in a chat or a doc) would
    // otherwise fail with "IndentationError: unexpected indent" on code that's fine (Mike, 2026-10-12).
    const userCode = dedent(String(node.properties.code ?? "").replace(/\r\n/g, "\n"));
    if (!userCode.trim()) throw new CompileError("function node's code is empty");

    // Node-instance-private store: a fresh dict per function node
    // instance, wrapped inline in its own _Store -- never shared with any
    // other node, including another function node using the same key
    // name.
    const contextVar = ctx.uniqueName("ctx");

    return {
      statements: [
        { key: "context-store-class", code: CONTEXT_STORE_CLASS },
        { key: "flow-vars-dict", code: `${FLOW_VARS_DICT} = {}` },
        { key: "flow-context-obj", code: `_flow_ctx = _Store(${FLOW_VARS_DICT})` },
        { key: contextVar, code: `${contextVar} = _Store({})` },
      ],
      functionName: ctx.uniqueName("function"),
      functionBody: `context = ${contextVar}\nflow = _flow_ctx\n${userCode}`,
    };
  },
};
