// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/i2c.ts
//
// A built-in expressed as a package (node-format-parity phase 4, option A): the same descriptor the
// TypeScript node-library/i2c-generic.ts carried, plus a `.node.py` (below) whose device behaviour the
// generic package codegen splices -- exactly like a user's custom node. `buildRegistry()` builds its
// NodeDefinition with buildCoreNodeDefinition(), and the editor's I2cNode class uses this descriptor; the TS
// i2c-generic.ts is retired.
//
// Property ranges (address/register/length) are checked at compile time by the generic codegen -- the `integer`
// attribute parses a text field (hex or decimal) into a number and range-checks it, and number `min`/`max` are
// enforced -- so i2c keeps its compile-time errors. The one residual deviation: a *missing* address (or bus) is
// caught at runtime, not compile time, because the field is conditionally required (only for read/write), which
// the format expresses as `optional` + a runtime guard rather than a conditional compile-time requirement.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/i2c",
  kind: "transform",
  paletteId: "i2c",
  label: "i2c device",
  group: "hardware",
  priority: 45,
  color: "#2e3f8a",
  bgcolor: "#1f2a4a",
  icon: "⇄",
  width: 90,
  description:
    "One transfer per incoming message. Read puts the bytes in msg.payload; scan puts the list of addresses that " +
    "answer. Hex (0x29) or decimal both work.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "i2cConfigId", label: "I2C bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "" },
    {
      name: "operation",
      label: "operation",
      kind: "select",
      default: "read",
      options: [
        { value: "read", label: "read bytes" },
        { value: "write", label: "write msg.payload" },
        { value: "scan", label: "scan the bus" },
      ],
    },
    { name: "address", label: "address", kind: "text", default: "", placeholder: "e.g. 0x29", integer: true, min: 0, max: 0x7f, optional: true, visibleWhen: { field: "operation", notEquals: "scan" } },
    { name: "register", label: "register", kind: "text", default: "", placeholder: "none", integer: true, min: 0, max: 0xff, optional: true, visibleWhen: { field: "operation", notEquals: "scan" } },
    { name: "length", label: "length (bytes)", kind: "number", default: 1, min: 1, max: 256, visibleWhen: { field: "operation", equals: "read" } },
    // Internal plumbing: the node's own id, so it can report its status (see packageCodegen / the nodeId kind).
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `import machine

_bus = properties['i2cConfigId']
_op = str(properties['operation'])
_node_id = properties['nodeId']
_address = properties['address']
_register = properties['register']
_length = properties['length']
_state = None

if _bus is None:
    raise ValueError('i2c: pick an I2C bus in the node properties')

_bus_num = int(_bus['bus'])
if _bus.get('scl') is None or _bus.get('sda') is None:
    raise ValueError('i2c: set the SCL and SDA pins on the I2C bus config')

# The same shared bus object Thingstudio's other I2C nodes use, keyed by bus id.
_i2c = runtime.shared('i2c', _bus_num, (_bus['scl'], _bus['sda'], _bus['freq']),
                      lambda: machine.I2C(_bus_num, scl=machine.Pin(_bus['scl']),
                                          sda=machine.Pin(_bus['sda']), freq=_bus['freq']))


def _to_bytes(v):
    if isinstance(v, (bytes, bytearray)):
        return v
    if isinstance(v, bool):
        raise ValueError('i2c write needs bytes, a list of 0-255, or one 0-255, got bool')
    if isinstance(v, int):
        v = [v]
    if isinstance(v, (list, tuple)):
        for b in v:
            if isinstance(b, bool) or not isinstance(b, int) or b < 0 or b > 255:
                raise ValueError('i2c write needs values 0-255, got %r' % (b,))
        return bytes(v)
    raise ValueError('i2c write needs bytes, a list of 0-255, or one 0-255, got %s' % type(v).__name__)


def _status(state, text):
    nonlocal _state
    if _state != (state, text):
        _state = (state, text)
        runtime.report_status(_node_id, state, text)


async def run(msg, properties):
    if _op == 'scan':
        try:
            msg['payload'] = _i2c.scan()
        except OSError:
            _status('disconnected', 'I2C bus %d not responding' % _bus_num)
            return None
        _status('connected', None)
        return msg

    if _address is None:
        raise ValueError('i2c: set the device address (7-bit, e.g. 0x29)')
    where = 'at 0x%02x on I2C bus %d' % (_address, _bus_num)

    if _op == 'read':
        try:
            if _register is None:
                msg['payload'] = _i2c.readfrom(_address, _length)
            else:
                msg['payload'] = _i2c.readfrom_mem(_address, _register, _length)
        except OSError:
            _status('disconnected', 'no reply %s' % where)
            return None
        _status('connected', None)
        return msg

    if _op == 'write':
        try:
            buf = _to_bytes(msg.get('payload'))
            if _register is None:
                _i2c.writeto(_address, buf)
            else:
                _i2c.writeto_mem(_address, _register, buf)
        except OSError:
            _status('disconnected', 'no reply %s' % where)
            return None
        except ValueError as e:
            _status('error', str(e))
            return None
        _status('connected', None)
        return msg

    raise ValueError('i2c: unknown operation "%s"' % _op)
`;
