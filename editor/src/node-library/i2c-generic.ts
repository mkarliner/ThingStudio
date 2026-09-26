// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/i2c-generic.ts
//
// Generic I2C node (2026-09-26, Mike: "a generic i2c node"). For a device with no node of its own: each message
// that arrives does one transfer on the flow's shared I2C bus (i2c-shared.ts) and sends the result on.
//
//   read  -- reads `length` bytes, from `register` if set; msg['payload'] becomes the bytes.
//   write -- writes msg['payload'] (bytes, bytearray, a list of 0-255 ints, or one int), to `register` if set;
//            the message goes on unchanged, so a write can trigger a following read.
//   scan  -- msg['payload'] becomes the list of addresses that answer.
// Every other msg key is kept. Registers are 8-bit (MicroPython's addrsize default).
//
// Fault handling, same as bme280.ts: a transform that raises ends its source's whole loop (runtime._guarded is per
// task), so this never raises. A failed transfer sends nothing and sets the status dot -- disconnected ("no reply
// at 0x29 on I2C bus 0") for OSError, error with the message for a payload it can't write. The status is only sent
// when it changes; a good transfer sets connected.
//
// Board-to-board messaging over I2C (machine.I2CTarget) is a separate, post-MVP idea -- outstanding-items.md.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";
import { resolveI2cBus } from "./i2c-shared.js";

export const I2C_OPERATIONS = ["read", "write", "scan"] as const;

// Turns a write payload into bytes, or raises ValueError saying what it got. Shared by every i2c node in a flow.
const TO_BYTES_HELPER = `def _i2c_to_bytes(v):
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
    raise ValueError('i2c write needs bytes, a list of 0-255, or one 0-255, got %s' % type(v).__name__)`;

function optionalInt(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return Number(value);
}

export const i2cGenericNode: NodeDefinition = {
  type: "thingstudio/i2c",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const bus = resolveI2cBus(ctx, "i2c", node.properties.i2cConfigId);
    const op = String(node.properties.operation ?? "read");
    if (!(I2C_OPERATIONS as readonly string[]).includes(op)) {
      throw new CompileError(`i2c operation "${op}" must be one of ${I2C_OPERATIONS.join(", ")}`);
    }
    const id = JSON.stringify(String(node.id));
    const state = ctx.uniqueName("i2c_state");
    const statements = [bus.statement, { key: state, code: `${state} = None` }];
    const b = bus.varName;

    let action: string[];
    let where = `on I2C bus ${bus.bus}`;
    if (op === "scan") {
      action = [`msg['payload'] = ${b}.scan()`];
    } else {
      const address = optionalInt(node.properties.address);
      if (address === null || !Number.isInteger(address) || address < 0 || address > 0x7f) {
        throw new CompileError(`i2c address "${String(node.properties.address ?? "")}" must be a 7-bit address, 0-127 (0x00-0x7f)`);
      }
      const register = optionalInt(node.properties.register);
      if (register !== null && (!Number.isInteger(register) || register < 0 || register > 0xff)) {
        throw new CompileError(`i2c register "${String(node.properties.register)}" must be 0-255 (0x00-0xff), or empty for none`);
      }
      where = `at 0x${address.toString(16).padStart(2, "0")} ${where}`;
      if (op === "read") {
        const length = optionalInt(node.properties.length) ?? 1;
        if (!Number.isInteger(length) || length < 1 || length > 256) {
          throw new CompileError(`i2c length "${String(node.properties.length)}" must be 1-256 bytes`);
        }
        action = [register === null ? `msg['payload'] = ${b}.readfrom(${address}, ${length})` : `msg['payload'] = ${b}.readfrom_mem(${address}, ${register}, ${length})`];
      } else {
        statements.push({ key: "_i2c_to_bytes", code: TO_BYTES_HELPER });
        action = [
          "_buf = _i2c_to_bytes(msg.get('payload'))",
          register === null ? `${b}.writeto(${address}, _buf)` : `${b}.writeto_mem(${address}, ${register}, _buf)`,
        ];
      }
    }

    const setStatus = (st: string, text: string) => [
      `    if ${state} != (${st}, ${text}):`,
      `        ${state} = (${st}, ${text})`,
      `        runtime.report_status(${id}, ${st}, ${text})`,
    ];
    const body = [
      `global ${state}`,
      "try:",
      ...action.map((l) => "    " + l),
      "except OSError:",
      ...setStatus("'disconnected'", JSON.stringify(op === "scan" ? `I2C bus ${bus.bus} not responding` : `no reply ${where}`)),
      "    return None",
      "except ValueError as _e:",
      ...setStatus("'error'", "str(_e)"),
      "    return None",
      ...setStatus("'connected'", "None").map((l) => l.slice(4)),
      "return msg",
    ];

    return {
      imports: ["import machine"],
      statements,
      functionName: ctx.uniqueName("i2c"),
      functionBody: body.join("\n"),
    };
  },
};
