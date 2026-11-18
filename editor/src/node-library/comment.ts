// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/comment.ts
//
// The comment node (Mike, 2026-11-18): text on the canvas, nothing on the board. Node-RED has the same node. For
// instructions beside the node they're about ("set pin to your board's LED"), in examples and tutorials, where
// the Notes panel goes unread. canvasOnly: the compiler leaves it out entirely (compile.ts). canvasText: the
// canvas shows `text`, in a box `width` characters wide and at most `lines` lines tall (ThingstudioNode.vue).

import type { NodeDefinition } from "../compiler/node-definition.js";

export const commentNode: NodeDefinition = {
  type: "thingstudio/comment",
  kind: "source",
  canvasOnly: true,
  allowUnwired: true,
  paletteId: "comment",
  label: "comment",
  group: "general",
  priority: 90,
  color: "#5a5f6b",
  bgcolor: "#23262d",
  icon: "¶",
  description: "A note on the canvas. Does nothing on the board.",
  canvasText: { property: "text", widthProperty: "width", maxLinesProperty: "lines" },
  properties: [
    { name: "text", label: "text", kind: "textarea", default: "", rows: 5, help: "Shown on the canvas. Nothing is sent to the board." },
    { name: "width", label: "width (characters)", kind: "number", default: 32, min: 10, max: 120, step: 1 },
    { name: "lines", label: "max lines", kind: "number", default: 8, min: 1, max: 60, step: 1, help: "Longer text is cut off." },
  ],
};
