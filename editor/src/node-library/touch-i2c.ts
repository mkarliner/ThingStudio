// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/touch-i2c.ts
//
// Raw touch input, for non-GUI uses: a capacitive touch panel (FocalTech FT6336U, e.g. the Freenove ESP32-S3
// Display 4.0", address 0x38) as a source. It polls the panel every `pollMs` and sends a message only when
// something changes --
//   msg = {'payload': {'x': px, 'y': px}, 'topic': 'down'}   a finger lands
//   msg = {'payload': {'x': px, 'y': px}, 'topic': 'up'}     it lifts (x, y = where it was last seen)
// Down and up only (Mike's decision 2026-10-08: no move/drag events in the MVP); one finger. The panel itself --
// controller, I2C bus, address, reset pin, size, swap/flip -- is a touch panel config (touch-panel-shared.ts),
// shared with the gui screen that would otherwise poll it: a GUI's buttons don't need this node at all
// (2026-10-09), and one panel can't be used by both (a compile error).
//
// Fault handling follows bme280.ts: a missing panel sends nothing, shows "disconnected", and starts working when
// it appears; nothing raises out of the source loop. A panel that vanishes mid-touch still sends its 'up'.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SourceCodegenResult } from "../compiler/node-definition.js";
import { resolveTouchPanel } from "./touch-panel-shared.js";

export const touchI2cNode: NodeDefinition = {
  type: "thingstudio/touch_i2c",
  kind: "source",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  codegenSource(node: GraphNode, ctx: CodegenContext): SourceCodegenResult {
    const panel = resolveTouchPanel(ctx, node);
    const id = JSON.stringify(String(node.id));
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
      `        ${dev} = ${panel.makeDevice}`,
      `    _pt = ${dev}.read()`,
      "except OSError:",
      `    ${dev} = None`,
      ...indent(setStatus("'disconnected'", `'no reply from ${panel.where}'`)),
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
      imports: panel.imports,
      statements: [panel.bus.statement, { key: dev, code: `${dev} = None\n${state} = None\n${last} = None` }],
      buildMsg,
      repeatMs: panel.pollMs,
    };
  },
};
