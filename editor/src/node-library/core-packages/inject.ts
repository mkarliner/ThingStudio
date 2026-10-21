// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/inject.ts
//
// inject as a core package (2026-10-21). Event source: one ThreadSafeEvent per instance, registered with the runtime
// under the node's own id; a §13 TRIGGER sets it and the output face emits the configured payload. The payload is
// typed at run time from the text property -- no compile hook, so a flow with inject still compiles through the
// plain compiler (inject is the fixture almost every other node test uses).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { PAYLOAD_TYPE_PORT } from "../port-type-data.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/inject",
  kind: "source",
  eventSource: true,
  paletteId: "inject",
  label: "inject",
  group: "general",
  priority: 10,
  color: "#2e5c2e",
  bgcolor: "#1f3f1f",
  icon: "▶",
  width: 96,
  description: "Click this node on the canvas while connected to fire it once.",
  ports: {
    outputs: [{ name: "msg", type: PAYLOAD_TYPE_PORT }],
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
      ],
      retype: true,
    },
    { name: "payloadValue", label: "value", kind: "text", default: "true" },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `from threadsafe_event import ThreadSafeEvent
import runtime

_evt = ThreadSafeEvent()
runtime.register_trigger(properties['nodeId'], _evt)
_payload_type = properties['payloadType']
_raw_value = properties['payloadValue']


async def wait(properties):
    await _evt.wait()
    _evt.clear()


async def emit(properties):
    if _payload_type == 'bool':
        _payload = _raw_value == 'true'
    elif _payload_type == 'number':
        try:
            _number = float(_raw_value if _raw_value not in (None, '') else 0)
        except (TypeError, ValueError):
            raise ValueError("inject value %r is not a valid number" % (_raw_value,))
        _payload = int(_number) if _number == int(_number) else _number
    else:
        _payload = str(_raw_value if _raw_value is not None else '')
    return {'payload': _payload, 'topic': ''}
`;
