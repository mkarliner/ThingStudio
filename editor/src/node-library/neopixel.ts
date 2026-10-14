// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/neopixel.ts
//
// WS2812 / NeoPixel strip sink (2026-10-11, docs/working-notes/adc-encoder-neopixel-briefing.md).
// Uses MicroPython's built-in `neopixel` module (no vendored driver).
//
// On each message it sets the pixels and writes:
//   - payload is a 24-bit int 0xRRGGBB -> that colour on every pixel
//     (for RGBW strips, a 32-bit 0xWWRRGGBB carries the white channel too)
//   - payload is a list/tuple of such ints -> one colour per pixel (up to the count)
//   - payload is {index, colour}       -> one pixel
//
// Colour order is a property; a bad payload reports the node's status dot and is ignored, rather than raising
// (which would end the source's loop).

import { claimResource, pinVarSegment, sharedPin } from "./hardware-shared.js";
import { CompileError } from "../compiler/errors.js";
import { pinLabel } from "../definitions/definitions.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

const ORDERS = ["RGB", "GRB", "RGBW", "GRBW"] as const;

export const neopixelNode: NodeDefinition = {
  type: "thingstudio/neopixel",
  kind: "sink",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const pin = checkPin(ctx, "neopixel pin", node.properties.pin, "output");
    const count = Math.round(Number(node.properties.count ?? 8));
    if (!Number.isFinite(count) || count < 1) {
      throw new CompileError(`neopixel count "${String(node.properties.count)}" must be a whole number, 1 or more`);
    }
    const order = String(node.properties.order ?? "GRB");
    if (!(ORDERS as readonly string[]).includes(order)) {
      throw new CompileError(`neopixel order "${order}" must be one of ${ORDERS.join(", ")}`);
    }

    // The data pin is a keyed singleton (hardware-shared.ts, decisions/hardware-singletons.md); the NeoPixel
    // driver on it is claimed too, so two neopixel nodes on the same pin with a different count/order are a
    // compile error rather than two strips fighting over the pin. Same settings share the one device.
    const shared = sharedPin(ctx, node, pin, "out");
    claimResource(ctx, `${pinLabel(pin)} neopixel`, `count ${count}, order ${order}`, node);
    const bpp = order.endsWith("W") ? 4 : 3;
    const neoVar = `_neopixel_${pinVarSegment(pin)}`;
    const colourFn = ctx.uniqueName("neopixel_colour");
    const id = JSON.stringify(String(node.id));

    const chan = (shift: number) => `((_c >> ${shift}) & 0xff)`;
    const r = chan(16);
    const g = chan(8);
    const b = chan(0);
    const w = chan(24);
    const tuple =
      order === "RGB"
        ? `(${r}, ${g}, ${b})`
        : order === "GRB"
          ? `(${g}, ${r}, ${b})`
          : order === "RGBW"
            ? `(${r}, ${g}, ${b}, ${w})`
            : `(${g}, ${r}, ${b}, ${w})`;

    const body = [
      `_p = msg.get('payload')`,
      `if isinstance(_p, dict):`,
      `    ${neoVar}[int(_p.get('index', 0))] = ${colourFn}(int(_p.get('colour', _p.get('color', 0))))`,
      `elif isinstance(_p, (list, tuple)):`,
      `    for _i in range(min(len(_p), ${count})):`,
      `        ${neoVar}[_i] = ${colourFn}(int(_p[_i]))`,
      `else:`,
      `    _col = ${colourFn}(int(_p))`,
      `    for _i in range(${count}):`,
      `        ${neoVar}[_i] = _col`,
      `${neoVar}.write()`,
    ];

    const functionBody = [
      "try:",
      ...body.map((l) => "    " + l),
      "except Exception as _e:",
      `    runtime.report_status(${id}, 'error', str(_e))`,
    ].join("\n");

    return {
      imports: ["import machine", "import neopixel"],
      statements: [
        shared.statement,
        { key: `neopixel-${pin}`, code: `${neoVar} = neopixel.NeoPixel(${shared.varName}, ${count}, bpp=${bpp})` },
        { key: colourFn, code: `def ${colourFn}(_c):\n    return ${tuple}` },
      ],
      functionName: ctx.uniqueName("neopixel"),
      functionBody,
    };
  },
};
