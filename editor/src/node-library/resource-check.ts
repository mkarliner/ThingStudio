// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/resource-check.ts
//
// The compile-time half of a core package's shared hardware resources (node-format-parity phase 4, option 2;
// docs/working-notes/shared-resource-facility-scoping.md). A built-in's codegen validated a bus, claimed its
// pins, refused two devices on one pin, and shared one object; a package expresses none of that in data. This
// module gives a `NodeDescriptor.resources` entry the same checks by reusing the helpers the built-ins already
// used (`hardware-shared.ts`, `i2c-shared.ts`, `pin-check.ts`):
//
//   - i2c -- resolveI2cBus(): bus number, SCL/SDA present and valid for the bus, both pins claimed, and two
//     in-use configs on one bus refused.
//   - spi -- checkPin() SCK/MOSI, checkSpi() the bus and baudrate, then sharedSpi() claims the bus and pins.
//   - pin -- checkPin() with a direction/pull, a claim with a role/use text, and an optional derived device
//     claim (e.g. two NeoPixels on one pin with different settings).
//
// The object itself is built by the package's own `.node.py` through `runtime.shared(...)`: the on-device keyed
// singleton shares it, so no setup statement is emitted or deduplicated here (the same accepted difference as
// gpio_out, builtins-as-packages-scoping.md §14).

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, PinResourceSpec, ResourceSpec, SpiResourceSpec } from "../compiler/node-definition.js";
import { pinLabel, type PinId } from "../definitions/definitions.js";
import { checkPin, checkSpi } from "../definitions/pin-check.js";
import { claimResource, pullText, sharedSpi, type Pull } from "./hardware-shared.js";
import { resolveI2cBus, i2cBusFromPins } from "./i2c-shared.js";

/** The descriptor fields `checkResources` reads -- `NodeDescriptor` and the package-codegen wrapper's narrower
 * `PackageDescriptor` both satisfy it. */
interface ResourceOwner {
  type: string;
  paletteId?: string;
  resources?: readonly ResourceSpec[];
}

/** `{pin}` -> the pin's label; `{name}` -> `properties.name`. A missing property interpolates to "". */
function interpolate(template: string, node: GraphNode, pin: PinId): string {
  return template
    .replace(/\{pin\}/g, pinLabel(pin))
    .replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name: string) => String(node.properties[name] ?? ""));
}

function wholeNumber(value: unknown, what: string): number {
  const n = Math.round(Number(value));
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) {
    throw new CompileError(`${what} must be a whole number`);
  }
  return n;
}

function checkSpiResource(ctx: CodegenContext, node: GraphNode, what: string, spec: SpiResourceSpec): void {
  const bus = wholeNumber(node.properties[spec.bus], `${what} spiBus`);
  if (bus < 0) throw new CompileError(`${what} spiBus ${bus} must be 0 or more`);
  const sck = checkPin(ctx, `${what} sck pin`, node.properties[spec.sck], "output");
  const mosi = checkPin(ctx, `${what} mosi pin`, node.properties[spec.mosi], "output");
  const baudrate = wholeNumber(node.properties[spec.baudrate], `${what} baudrate`);
  if (baudrate <= 0) throw new CompileError(`${what} baudrate ${baudrate} must be above 0`);
  checkSpi(ctx, what, bus, { sck, mosi }, baudrate);
  sharedSpi(ctx, node, bus, sck, mosi, baudrate);
}

function defaultPinUse(direction: "input" | "output" | "bidirectional", pull: Pull): string {
  return direction === "output" ? "output" : `input, ${pullText(pull)}`;
}

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

function checkPinResource(ctx: CodegenContext, node: GraphNode, what: string, spec: PinResourceSpec): void {
  if (spec.optional) {
    const raw = node.properties[spec.property];
    if (raw === undefined || raw === null || raw === "" || Number(raw) < 0) return;
  }
  const rawPull = spec.pullProperty ? node.properties[spec.pullProperty] : spec.pull;
  const pull: Pull = rawPull === undefined || rawPull === null || rawPull === "" ? "none" : (String(rawPull) as Pull);
  if (pull !== "none" && pull !== "up" && pull !== "down") {
    throw new CompileError(`${what} pin pull "${String(rawPull)}" must be "none", "up", or "down"`);
  }
  const pin = checkPin(ctx, `${what} pin`, node.properties[spec.property], spec.direction, {
    pull: spec.direction === "input" && pull !== "none",
  });
  if (spec.noAdc2WithWifi && ctx.target?.processor.adc2.has(pin) && flowUsesWifi(ctx)) {
    throw new CompileError(
      `${what} pin ${pin} is an ADC2 pin on ${ctx.target.label} and the flow uses WiFi, which makes ADC2 unusable. ` +
        `Use an ADC1 pin, or drop the flow's network nodes.`,
    );
  }
  claimResource(ctx, pinLabel(pin), interpolate(spec.use ?? defaultPinUse(spec.direction, pull), node, pin), node);
  if (spec.claim) {
    claimResource(ctx, interpolate(spec.claim.resource, node, pin), interpolate(spec.claim.use, node, pin), node);
  }
}

/**
 * Validates and claims every shared resource `descriptor` declares. A no-op when it declares none, so the
 * generic package codegen calls it unconditionally. `what` names the node in messages (its palette id).
 */
export function checkResources(ctx: CodegenContext, node: GraphNode, descriptor: ResourceOwner): void {
  const specs = descriptor.resources;
  if (!specs || specs.length === 0) return;
  const what = descriptor.paletteId ?? descriptor.type;
  for (const spec of specs) {
    if (spec.kind === "i2c") {
      // resolveI2cBus() validates, claims both pins and refuses two in-use configs on one bus; the setup
      // statement it returns is unused here (the package's Python fetches the shared bus itself). A config-less
      // node with legacy bus pins on it falls back to those (display_i2c's pre-config flows).
      let id = node.properties[spec.config];
      if (spec.nestedField !== undefined) {
        const parent = typeof id === "string" && id !== "" ? ctx.resolveConfig(id) : undefined;
        const nested = parent?.[spec.nestedField];
        id = typeof nested === "string" ? nested : "";
      }
      const fb = spec.fallback;
      const hasLegacyPins = fb !== undefined && (node.properties[fb.scl] !== undefined || node.properties[fb.sda] !== undefined);
      if ((typeof id !== "string" || id === "") && hasLegacyPins) {
        i2cBusFromPins(ctx, {
          bus: node.properties[fb!.bus] ?? 0,
          scl: node.properties[fb!.scl],
          sda: node.properties[fb!.sda],
          freq: node.properties[fb!.freq] ?? 400000,
        });
      } else {
        resolveI2cBus(ctx, what, id);
      }
    } else if (spec.kind === "spi") {
      checkSpiResource(ctx, node, what, spec);
    } else {
      checkPinResource(ctx, node, what, spec);
    }
  }
}
