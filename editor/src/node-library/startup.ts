// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/startup.ts
//
// docs/working-notes/inject-node-live-fire-and-startup-node.md: fires its
// msg exactly once, automatically, at flow start -- both right after a
// DEPLOY and after a bare device reset that auto-resumes the previously
// persisted flow (device-runtime/src/listener.py's boot-time resume; see
// that file's own header once it exists). Mike's explicit call: this is a
// genuinely separate node from `inject`, not a checkbox on it, because
// "fires at boot/reset" is a different and more useful thing than "fires
// at deploy" -- deploy only happens while the editor is connected, but a
// standalone device that loses power and comes back should still run its
// startup logic with nobody watching.
//
// Structurally this is exactly what `inject` looked like before the fire/
// startup split: codegenSource with a hardcoded repeatMs of 0
// ("run once, then stop" -- SourceCodegenResult's own doc comment), the
// existing, already-tested pattern that requires no new compiler
// machinery. No `repeat` property at all (never had presets to drop --
// this node's whole point is "runs once, unconditionally"), and no fire
// button in the property panel either (PropertyPanel.vue only offers Fire
// for `codegenFireableSource` node types).

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, PayloadType, SourceCodegenResult } from "../compiler/node-definition.js";
import type { NodeDefinition } from "../compiler/node-definition.js";
import { pyPayloadLiteral } from "./py-literals.js";

export const startupNode: NodeDefinition = {
  type: "thingstudio/startup",
  kind: "source",
  // Same dynamic-output-type pattern as inject's own single port (see that
  // file's header comment) -- output type tracks `payloadType` exactly.
  ports: {
    outputs: [{ name: "msg", type: (properties) => (properties.payloadType as PayloadType | undefined) ?? "bool" }],
  },
  codegenSource(node: GraphNode, _ctx: CodegenContext): SourceCodegenResult {
    const payloadType = (node.properties.payloadType as string | undefined) ?? "bool";
    const payloadLiteral = pyPayloadLiteral(payloadType, node.properties.payloadValue, "startup payload");

    return {
      buildMsg: `msg = {'payload': ${payloadLiteral}, 'topic': ''}`,
      repeatMs: 0,
    };
  },
};
