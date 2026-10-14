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
import { formatPinSet, isNamedPinName, type PinId } from "./definitions.js";
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

function labelSuffix(target: Target, pin: PinId): string {
  const labels = target.pinLabels.get(pin);
  return labels && labels.length > 0 ? ` (${labels.join(", ")})` : "";
}

/** A short clause for the confusing case: a number asked of a board that names its pins (the STM32
 * pyboard), or a name asked of a board that numbers them. Without this the plain "doesn't exist"
 * reads as if the pin were merely out of range. */
function pinKindHint(target: Target, pin: PinId): string {
  const named = [...target.gpio].filter((p): p is string => typeof p === "string");
  const hasNumbers = [...target.gpio].some((p) => typeof p === "number");
  if (typeof pin === "number" && named.length > 0 && !hasNumbers) {
    return ` -- this board names its pins (${named.slice(0, 3).join(", ")}), it has no GPIO numbers`;
  }
  if (typeof pin === "string" && named.length === 0 && hasNumbers) {
    return " -- this board uses GPIO numbers, not pin names";
  }
  return "";
}

/** Reads a node's pin property as a pin id: a number (or numeric string) stays a number; a named pin
 * ("X1") stays its string. Anything else is a CompileError. */
function pinFromValue(value: unknown, what: string): PinId {
  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Math.round(Number(s));
      if (Number.isFinite(n) && n >= 0) return n;
    }
    if (isNamedPinName(s)) return s;
    throw new CompileError(`${what} "${s}" isn't a GPIO number or a pin name`);
  }
  const pin = Math.round(Number(value));
  if (value === null || value === undefined || !Number.isFinite(pin) || pin < 0) {
    throw new CompileError(`${what} ${String(value)} isn't a GPIO number or a pin name`);
  }
  return pin;
}

/**
 * Validates one pin property and returns it as a pin id (a GPIO number, or a named pin on a processor
 * whose pins aren't numbered).
 * `what` names it the way the node's messages always have, e.g. "gpio_out pin" or "display_spi sck pin".
 */
export function checkPin(ctx: CodegenContext, what: string, value: unknown, use: PinUse, opts: { pull?: boolean } = {}): PinId {
  const pin = pinFromValue(value, what);
  const target = ctx.target ?? null;
  if (!target) {
    if (typeof pin === "number" && pin > FALLBACK_MAX_PIN) {
      throw new CompileError(`${what} ${pin} is out of range (0-${FALLBACK_MAX_PIN}, the widest any supported processor has)`);
    }
    // A named pin can't be checked without knowing the board's own pin set; warn and let it through.
    warn(ctx, NO_TARGET_WARNING);
    return pin;
  }
  if (!target.gpio.has(pin)) {
    throw new CompileError(`${what} ${pin} doesn't exist on ${target.label}${pinKindHint(target, pin)}. Pins: ${formatPinSet(target.gpio)}`);
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

/** Same as checkPin, but -1 (or an empty value) means "not wired" and returns null. */
export function checkOptionalPin(ctx: CodegenContext, what: string, value: unknown, use: PinUse): PinId | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && value === -1) return null;
  if (typeof value === "string" && value.trim() === "-1") return null;
  return checkPin(ctx, what, value, use);
}

function mhz(hz: number): string {
  return `${Number((hz / 1e6).toFixed(2))} MHz`;
}

function onlyPins(what: string, role: string, pin: PinId, allowed: readonly PinId[] | undefined, busLabel: string, target: Target): void {
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
  pins: { sck: PinId; mosi: PinId; miso?: PinId | null },
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
export function checkI2c(ctx: CodegenContext, what: string, bus: number, pins: { scl: PinId; sda: PinId }): void {
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
