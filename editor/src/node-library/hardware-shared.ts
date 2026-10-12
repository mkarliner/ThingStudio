// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/hardware-shared.ts
//
// Hardware resources are keyed singletons (docs/working-notes/decisions/hardware-singletons.md; Mike, 2026-09-08,
// restated 2026-10-12), after Peter Hinch's functor_singleton pattern:
// https://github.com/peterhinch/micropython-samples/blob/master/functor_singleton/README.md
//
// Two halves, and every node that touches hardware uses both:
//   - claimResource(): at compile time, records who uses each pin and bus, and how. The same use from two nodes
//     is shared; a different use is a CompileError naming both nodes, instead of two nodes quietly fighting over
//     one pin.
//   - runtime.shared(kind, key, signature, factory) in the generated code (device-runtime/src/runtime.py): the
//     first user builds the one object, later users get it. A different signature raises on the board too, which
//     catches a custom or function node that the compile can't see into.
// Unlike Hinch's singleton, a later user's different arguments are an error, never silently dropped.

import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext } from "../compiler/node-definition.js";
import { nodeLabel } from "../gui/screens.js";

/**
 * Claims `resource` (e.g. "GPIO 5", "SPI bus 1", "GPIO 5 eswitch") for `use` (e.g. "input, pull-up") on behalf of
 * `who`: a node, or a name for something that isn't one (an I2C bus config). A second claim with the same use
 * shares it; a different use throws. A no-op with a mock ctx that has no claimResource.
 */
export function claimResource(ctx: CodegenContext, resource: string, use: string, who: GraphNode | string): void {
  ctx.claimResource?.(resource, use, typeof who === "string" ? who : nodeLabel(who));
}

export type Pull = "none" | "up" | "down";

function pullText(pull: Pull): string {
  return pull === "none" ? "no pull" : `pull-${pull}`;
}

/** The runtime.shared() expression for one GPIO pin, as an input (with its pull) or an output. */
export function sharedPinExpr(pin: number, mode: "in" | "out", pull: Pull = "none"): string {
  const args =
    mode === "out"
      ? "machine.Pin.OUT"
      : `machine.Pin.IN${pull === "up" ? ", machine.Pin.PULL_UP" : pull === "down" ? ", machine.Pin.PULL_DOWN" : ""}`;
  const sig = mode === "out" ? "('out', 'none')" : `('in', '${pull}')`;
  return `runtime.shared('pin', ${pin}, ${sig}, lambda: machine.Pin(${pin}, ${args}))`;
}

/**
 * Claims GPIO `pin` and returns the setup statement that binds it to `_gpio_<pin>`, the one Pin object every node
 * on that pin shares. `role` replaces the default use text ("output", "input, pull-up") for a pin that only one
 * node may drive, such as a display's DC line.
 */
export function sharedPin(
  ctx: CodegenContext,
  node: GraphNode,
  pin: number,
  mode: "in" | "out",
  pull: Pull = "none",
  role?: string,
): { varName: string; statement: { key: string; code: string } } {
  claimResource(ctx, `GPIO ${pin}`, role ?? (mode === "out" ? "output" : `input, ${pullText(pull)}`), node);
  const varName = `_gpio_${pin}`;
  return { varName, statement: { key: `gpio-${pin}`, code: `${varName} = ${sharedPinExpr(pin, mode, pull)}` } };
}

/** Claims the ADC channel on GPIO `pin` and returns the setup statement binding `_adc_<pin>`. */
export function sharedAdc(
  ctx: CodegenContext,
  node: GraphNode,
  pin: number,
): { varName: string; statement: { key: string; code: string } } {
  claimResource(ctx, `GPIO ${pin}`, "ADC input", node);
  const varName = `_adc_${pin}`;
  return {
    varName,
    statement: {
      key: `adc-${pin}`,
      code: `${varName} = runtime.shared('adc', ${pin}, (), lambda: machine.ADC(machine.Pin(${pin})))`,
    },
  };
}

/** Claims GPIO `pin` for PWM at `freq` Hz and returns the setup statement binding `_pwm_<pin>`. */
export function sharedPwm(ctx: CodegenContext, node: GraphNode, pin: number, freq: number): { varName: string; statement: { key: string; code: string } } {
  claimResource(ctx, `GPIO ${pin}`, `PWM at ${freq} Hz`, node);
  const varName = `_pwm_${pin}`;
  return {
    varName,
    statement: {
      key: `pwm-${pin}`,
      code: `${varName} = runtime.shared('pwm', ${pin}, (${freq},), lambda: machine.PWM(machine.Pin(${pin}, machine.Pin.OUT), freq=${freq}))`,
    },
  };
}

/** Claims SPI bus `bus` and its pins, and returns the setup statement binding `_spi_bus_<bus>`. */
export function sharedSpi(
  ctx: CodegenContext,
  node: GraphNode,
  bus: number,
  sck: number,
  mosi: number,
  baudrate: number,
): { varName: string; statement: { key: string; code: string } } {
  claimResource(ctx, `SPI bus ${bus}`, `SCK ${sck}, MOSI ${mosi} at ${baudrate} Hz`, node);
  claimResource(ctx, `GPIO ${sck}`, `SPI bus ${bus} SCK`, node);
  claimResource(ctx, `GPIO ${mosi}`, `SPI bus ${bus} MOSI`, node);
  const varName = `_spi_bus_${bus}`;
  return {
    varName,
    statement: {
      key: varName,
      code:
        `${varName} = runtime.shared('spi', ${bus}, (${sck}, ${mosi}, ${baudrate}), lambda: machine.SPI(${bus}, ` +
        `baudrate=${baudrate}, polarity=0, phase=0, sck=machine.Pin(${sck}), mosi=machine.Pin(${mosi})))`,
    },
  };
}
