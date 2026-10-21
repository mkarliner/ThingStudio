// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/timer.ts
//
// The timer built-in as a package (node-format-parity phase 4, option A): the same descriptor the TypeScript
// node-library/timer.ts carried, plus its device `.node.py`. The generic package codegen reads `intervalMs` for
// the poll loop's repeat period, the same field a custom source uses (custom-node.ts's resolveIntervalMs).
// Each instance gets its own counter in its setup closure, so two timers on one canvas count independently.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/timer",
  kind: "source",
  paletteId: "timer",
  label: "timer",
  group: "general",
  priority: 20,
  color: "#5b3b6e",
  bgcolor: "#331f3f",
  icon: "◷",
  width: 84,
  description: "Sends an increasing count at a fixed interval.",
  // The counter is a genuine Python int -- `int`, not `number`, is the precise type; `int -> number`
  // widening (bucket 2, sockets.ts) still feeds a `number`-typed input with no friction.
  ports: {
    outputs: [{ name: "msg", type: "int" }],
  },
  properties: [{ name: "intervalMs", label: "interval (ms)", kind: "number", default: 1000, min: 1 }],
};

export const python = `_count = 0


async def emit(properties):
    nonlocal _count
    _count += 1
    return {'payload': _count, 'topic': ''}
`;
