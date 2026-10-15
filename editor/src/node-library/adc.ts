// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/adc.ts
//
// ADC monitoring source (2026-10-11, docs/working-notes/adc-encoder-neopixel-briefing.md). Wraps Peter
// Hinch's AADC (v3/primitives/aadc.py, vendored verbatim: device-runtime/src/vendor/primitives_aadc/,
// MIT).
//
// Emits one message when the reading goes outside (or, with sense=inside, back inside) the configured
// bounds -- and, if a poll interval is set, also on that interval. Payload is a dict (Mike, 2026-10-11:
// "all the above, in a dict"):
//   msg = {'payload': {'raw': 0..65535, 'volts': V, 'percent': 0..100}, 'topic': ''}
//
// Bounds are relative (current value +- delta) or absolute (lower..upper). The AADC is awaited with the
// bounds each iteration so relative bounds recompute against the current value.
//
// ESP32 ADC2 pins do not work while WiFi is up, so the compile refuses one when the flow also uses WiFi
// (see ctx.target.processor.adc2, from the processor definition's `adc2` pin list).

import { claimResource, pinVarSegment, sharedAdc } from "./hardware-shared.js";
import { CompileError } from "../compiler/errors.js";
import { pinLabel } from "../definitions/definitions.js";
import { checkPin } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, EventSourceCodegenResult, NodeDefinition } from "../compiler/node-definition.js";

/**
 * Node types that make the compiled flow start WiFi (so ESP32 ADC2 is unavailable).
 */
const WIFI_NODE_TYPES = [
  "thingstudio/wifi_status",
  "thingstudio/wifi_gate",
  "thingstudio/mqtt_publish",
  "thingstudio/mqtt_subscribe",
  "thingstudio/http_request",
  "thingstudio/http_in",
  "thingstudio/http_response",
  "thingstudio/udp_send",
  "thingstudio/udp_receive",
];

function flowUsesWifi(ctx: CodegenContext): boolean {
  if (!ctx.findNodesOfType) return false;
  return WIFI_NODE_TYPES.some((t) => (ctx.findNodesOfType!(t)?.length ?? 0) > 0);
}

function wholeNumber(v: unknown, what: string): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new CompileError(`adc ${what} "${String(v)}" must be a whole number`);
  return n;
}

export const adcNode: NodeDefinition = {
  type: "thingstudio/adc",
  kind: "source",
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "adc",
  label: "adc",
  group: "hardware",
  priority: 13,
  color: "#6e8a2e",
  bgcolor: "#3a4a1f",
  icon: "∼",
  width: 110,
  description:
    "AADC (awaitable). Payload is a dict: raw (0-65535), volts, percent. On ESP32 an ADC2 pin can't be used while " +
    "WiFi is up, so Deploy refuses one when the flow uses the network. poll 0 sends only on a bounds crossing.",
  ports: {
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "pin", label: "pin", kind: "pin", default: 34 },
    {
      name: "mode",
      label: "mode",
      kind: "select",
      default: "relative",
      options: [
        { value: "relative", label: "relative -- fire when it moves by delta from the last message" },
        { value: "absolute", label: "absolute -- fire outside lower..upper" },
      ],
    },
    { name: "delta", label: "delta (counts)", kind: "number", default: 2000, min: 1, visibleWhen: { field: "mode", equals: "relative" } },
    { name: "lower", label: "lower", kind: "number", default: 0, min: 0, max: 65535, visibleWhen: { field: "mode", equals: "absolute" } },
    { name: "upper", label: "upper", kind: "number", default: 50000, min: 0, max: 65535, visibleWhen: { field: "mode", equals: "absolute" } },
    {
      name: "sense",
      label: "sense",
      kind: "select",
      default: "outside",
      options: [
        { value: "outside", label: "outside -- fire when it leaves the bounds (default)" },
        { value: "inside", label: "inside -- fire when it returns to them" },
      ],
    },
    { name: "pollMs", label: "poll (ms)", kind: "number", default: 0, min: 0 },
  ],
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const pin = checkPin(ctx, "adc pin", node.properties.pin, "input");

    const adc2 = ctx.target?.processor.adc2;
    if (typeof pin === "number" && adc2?.has(pin) && flowUsesWifi(ctx)) {
      throw new CompileError(
        `adc pin ${pin} is an ADC2 pin on ${ctx.target!.label} and the flow uses WiFi, which makes ADC2 unusable. ` +
          `Use an ADC1 pin, or drop the flow's network nodes.`,
      );
    }

    const mode = String(node.properties.mode ?? "relative");
    if (mode !== "relative" && mode !== "absolute") {
      throw new CompileError(`adc mode "${mode}" must be "relative" or "absolute"`);
    }
    let boundsArgs: string;
    if (mode === "relative") {
      const delta = wholeNumber(node.properties.delta ?? 2000, "delta");
      if (delta <= 0) throw new CompileError(`adc delta "${String(node.properties.delta)}" must be more than 0`);
      boundsArgs = String(delta);
    } else {
      const lower = wholeNumber(node.properties.lower ?? 0, "lower");
      const upper = wholeNumber(node.properties.upper ?? 50000, "upper");
      if (lower >= upper) throw new CompileError(`adc lower (${lower}) must be less than upper (${upper})`);
      if (lower < 0 || upper > 65535) throw new CompileError(`adc lower/upper must be within 0..65535`);
      boundsArgs = `${lower}, ${upper}`;
    }
    const sense = String(node.properties.sense ?? "outside");
    if (sense !== "outside" && sense !== "inside") {
      throw new CompileError(`adc sense "${sense}" must be "outside" or "inside"`);
    }
    const pollMs = wholeNumber(node.properties.pollMs ?? 0, "pollMs");
    if (pollMs < 0) throw new CompileError(`adc pollMs "${String(node.properties.pollMs)}" must be 0 or more`);

    const shared = sharedAdc(ctx, node, pin);
    claimResource(ctx, `${pinLabel(pin)} aadc`, `${mode} ${boundsArgs}, sense ${sense}, poll ${pollMs} ms`, node);
    const adcVar = shared.varName;
    const aadcVar = ctx.uniqueName("aadc");
    const errVar = `_adc_err_${pinVarSegment(pin)}`;
    const id = JSON.stringify(String(node.id));

    const aadcSetup = [`${aadcVar} = AADC(${adcVar})`];
    if (sense === "inside") aadcSetup.push(`${aadcVar}.sense(False)`);

    const waitStatement =
      pollMs > 0
        ? [
            "try:",
            `    await asyncio.wait_for(${aadcVar}(${boundsArgs}), ${pollMs / 1000})`,
            "except asyncio.TimeoutError:",
            "    pass",
          ].join("\n")
        : `await ${aadcVar}(${boundsArgs})`;

    // A read failure must not end the source loop (that would kill the node for good). Report it once per
    // distinct message through the node's status dot, then carry on next iteration.
    const buildMsg = [
      `global ${errVar}`,
      "try:",
      `    _adc_raw = ${adcVar}.read_u16()`,
      "except Exception as _e:",
      `    if ${errVar} != str(_e):`,
      `        ${errVar} = str(_e)`,
      `        runtime.report_status(${id}, 'error', str(_e))`,
      "    continue",
      "try:",
      `    _adc_volts = ${adcVar}.read_uv() / 1000000`,
      "except AttributeError:",
      "    _adc_volts = _adc_raw * 3.3 / 65535",
      "msg = {'payload': {'raw': _adc_raw, 'volts': round(_adc_volts, 3), 'percent': round(_adc_raw * 100 / 65535, 1)}, 'topic': ''}",
    ].join("\n");

    return {
      imports: ["import asyncio", "import machine", "from aadc import AADC"],
      statements: [
        shared.statement,
        { key: `${errVar}`, code: `${errVar} = None` },
        { key: aadcVar, code: aadcSetup.join("\n") },
      ],
      waitStatement,
      buildMsg,
    };
  },
};
