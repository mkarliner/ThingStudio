// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/startup.ts
//
// startup as a core package (2026-10-21). A run-once source: the generated flow runs its emit once at flow start.
// `reason` sends runtime.start_reason as the payload; every message also carries it as msg.reason. The payload is
// typed at run time from the text property, so no compile hook is needed (the plain compiler handles it).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { STARTUP_PAYLOAD_TYPE_PORT } from "../port-type-data.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/startup",
  kind: "source",
  runOnce: true,
  paletteId: "startup",
  label: "startup",
  group: "general",
  priority: 11,
  color: "#5c5c2e",
  bgcolor: "#3a3a1f",
  icon: "⏻",
  width: 104,
  description:
    "Sends this once each time the flow starts: after Deploy, and after the board resets or powers up. msg.reason " +
    "says which.",
  ports: {
    outputs: [{ name: "msg", type: STARTUP_PAYLOAD_TYPE_PORT }],
  },
  properties: [
    {
      name: "payloadType",
      label: "payload type",
      kind: "select",
      default: "bool",
      options: [
        { value: "bool", label: "bool" },
        { value: "number", label: "number" },
        { value: "string", label: "string" },
        { value: "reason", label: "start reason" },
      ],
      retype: true,
    },
    { name: "payloadValue", label: "value", kind: "text", default: "true", visibleWhen: { field: "payloadType", notEquals: "reason" } },

  ],
};

export const python = `import runtime

_REASON = getattr(runtime, 'start_reason', 'unknown')
_payload_type = properties['payloadType']
_raw_value = properties['payloadValue']


async def emit(properties):
    if _payload_type == 'reason':
        _payload = _REASON
    elif _payload_type == 'bool':
        _payload = _raw_value == 'true'
    elif _payload_type == 'number':
        try:
            _number = float(_raw_value if _raw_value not in (None, '') else 0)
        except (TypeError, ValueError):
            raise ValueError("startup value %r is not a valid number" % (_raw_value,))
        _payload = int(_number) if _number == int(_number) else _number
    else:
        _payload = str(_raw_value if _raw_value is not None else '')
    return {'payload': _payload, 'topic': '', 'reason': _REASON}
`;
