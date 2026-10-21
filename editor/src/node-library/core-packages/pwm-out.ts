// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/pwm-out.ts
//
// PWM output as a core package (node-format-parity phase 4, option A). Same descriptor the TypeScript pwm-out.ts
// carried, plus a `.node.py` ported from its codegen. The `resources` entry claims the pin as an output with the
// "PWM at N Hz" use text (resource-check.ts), and the Python fetches the shared machine.PWM through
// runtime.shared('pwm', ...) -- the same on-device keyed singleton hardware-shared.ts's sharedPwm used.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/pwm_out",
  kind: "sink",
  paletteId: "pwm_out",
  label: "pwm out",
  group: "hardware",
  priority: 30,
  color: "#1f5c8a",
  bgcolor: "#12334a",
  icon: "∿",
  width: 104,
  description: "Drives a PWM signal on a pin, for dimming an LED or setting a motor's speed.",
  ports: {
    inputs: [{ name: "duty", type: "number" }],
  },
  resources: [{ kind: "pin", property: "pin", direction: "output", use: "PWM at {freq} Hz" }],
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 12 },
    { name: "freq", label: "frequency (Hz)", kind: "number", default: 1000, min: 1 },
  ],
};

export const python = `import machine

_pin = properties['pin']
_freq = properties['freq']

_pwm = runtime.shared('pwm', _pin, (_freq,),
                      lambda: machine.PWM(machine.Pin(_pin, machine.Pin.OUT), freq=_freq))


async def run(msg, properties):
    _pwm.duty_u16(int(max(0.0, min(1.0, msg.get('payload', 0))) * 65535))
`;
