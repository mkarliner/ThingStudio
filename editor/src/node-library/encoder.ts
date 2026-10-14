// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/encoder.ts
//
// Quadrature encoder source (2026-10-11, docs/working-notes/adc-encoder-neopixel-briefing.md). Wraps
// Peter Hinch's Encoder (v3/primitives/encoder.py, vendored verbatim:
// device-runtime/src/vendor/primitives_encoder/, MIT).
//
// Emits one message per settled turn:
//   msg = {'payload': value, 'topic': '', 'delta': change}
// value in `payload` (the node's main value, docs/node-conventions.md), the signed change since the last
// emitted value in `delta`. No side effects -- it never drives the GUI (Mike, 2026-10-11: "side effects
// are evil"); a flow that wants a knob to change pages wires it, it does not happen inside the node.
//
// The driver applies div (round), then vmin/vmax (clamp), then mod (wrap); the value it yields is that
// final value. Its async iterator carries only the value, so the delta is computed here by remembering
// the last one (prevVar below), not by the driver's own callback.
//
// The two pins are keyed singletons (hardware-shared.ts, decisions/hardware-singletons.md): claimed at compile
// time and fetched through runtime.shared('pin', ...), so an encoder and any other node on either pin must
// agree, or the compile stops. The Encoder driver is fixed-name'd (`_encoder_<x>_<y>`, claimed as its own
// resource) so two encoder nodes on the same pair with the same settings share one instance
// (mergeSetup's first-writer-wins), matching interrupt/eswitch/ebutton's same-pin convention.
// Two nodes on the same pair is unusual; both await the one driver's iterator and both emit, which is
// acceptable, but it is not a supported configuration.

import { claimResource, pinVarSegment, sharedPin } from "./hardware-shared.js";
import { CompileError } from "../compiler/errors.js";
import { pinLabel } from "../definitions/definitions.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";

/** Optional whole-number property: blank/undefined -> null (the arg is omitted). */
function optInt(v: unknown, what: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new CompileError(`encoder ${what} "${String(v)}" must be a whole number`);
  return n;
}

export const encoderNode: NodeDefinition = {
  type: "thingstudio/encoder",
  kind: "source",
  ports: {
    outputs: [{ name: "msg", type: "number" }],
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const pinX = checkPin(ctx, "encoder pin x", node.properties.pinX, "input", { pull: true });
    const pinY = checkPin(ctx, "encoder pin y", node.properties.pinY, "input", { pull: true });
    if (pinX === pinY) throw new CompileError(`encoder pin x and pin y are the same pin (${pinX}); they must differ`);

    const div = Math.round(Number(node.properties.div ?? 1));
    if (!Number.isFinite(div) || div < 1) {
      throw new CompileError(`encoder div "${String(node.properties.div)}" must be a whole number, 1 or more`);
    }
    const value = Math.round(Number(node.properties.value ?? 0));
    if (!Number.isFinite(value)) throw new CompileError(`encoder value "${String(node.properties.value)}" must be a whole number`);
    const vmin = optInt(node.properties.vmin, "vmin");
    const vmax = optInt(node.properties.vmax, "vmax");
    const mod = optInt(node.properties.mod, "mod");
    if (mod !== null && mod < 1) throw new CompileError(`encoder mod "${String(node.properties.mod)}" must be 1 or more`);
    if ((vmin !== null && value < vmin) || (vmax !== null && value > vmax)) {
      throw new CompileError(`encoder value ${value} is outside its vmin/vmax limits`);
    }
    const delay = Math.round(Number(node.properties.delay ?? 100));
    if (!Number.isFinite(delay) || delay < 0) {
      throw new CompileError(`encoder delay "${String(node.properties.delay)}" must be a whole number of ms, 0 or more`);
    }

    const px = sharedPin(ctx, node, pinX, "in", "up");
    const py = sharedPin(ctx, node, pinY, "in", "up");
    const encVar = `_encoder_${pinVarSegment(pinX)}_${pinVarSegment(pinY)}`;
    const prevVar = ctx.uniqueName("encoder_prev");

    const args = [`v=${value}`, `div=${div}`];
    if (vmin !== null) args.push(`vmin=${vmin}`);
    if (vmax !== null) args.push(`vmax=${vmax}`);
    if (mod !== null) args.push(`mod=${mod}`);
    args.push(`delay=${delay}`);

    // The Encoder driver on the two shared pins is claimed too, so two encoder
    // nodes on the same pair with different settings are a compile error.
    const pairLabel = typeof pinX === "number" && typeof pinY === "number" ? `GPIO ${pinX},${pinY}` : `${pinLabel(pinX)},${pinLabel(pinY)}`;
    claimResource(ctx, `${pairLabel} encoder`, args.join(", "), node);

    return {
      imports: ["import machine", "from encoder import Encoder"],
      statements: [
        px.statement,
        py.statement,
        { key: `encoder-${pinX}-${pinY}`, code: `${encVar} = Encoder(${px.varName}, ${py.varName}, ${args.join(", ")})` },
        { key: prevVar, code: `${prevVar} = ${value}` },
      ],
      waitStatement: `_enc_val = await ${encVar}.__anext__()`,
      buildMsg: [
        `global ${prevVar}`,
        `_enc_delta = _enc_val - ${prevVar}`,
        `${prevVar} = _enc_val`,
        `msg = {'payload': _enc_val, 'topic': '', 'delta': _enc_delta}`,
      ].join("\n"),
    };
  },
};
