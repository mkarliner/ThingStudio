// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/filter.ts
//
// Filter / event compression as a core package (node-format-parity phase 4, option A). The descriptor is the
// TypeScript filter.ts's data half; the `.node.py` is its codegen ported. A hand-port, not a free generator:
// the built-in emitted a module-level state dict and a shared number helper per flow, while a package wraps its
// whole body in one per-instance closure -- so the state and helper become closure locals, and `global` becomes
// `nonlocal`. Behaviour is identical; the number helper is no longer shared between two filters (the accepted
// package-vs-built-in difference, builtins-as-packages-scoping.md §14).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

/** Topics tracked per node before the table is cleared (see the header). */
export const FILTER_MAX_TOPICS = 32;

export const descriptor: NodeDescriptor = {
  type: "thingstudio/filter",
  kind: "transform",
  paletteId: "filter",
  label: "filter",
  group: "general",
  priority: 35,
  color: "#2e6e4a",
  bgcolor: "#1f3f2c",
  icon: "▽",
  width: 100,
  description:
    "Passes a message on only when it's worth sending, and drops the rest. Messages that pass are unchanged.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    {
      name: "mode",
      label: "mode",
      kind: "select",
      default: "change",
      options: [
        { value: "change", label: "change: only when the payload changes" },
        { value: "deadband", label: "deadband: only when a number moves enough" },
        { value: "rate", label: "rate: at most one per interval" },
      ],
    },
    { name: "threshold", label: "threshold", kind: "number", default: 1, min: 0, step: "any", visibleWhen: { field: "mode", equals: "deadband" } },
    { name: "intervalMs", label: "interval (ms)", kind: "number", default: 1000, min: 1, visibleWhen: { field: "mode", equals: "rate" } },
    { name: "ignoreFirst", label: "ignore first message", kind: "boolean", default: false, visibleWhen: { field: "mode", notEquals: "rate" } },
    { name: "perTopic", label: "separately for each topic", kind: "boolean", default: true },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `import time

_node_id = properties['nodeId']
_mode = properties['mode']
_threshold = properties['threshold']
_interval_ms = properties['intervalMs']
_ignore_first = properties['ignoreFirst']
_per_topic = properties['perTopic']

_state = {}
_full_warned = False
_nan_warned = False


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (bytes, bytearray)):
        try:
            v = v.decode()
        except Exception:
            return None
    if isinstance(v, str):
        try:
            v = float(v.strip())
        except ValueError:
            return None
    if not isinstance(v, (int, float)):
        return None
    v = float(v)
    if v != v or v in (float('inf'), float('-inf')):
        return None
    return v


async def run(msg, properties):
    nonlocal _state, _full_warned, _nan_warned
    if _per_topic:
        _k = msg.get('topic', '')
        if not isinstance(_k, str):
            _k = str(_k)
    else:
        _k = ''
    if _k not in _state and len(_state) >= 32:
        _state.clear()
        if not _full_warned:
            _full_warned = True
            print("FILTER_INFO node=%s more than 32 topics, starting again" % _node_id)

    if _mode == 'change':
        _v = msg['payload']
        if _k in _state:
            if _state[_k] == _v:
                return None
            _state[_k] = _v
            return msg
        _state[_k] = _v
        return None if _ignore_first else msg

    if _mode == 'deadband':
        _n = _num(msg['payload'])
        if _n is None:
            if not _nan_warned:
                _nan_warned = True
                runtime._report_error(_node_id, ValueError("deadband needs a number, got %s %r" % (type(msg['payload']).__name__, msg['payload'])))
            return None
        _nan_warned = False
        if _k in _state:
            if abs(_n - _state[_k]) < _threshold:
                return None
            _state[_k] = _n
            return msg
        _state[_k] = _n
        return None if _ignore_first else msg

    # rate
    _now = time.ticks_ms()
    if _k in _state and time.ticks_diff(_now, _state[_k]) < _interval_ms:
        return None
    _state[_k] = _now
    return msg
`;
