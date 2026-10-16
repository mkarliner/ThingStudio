// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/debug.ts
//
// The debug built-in as a package (node-format-parity phase 4, option A): the same descriptor the TypeScript
// node-library/debug.ts carried, plus its device `.node.py`. `fullMessage` picks the whole msg or just payload.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/debug",
  kind: "sink",
  paletteId: "debug",
  label: "debug",
  group: "general",
  priority: 50,
  color: "#2e4a6e",
  bgcolor: "#1f2c3f",
  icon: "≡",
  width: 84,
  description: "Prints a message to the device console.",
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
    // Internal plumbing: the node's own id, for "DEBUG node=<id>".
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `async def run(msg, properties):
    if properties['fullMessage']:
        print("DEBUG node=%s msg=%r" % (properties['nodeId'], msg))
    else:
        print("DEBUG node=%s payload=%r" % (properties['nodeId'], msg.get('payload')))
`;
