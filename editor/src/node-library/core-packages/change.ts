// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/change.ts
//
// A Node-RED-style change node (2026-10-21), replacing the hidden variable_get/variable_set pair: one rule per
// node, set or delete, targeting a msg property or a flow variable. A set copies a literal (string/number/bool) or
// another msg/flow value. Chain nodes for more than one rule.
//
// The flow store is the same runtime.shared('flow_vars') a function node's flow.get/set uses. Node context stays
// function-code only in v1: with one rule per node, a change node could set its own context but never read it.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/change",
  kind: "transform",
  paletteId: "change",
  label: "change",
  group: "general",
  priority: 24,
  color: "#4a5c7a",
  bgcolor: "#2a3445",
  icon: "✎",
  width: 118,
  description:
    "Sets or deletes one value: a msg property or a flow variable (shared with function nodes' flow.get/set). " +
    "Chain change nodes for more than one change.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    {
      name: "operation",
      label: "operation",
      kind: "select",
      default: "set",
      options: [
        { value: "set", label: "set" },
        { value: "delete", label: "delete" },
      ],
    },
    {
      name: "scope",
      label: "target",
      kind: "select",
      default: "msg",
      options: [
        { value: "msg", label: "msg property" },
        { value: "flow", label: "flow variable" },
      ],
    },
    { name: "property", label: "property / name", kind: "text", default: "payload" },
    {
      name: "valueFrom",
      label: "value from",
      kind: "select",
      default: "literal",
      options: [
        { value: "literal", label: "a literal value" },
        { value: "msg", label: "another msg property" },
        { value: "flow", label: "a flow variable" },
      ],
      visibleWhen: { field: "operation", equals: "set" },
    },
    {
      name: "valueType",
      label: "literal type",
      kind: "select",
      default: "string",
      options: [
        { value: "string", label: "string" },
        { value: "number", label: "number" },
        { value: "bool", label: "bool" },
      ],
      visibleWhen: { field: "valueFrom", equals: "literal" },
    },
    { name: "value", label: "value / source property", kind: "text", default: "", visibleWhen: { field: "operation", equals: "set" } },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `def compile(ctx, properties):
    operation = str(properties.get('operation') or 'set')
    if operation not in ('set', 'delete'):
        return {'errors': ['change operation "%s" must be set or delete' % operation]}
    scope = str(properties.get('scope') or 'msg')
    if scope not in ('msg', 'flow'):
        return {'errors': ['change target "%s" must be msg or flow' % scope]}
    prop = str(properties.get('property') or '').strip()
    for prefix in ('msg.', 'flow.'):
        if prop.startswith(prefix):
            prop = prop[len(prefix):]
    if not prop:
        return {'errors': ['change needs a property or variable name']}

    if operation == 'delete':
        return {'properties': {'operation': operation, 'scope': scope, 'property': prop}}

    value_from = str(properties.get('valueFrom') or 'literal')
    if value_from not in ('literal', 'msg', 'flow'):
        return {'errors': ['change value source "%s" must be literal, msg or flow' % value_from]}
    raw = properties.get('value')
    value_type = str(properties.get('valueType') or 'string')
    if value_from == 'literal':
        if value_type not in ('string', 'number', 'bool'):
            return {'errors': ['change literal type "%s" must be string, number or bool' % value_type]}
        if value_type == 'bool':
            value = raw == 'true' or raw is True
        elif value_type == 'number':
            try:
                n = float(raw if raw not in (None, '') else 0)
            except (TypeError, ValueError):
                return {'errors': ['change value "%s" is not a valid number' % raw]}
            value = int(n) if n == int(n) else n
        else:
            value = str(raw if raw is not None else '')
    else:
        value = str(raw if raw is not None else '').strip()
        for prefix in ('msg.', 'flow.'):
            if value.startswith(prefix):
                value = value[len(prefix):]
        if not value:
            return {'errors': ['change needs a source property or variable name']}
        value_type = 'string'
    return {'properties': {'operation': operation, 'scope': scope, 'property': prop,
                           'valueFrom': value_from, 'valueType': value_type, 'value': value}}
`;

export const python = `import runtime

_flow = runtime.shared('flow_vars', 'v1', 'v1', lambda: {})
_scope = properties['scope']
_property = properties['property']
_operation = properties['operation']
_value_from = properties.get('valueFrom', 'literal')
_source_key = properties.get('value', '')
_literal = properties.get('value')


def _target(msg):
    if _scope == 'msg':
        return msg
    return _flow


async def run(msg, properties):
    target = _target(msg)
    if _operation == 'delete':
        target.pop(_property, None)
        return msg
    if _value_from == 'msg':
        value = msg.get(_source_key)
    elif _value_from == 'flow':
        value = _flow.get(_source_key)
    else:
        value = _literal
    target[_property] = value
    return msg
`;
