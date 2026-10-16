// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/gpio-out.ts
//
// The gpio_out built-in as a package (node-format-parity phase 4, option A): the same descriptor the
// TypeScript node-library/gpio-out.ts carried, plus its device `.node.py`. The pin is claimed as an output
// (matching hardware-shared.ts's sharedPin) and is a keyed singleton via runtime.shared('pin', ...).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/gpio_out",
  kind: "sink",
  paletteId: "gpio_out",
  label: "gpio out",
  group: "hardware",
  priority: 20,
  color: "#6e3b3b",
  bgcolor: "#3f1f1f",
  icon: "■",
  width: 104,
  ports: {
    inputs: [{ name: "signal", type: "bool" }],
  },
  properties: [{ name: "pin", label: "pin", kind: "pin", default: 12, pinUse: "output" }],
};

export const python = `import machine

# The pin is a keyed singleton (hardware-shared.ts), shared with any other node on it.
_pin = runtime.shared('pin', properties['pin'], ('out', 'none'), lambda: machine.Pin(properties['pin'], machine.Pin.OUT))


async def run(msg, properties):
    _pin.value(1 if msg.get('payload') else 0)
`;
