// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/interrupt.ts
//
// Event-driven GPIO input as a core package (node-format-parity phase 4, option A). Same descriptor the TypeScript
// interrupt.ts carried, minus `debounce`/`debounceMs` (Mike, 2026-10-16: redundant now that eswitch/ebutton own
// debounce for the switch/button case; a raw edge node doesn't need its own cooldown). Dropping debounce also let
// this node port: its buildMsg no longer needs to drop a wake, so it fits the package event-source shape. The
// `resources` entry claims the pin as an input and adds the derived "{pin} interrupt" claim (edge); the Python
// fetches the shared Pin through runtime.shared('pin', ...).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/interrupt",
  kind: "source",
  eventSource: true,
  paletteId: "interrupt",
  label: "interrupt",
  group: "hardware",
  priority: 10,
  color: "#8a5a1f",
  bgcolor: "#3f2e14",
  icon: "⚡",
  width: 104,
  description:
    "Sends a message the moment a pin changes state. Needs an external pull resistor. For a button or switch, use " +
    "ebutton or eswitch, which debounce it.",
  ports: {
    outputs: [{ name: "msg", type: "bool" }],
  },
  resources: [{ kind: "pin", property: "pin", direction: "input", claim: { resource: "{pin} interrupt", use: "{edge} edge" } }],
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 4 },
    {
      name: "edge",
      label: "edge",
      kind: "select",
      default: "rising",
      options: [
        { value: "rising", label: "rising" },
        { value: "falling", label: "falling" },
        { value: "both", label: "both" },
      ],
    },
  ],
};

export const python = `import machine
from threadsafe_event import ThreadSafeEvent

_pin_num = properties['pin']
_edge = str(properties['edge'])

_pin = runtime.shared('pin', _pin_num, ('in', 'none'), lambda: machine.Pin(_pin_num, machine.Pin.IN))
_evt = ThreadSafeEvent()


def _handler(pin):
    _evt.set()


if _edge == 'rising':
    _trigger = machine.Pin.IRQ_RISING
elif _edge == 'falling':
    _trigger = machine.Pin.IRQ_FALLING
else:
    _trigger = machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING
_pin.irq(trigger=_trigger, handler=_handler)


async def wait(properties):
    await _evt.wait()
    _evt.clear()


async def emit(properties):
    return {'payload': bool(_pin.value()), 'topic': ''}
`;
