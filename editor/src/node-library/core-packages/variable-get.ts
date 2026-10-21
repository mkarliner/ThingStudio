// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/variable-get.ts
//
// variable_get as a core package (2026-10-21). Reads the named value from the flow-wide store and puts it in
// msg.payload, passing the rest of msg through. The store is runtime.shared('flow_vars') -- the same dict
// variable_set and a function node's flow.get/set use. The hook types the default and rejects an empty name.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { PAYLOAD_TYPE_PORT } from "../port-type-data.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/variable_get",
  kind: "transform",
  paletteId: "variable_get",
  label: "get variable",
  group: "general",
  priority: 22,
  color: "#3a5c5c",
  bgcolor: "#1f3a3a",
  icon: "↧",
  width: 108,
  description: "Reads a named flow variable into msg.payload, or the configured default if it was never set.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: PAYLOAD_TYPE_PORT }],
  },
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
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
    { name: "default", label: "default", kind: "text", default: "false" },
  ],
};

export const compileHook = `def compile(ctx, properties):
    name = str(properties.get('name') or '').strip()
    if not name:
        return {'errors': ["variable_get node's name is empty"]}
    payload_type = str(properties.get('payloadType') or 'bool')
    if payload_type not in ('bool', 'number', 'string'):
        return {'errors': ['variable_get payload type "%s" must be bool, number or string' % payload_type]}
    raw = properties.get('default')
    if payload_type == 'bool':
        value = raw == 'true' or raw is True
    elif payload_type == 'number':
        try:
            n = float(raw if raw not in (None, '') else 0)
        except (TypeError, ValueError):
            return {'errors': ['variable_get default "%s" is not a valid number' % raw]}
        value = int(n) if n == int(n) else n
    else:
        value = str(raw if raw is not None else '')
    return {'properties': {'name': name, 'payloadType': payload_type, 'default': value}}
`;

export const python = `import runtime

_vars = runtime.shared('flow_vars', 'v1', 'v1', lambda: {})


async def run(msg, properties):
    msg['payload'] = _vars.get(properties['name'], properties['default'])
    return msg
`;
