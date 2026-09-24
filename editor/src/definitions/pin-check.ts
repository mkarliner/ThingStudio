// SPDX-License-Identifier: Apache-2.0
// editor/src/definitions/pin-check.ts
//
// Pin, SPI and I2C checks every pin-taking node calls from its codegen hook,
// against the compile's Target (ctx.target, target.ts). Replaces the
// hardcoded 0-39 checks each node used to carry (outstanding-items/
// gpio-pin-range-by-chip.md). Severity follows decisions/
// chip-board-definitions.md:
//
//   - pin not on the chip/board, a reserved pin, an output on an
//     input-only pin, an SPI/I2C bus or pin the chip can't use, an SPI
//     speed it refuses: CompileError. Each of these fails on the board,
//     often as a crash or a dead serial link, never as something useful.
//   - an "avoid" pin (strapping, PSRAM, USB...), a pull-up asked of a pin
//     without one: warning. These can be deliberate and can work.
//   - no target at all (never connected, nothing picked): only the widest
//     range any known processor has, plus one warning saying so.
//
// Only imports types from target.ts, so it has no dependency on how the
// definitions were loaded.

import { CompileError } from "../compiler/errors.js";
import type { CodegenContext } from "../compiler/node-definition.js";
import { formatPinSet } from "./definitions.js";
import type { Target } from "./target.js";

/** Highest GPIO any built-in processor has (ESP32-S3's 48). Used only with no target. */
export const FALLBACK_MAX_PIN = 48;

export const NO_TARGET_WARNING =
  `No board or processor known, so pins are only checked against 0-${FALLBACK_MAX_PIN}. ` +
  "Connect the board, or pick it in the Board menu, for full checks.";

export type PinUse = "output" | "input" | "bidirectional";

function warn(ctx: CodegenContext, message: string): void {
  ctx.warn?.(message);
}

function labelSuffix(target: Target, pin: number): string {
  const labels = target.pinLabels.get(pin);
  return labels && labels.length > 0 ? ` (${labels.join(", ")})` : "";
}

/**
 * Validates one pin property and returns it as an integer.
 * `what` names it the way the node's messages always have, e.g. "gpio_out pin" or "display_spi sck pin".
 */
export function checkPin(ctx: CodegenContext, what: string, value: unknown, use: PinUse, opts: { pull?: boolean } = {}): number {
  const pin = Math.round(Number(value));
  if (value === null || value === undefined || value === "" || !Number.isFinite(pin) || pin < 0) {
    throw new CompileError(`${what} ${String(value)} isn't a GPIO number`);
  }
  const target = ctx.target ?? null;
  if (!target) {
    if (pin > FALLBACK_MAX_PIN) {
      throw new CompileError(`${what} ${pin} is out of range (0-${FALLBACK_MAX_PIN}, the widest any supported processor has)`);
    }
    warn(ctx, NO_TARGET_WARNING);
    return pin;
  }
  if (!target.gpio.has(pin)) {
    throw new CompileError(`${what} ${pin} doesn't exist on ${target.label}. Pins: ${formatPinSet(target.gpio)}`);
  }
  const reason = target.reserved.get(pin);
  if (reason !== undefined) {
    throw new CompileError(`${what} ${pin}${labelSuffix(target, pin)} can't be used on ${target.label}: ${reason}`);
  }
  if (use !== "input" && target.inputOnly.has(pin)) {
    throw new CompileError(`${what} ${pin} is input-only on ${target.label}, and this pin drives an output`);
  }
  if (opts.pull && target.noPull.has(pin)) {
    warn(ctx, `${what} ${pin} has no internal pull resistor on ${target.label}. Fit an external one, or the input will float.`);
  }
  const avoid = target.avoid.get(pin);
  if (avoid !== undefined) {
    warn(ctx, `${what} ${pin}${labelSuffix(target, pin)} on ${target.label}: ${avoid}`);
  }
  return pin;
}

/** Same as checkPin, but -1 means "not wired" and returns null. */
export function checkOptionalPin(ctx: CodegenContext, what: string, value: unknown, use: PinUse): number | null {
  const raw = Math.round(Number(value ?? -1));
  if (raw === -1) return null;
  return checkPin(ctx, what, value, use);
}

function mhz(hz: number): string {
  return `${Number((hz / 1e6).toFixed(2))} MHz`;
}

function onlyPins(what: string, role: string, pin: number, allowed: readonly number[] | undefined, busLabel: string, target: Target): void {
  if (allowed && !allowed.includes(pin)) {
    throw new CompileError(
      `${what} ${role} pin ${pin} can't be ${busLabel} ${role.toUpperCase()} on ${target.label}. Use one of: ${allowed.join(", ")}`,
    );
  }
}

/** SPI bus, pin-function and clock checks for a node driving an SPI bus. Pins are already checkPin'd. */
export function checkSpi(
  ctx: CodegenContext,
  what: string,
  bus: number,
  pins: { sck: number; mosi: number; miso?: number | null },
  baudrate: number,
): void {
  const target = ctx.target ?? null;
  const spi = target?.processor.spi;
  if (!target || !spi) return;
  const def = spi.buses.get(bus);
  if (!def) {
    throw new CompileError(`${what} spiBus ${bus} doesn't exist on ${target.label}. SPI buses: ${[...spi.buses.keys()].join(", ")}`);
  }
  const busLabel = `SPI bus ${bus}`;
  onlyPins(what, "sck", pins.sck, def.pins?.sck, busLabel, target);
  onlyPins(what, "mosi", pins.mosi, def.pins?.mosi, busLabel, target);
  if (pins.miso !== undefined && pins.miso !== null) onlyPins(what, "miso", pins.miso, def.pins?.miso, busLabel, target);

  if (spi.maxHz !== undefined && baudrate > spi.maxHz) {
    throw new CompileError(`${what} baudrate ${mhz(baudrate)} is faster than ${target.label}'s SPI maximum of ${mhz(spi.maxHz)}`);
  }
  if (spi.otherPinsMaxHz !== undefined && baudrate > spi.otherPinsMaxHz) {
    const fast = def.fastPins;
    const onFastPins = fast !== undefined && fast.sck === pins.sck && fast.mosi === pins.mosi;
    if (!onFastPins) {
      let hint = fast ? `, or move SCK and MOSI to bus ${bus}'s fast pins (${fast.sck} and ${fast.mosi})` : "";
      hint += ".";
      for (const [otherId, other] of spi.buses) {
        if (otherId !== bus && other.fastPins?.sck === pins.sck && other.fastPins?.mosi === pins.mosi) {
          hint += ` These pins are SPI bus ${otherId}'s fast pins, so spiBus ${otherId} would also work.`;
        }
      }
      throw new CompileError(
        `${what} baudrate ${mhz(baudrate)} is too fast for these pins on ${target.label}. ` +
          `Off the bus's fast pins the limit is ${mhz(spi.otherPinsMaxHz)}, and above it the board crashes. ` +
          `Use ${mhz(spi.otherPinsMaxHz)} or less${hint}`,
      );
    }
  }
}

/** I2C bus and pin-function checks. Pins are already checkPin'd. */
export function checkI2c(ctx: CodegenContext, what: string, bus: number, pins: { scl: number; sda: number }): void {
  const target = ctx.target ?? null;
  const i2c = target?.processor.i2c;
  if (!target || !i2c) return;
  const def = i2c.buses.get(bus);
  if (!def) {
    throw new CompileError(`${what} i2cBus ${bus} doesn't exist on ${target.label}. I2C buses: ${[...i2c.buses.keys()].join(", ")}`);
  }
  onlyPins(what, "scl", pins.scl, def.pins?.scl, `I2C bus ${bus}`, target);
  onlyPins(what, "sda", pins.sda, def.pins?.sda, `I2C bus ${bus}`, target);
}
