// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/delay.ts
//
// The delay built-in as a package (node-format-parity phase 4, option A): the same descriptor the TypeScript
// node-library/delay.ts carried, plus its device `.node.py`. `asyncio` is already in scope (the generated flow
// does `asyncio = runtime.asyncio`). The `delayMs` `min` is enforced at compile time by the generic codegen.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/delay",
  kind: "transform",
  paletteId: "delay",
  label: "delay",
  group: "general",
  priority: 40,
  color: "#4a4a6e",
  bgcolor: "#2a2a3f",
  icon: "⌛",
  width: 100,
  description: "Passes each message on unchanged, after waiting the delay.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [{ name: "delayMs", label: "delay (ms)", kind: "number", default: 1000, min: 1 }],
};

export const python = `async def run(msg, properties):
    await asyncio.sleep_ms(int(properties['delayMs']))
    return msg
`;
