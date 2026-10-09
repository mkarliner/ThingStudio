// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/touch-i2c.ts
//
// Capacitive touch panel on an I2C bus -- FocalTech FT6336U (the Freenove ESP32-S3 Display 4.0"), address 0x38.
// A source: it polls the panel every `pollMs` and sends a message only when something changes --
//   msg = {'payload': {'x': px, 'y': px}, 'topic': 'down'}   a finger lands
//   msg = {'payload': {'x': px, 'y': px}, 'topic': 'up'}     it lifts (x, y = where it was last seen)
// Down and up only (Mike's decision 2026-10-08: no move/drag events in the MVP); one finger. Wire the output to
// a gui screen node, which hit-tests the visible page and turns it into a widget press.
//
// Coordinates: the controller reports panel coordinates, so there is no calibration; `swapXY`, `flipX` and
// `flipY` rotate them to the display's orientation (a flow that rotates the display needs the same rotation here).
// Bus and fault handling follow bme280.ts: a missing panel sends nothing, shows "disconnected", and starts
// working when it appears; nothing raises out of the source loop.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { checkPin } from "../definitions/pin-check.js";
import { resolveI2cBus } from "./i2c-shared.js";

function whole(node: GraphNode, key: string, dflt: number, min: number, what: string): number {
  const v = Number(node.properties[key] ?? dflt);
  if (!Number.isInteger(v) || v < min) throw new CompileError(`touch_i2c ${what} "${String(node.properties[key])}" must be a whole number, ${min} or more`);
  return v;
}

export const touchI2cNode: NodeDefinition = {
  type: "thingstudio/touch_i2c",
  kind: "source",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const bus = resolveI2cBus(ctx, "touch_i2c", node.properties.i2cConfigId);
    const address = whole(node, "address", 0x38, 0x08, "address");
    if (address > 0x77) throw new CompileError(`touch_i2c address "${String(node.properties.address)}" must be 0x08 to 0x77`);
    const pollMs = whole(node, "pollMs", 20, 5, "poll interval");
    const width = whole(node, "width", 320, 1, "panel width");
    const height = whole(node, "height", 480, 1, "panel height");
    const py = (b: unknown) => (b === true ? "True" : "False");
    const rstRaw = node.properties.rstPin;
    const hasRst = rstRaw !== undefined && rstRaw !== null && rstRaw !== "";
    const rst = hasRst ? `machine.Pin(${checkPin(ctx, "touch_i2c reset pin", rstRaw, "output")}, machine.Pin.OUT)` : "None";

    const id = JSON.stringify(String(node.id));
    const hex = `0x${address.toString(16)}`;
    const dev = ctx.uniqueName("touch_dev");
    const state = ctx.uniqueName("touch_state");
    const last = ctx.uniqueName("touch_last");

    const setStatus = (st: string, text: string) =>
      [`if ${state} != (${st}, ${text}):`, `    ${state} = (${st}, ${text})`, `    runtime.report_status(${id}, ${st}, ${text})`];
    const indent = (lines: string[]) => lines.map((l) => "    " + l);

    // ${last} is None while no finger is down, else the last (x, y). A failed read counts as "no finger" only
    // after it has been reported, so an unplugged panel mid-touch still sends its 'up'.
    const buildMsg = [
      `global ${dev}, ${state}, ${last}`,
      "msg = None",
      "try:",
      `    if ${dev} is None:`,
      `        ${dev} = ft6336u.FT6336U(${bus.varName}, ${address}, ${rst}, ${width}, ${height}, ${py(node.properties.swapXY)}, ${py(node.properties.flipX)}, ${py(node.properties.flipY)})`,
      `    _pt = ${dev}.read()`,
      "except OSError:",
      `    ${dev} = None`,
      ...indent(setStatus("'disconnected'", `'no reply at ${hex} on I2C bus ${bus.bus}'`)),
      "except Exception as _e:",
      `    ${dev} = None`,
      ...indent(setStatus("'error'", "str(_e)")),
      "else:",
      ...indent(setStatus("'connected'", "'FT6336U'")),
      "    if _pt is not None:",
      `        if ${last} is None:`,
      "            msg = {'payload': {'x': _pt[0], 'y': _pt[1]}, 'topic': 'down'}",
      `        ${last} = _pt`,
      `    elif ${last} is not None:`,
      `        msg = {'payload': {'x': ${last}[0], 'y': ${last}[1]}, 'topic': 'up'}`,
      `        ${last} = None`,
    ].join("\n");

    return {
      imports: ["import machine", "import ft6336u"],
      statements: [bus.statement, { key: dev, code: `${dev} = None\n${state} = None\n${last} = None` }],
      buildMsg,
      repeatMs: pollMs,
    };
  },
};
