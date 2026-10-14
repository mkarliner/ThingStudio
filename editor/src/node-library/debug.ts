// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/debug.ts
//
// Tier 1 software-only node -- "print a value to the editor's inspector"
// (design doc §6). Real inspector wiring (`VALUE_STREAM`, §13) is Tier 2
// live value streaming (mvp-feature-priorities.md) -- not built yet. For
// now this prints to the device's serial console, the same fallback
// every POC used before any real inspector existed; upgrading to also
// emit over VALUE_STREAM once that protocol path exists is additive to
// this node, not a redesign -- the node doesn't change shape, just what
// its generated call does.
//
// **`fullMessage` property, 2026-09-09** (outstanding-items/wifi-status-
// completeness.md): found while completing that item -- `wifi_status`'s
// envelope now carries `ip`/`subnet`/`gateway`/`dns`/`rssi` alongside
// `payload`, but this node printed only `payload`, so none of that was
// ever visible via debug (confirmed directly against real device output:
// `wifi_status` -> `debug` printed only `DEBUG node=... payload=True`).
// Node-RED's own debug node has the same default (payload-only) with an
// "output complete message" option -- `fullMessage` (default `false`,
// unset in every existing flow) is that same opt-in here, not a new
// default: existing flows' debug output is byte-for-byte unchanged unless
// a flow author explicitly turns it on.
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

export const debugNode: NodeDefinition = {
  type: "thingstudio/debug",
  kind: "sink",
  // Descriptor metadata (compiler/node-descriptor.ts): the canvas, palette, property panel and
  // catalog read these instead of palette.ts/PropertyPanel.vue's own copies -- debug is the first
  // family migrated onto the canonical descriptor (node-descriptor-unification-briefing.md).
  paletteId: "debug",
  label: "debug",
  group: "general",
  priority: 50,
  color: "#2e4a6e",
  bgcolor: "#1f2c3f",
  icon: "≡",
  width: 84,
  description: "Prints a message to the device console.",
  // `any` in -- debug prints whatever payload it receives (`msg.get
  // ('payload')` below, unconditionally), so it accepts every source type,
  // same reasoning as function's own `any` input.
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    {
      name: "fullMessage",
      label: "full message",
      kind: "boolean",
      default: false,
      help: "Print the whole message (topic and any extra fields a source adds) instead of just payload.",
    },
  ],
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const fullMessage = node.properties.fullMessage === true;
    const functionBody = fullMessage
      ? `print("DEBUG node=${node.id} msg=%r" % (msg,))`
      : `print("DEBUG node=${node.id} payload=%r" % (msg.get('payload'),))`;
    return {
      functionName: ctx.uniqueName("debug"),
      functionBody,
    };
  },
};
