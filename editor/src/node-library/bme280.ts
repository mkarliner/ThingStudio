// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/bme280.ts
//
// BME280 / BMP280 environment sensor (2026-09-26; first I2C sensor node, outstanding-items/
// i2c-spi-sensor-nodes.md). A source: every `intervalMs` it reads the sensor and sends
//   msg = {'payload': {'temperature': C, 'humidity': % or None, 'pressure': hPa}, 'topic': ''}
// (Mike's call: a dict payload, Node-RED style). A BMP280 is accepted too, with humidity None.
//
// Bus: a shared I2C bus config (i2c-shared.ts), so a display and this sensor can share wires.
// Driver: vendored robert-hh bme280_float.py with local patches (device-runtime/src/vendor/bme280/README.md) --
// chip-id check, BMP280 support, and read_async(), which waits for the conversion with asyncio instead of
// blocking every other task for ~60 ms.
//
// Fault handling (the stuck/missing-I2C-device question Mike raised 2026-08-16): MicroPython's I2C calls are
// bounded by the port's own I2C timeout, so a missing or dead device raises OSError rather than hanging; the
// driver's own wait is bounded too (RuntimeError "not ready"). Nothing here raises out of the source loop --
// that would end the node for good. Instead a failed read sends no message, drops the driver object (so a
// sensor that was unplugged and replugged is set up again), and sets the node's status dot:
//   connected ("BME280"/"BMP280") -> disconnected ("no reply at 0x76 on I2C bus 0") for OSError,
//   error (the message, e.g. "no BME280/BMP280 at 0x76 (chip id 0x55)") for anything else.
// The status is only sent when it changes. The sensor isn't touched at flow start, so a missing sensor can't
// stop the flow loading, and one plugged in later just starts working.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { resolveI2cBus } from "./i2c-shared.js";

export const BME280_ADDRESSES = [0x76, 0x77];

export const bme280Node: NodeDefinition = {
  type: "thingstudio/bme280",
  kind: "source",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const bus = resolveI2cBus(ctx, "bme280", node.properties.i2cConfigId);
    const address = Number(node.properties.address ?? 0x76);
    if (!BME280_ADDRESSES.includes(address)) {
      throw new CompileError(`bme280 address "${String(node.properties.address)}" must be 0x76 (118) or 0x77 (119)`);
    }
    const intervalMs = Number(node.properties.intervalMs ?? 5000);
    if (!Number.isInteger(intervalMs) || intervalMs < 100) {
      throw new CompileError(`bme280 interval "${String(node.properties.intervalMs)}" must be a whole number of ms, 100 or more`);
    }

    const id = JSON.stringify(String(node.id));
    const hex = `0x${address.toString(16)}`;
    const dev = ctx.uniqueName("bme280_dev");
    const state = ctx.uniqueName("bme280_state");

    const setStatus = (st: string, text: string) =>
      [`if ${state} != (${st}, ${text}):`, `    ${state} = (${st}, ${text})`, `    runtime.report_status(${id}, ${st}, ${text})`];
    const indent = (lines: string[]) => lines.map((l) => "    " + l);

    const buildMsg = [
      `global ${dev}, ${state}`,
      "msg = None",
      "try:",
      `    if ${dev} is None:`,
      `        ${dev} = bme280_float.BME280(i2c=${bus.varName}, address=${address})`,
      `    _t, _p, _h = await ${dev}.read_async()`,
      "except OSError:",
      `    ${dev} = None`,
      ...indent(setStatus("'disconnected'", `'no reply at ${hex} on I2C bus ${bus.bus}'`)),
      "except Exception as _e:",
      `    ${dev} = None`,
      ...indent(setStatus("'error'", "str(_e)")),
      "else:",
      ...indent(setStatus("'connected'", `'BME280' if ${dev}.has_humidity else 'BMP280'`)),
      "    msg = {'payload': {'temperature': round(_t, 2), 'humidity': None if _h is None else round(_h, 2), 'pressure': round(_p / 100, 2)}, 'topic': ''}",
    ].join("\n");

    return {
      imports: ["import machine", "import bme280_float"],
      statements: [bus.statement, { key: dev, code: `${dev} = None\n${state} = None` }],
      buildMsg,
      repeatMs: intervalMs,
    };
  },
};
