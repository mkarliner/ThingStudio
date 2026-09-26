// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/i2c-shared.ts
//
// I2C bus as a keyed singleton (2026-09-26, Mike: "I'd make an i2c bus a keyed singleton"). A flow holds at
// most one `thingstudio/config/i2c-bus` config per bus id (config-types.ts's `keyField: "bus"`); it carries the
// pins and clock, set once. Every I2C node (display_i2c, bme280, later sensors) references one by
// `i2cConfigId`, and the compiled flow creates one `machine.I2C` per bus, shared through a setup statement
// keyed by bus id -- so a display and a sensor on the same wires share one bus object. On the device that object
// comes from runtime.shared('i2c', bus, ...), a keyed singleton after Peter Hinch's functor_singleton pattern
// (Mike, 2026-09-26), which a function or custom node can also call to get the flow's bus.
//
// Creating the bus object doesn't talk to any device, so a missing sensor can't fail the flow's import; each
// node deals with its own device's absence at read/write time.
//
// Two configs claiming the same bus id (possible by editing one's bus field) that are both in use is a
// CompileError naming the bus -- the setup statement's first-writer-wins dedup would otherwise silently
// pick one config's pins.

import { CompileError } from "../compiler/errors.js";
import type { CodegenContext } from "../compiler/node-definition.js";
import { checkI2c, checkPin } from "../definitions/pin-check.js";

export const I2C_BUS_CONFIG_TYPE = "thingstudio/config/i2c-bus";

/** Node types that reference an I2C bus config through `i2cConfigId`. Add new I2C nodes here. */
export const I2C_NODE_TYPES = ["thingstudio/display_i2c", "thingstudio/bme280", "thingstudio/i2c"];

export const I2C_DEFAULT_FREQ = 100_000;

export interface I2cBusSetup {
  /** Python variable holding the shared machine.I2C object. */
  varName: string;
  bus: number;
  /** Setup statement creating it; deduplicated across the flow by key. */
  statement: { key: string; code: string };
}

export interface I2cBusPins {
  bus: number;
  scl: number;
  sda: number;
  freq: number;
}

function intOf(value: unknown): number {
  return value === null || value === undefined || value === "" ? NaN : Number(value);
}

/** Validates bus/pins/freq (from a config or a legacy node) and builds the shared setup statement. */
export function i2cBusFromPins(ctx: CodegenContext, raw: Record<string, unknown>): I2cBusSetup {
  const bus = intOf(raw.bus);
  if (!Number.isInteger(bus) || bus < 0) {
    throw new CompileError(`I2C bus "${String(raw.bus)}" must be a whole number, 0 or more`);
  }
  const what = `I2C bus ${bus}`;
  if (raw.scl === null || raw.scl === undefined || raw.scl === "") throw new CompileError(`${what} has no SCL pin set`);
  if (raw.sda === null || raw.sda === undefined || raw.sda === "") throw new CompileError(`${what} has no SDA pin set`);
  const scl = checkPin(ctx, `${what} scl pin`, raw.scl, "bidirectional");
  const sda = checkPin(ctx, `${what} sda pin`, raw.sda, "bidirectional");
  if (scl === sda) throw new CompileError(`${what} uses pin ${scl} for both SCL and SDA`);
  checkI2c(ctx, what, bus, { scl, sda });
  const freq = raw.freq === null || raw.freq === undefined || raw.freq === "" ? I2C_DEFAULT_FREQ : Number(raw.freq);
  if (!Number.isInteger(freq) || freq <= 0) {
    throw new CompileError(`${what} frequency "${String(raw.freq)}" must be a whole number of Hz above 0`);
  }
  const varName = `_i2c_bus_${bus}`;
  return {
    varName,
    bus,
    statement: {
      key: varName,
      // runtime.shared(): the device-side keyed singleton (runtime.py), so function and custom nodes can
      // fetch this same bus with runtime.shared('i2c', <bus>).
      code: `${varName} = runtime.shared('i2c', ${bus}, (${scl}, ${sda}, ${freq}), lambda: machine.I2C(${bus}, scl=machine.Pin(${scl}), sda=machine.Pin(${sda}), freq=${freq}))`,
    },
  };
}

/**
 * Resolves a node's `i2cConfigId` to the shared bus. `what` names the node in messages, e.g. "bme280".
 * Throws a CompileError when no bus is picked, or another in-use config claims the same bus id.
 */
export function resolveI2cBus(ctx: CodegenContext, what: string, configId: unknown): I2cBusSetup {
  if (typeof configId !== "string" || configId === "") {
    throw new CompileError(`${what} has no I2C bus. Pick one, or add one with +.`);
  }
  const props = ctx.resolveConfig(configId);
  const setup = i2cBusFromPins(ctx, props);

  const inUse = new Set<string>();
  for (const type of I2C_NODE_TYPES) {
    for (const n of ctx.findNodesOfType?.(type) ?? []) {
      if (typeof n.properties.i2cConfigId === "string") inUse.add(n.properties.i2cConfigId);
    }
  }
  const clash = (ctx.findConfigsOfType?.(I2C_BUS_CONFIG_TYPE) ?? []).find(
    (c) => c.id !== configId && inUse.has(c.id) && Number(c.properties.bus) === setup.bus,
  );
  if (clash) {
    throw new CompileError(
      `Two I2C bus settings both say bus ${setup.bus}. Give one a different bus number, or pick the same one on every node.`,
    );
  }
  return setup;
}

interface FlowNodeLike {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

/**
 * Load-time migration (editor, main.ts's applyFlowFile): a display_i2c saved before the shared I2C bus config
 * existed carries i2cBus/scl/sda/freq itself. Moves those into an I2C bus config -- reusing the flow's config for
 * that bus if there is one -- and points the node at it. `notes` lists anything worth telling the user, such as
 * two old nodes that disagreed about the same bus's pins (the first one's pins win, as they always did on the
 * board, since the old code made two I2C objects on one bus and the last one set up won -- either way, one
 * set of pins was never going to work).
 */
export function migrateI2cBusConfigs<N extends FlowNodeLike, C extends FlowNodeLike>(
  nodes: N[],
  configs: C[],
  newId: () => string,
): { nodes: N[]; configs: C[]; moved: number; notes: string[] } {
  const outConfigs = [...configs];
  const notes: string[] = [];
  let moved = 0;
  const byBus = (bus: number) => outConfigs.find((c) => c.type === I2C_BUS_CONFIG_TYPE && Number(c.properties.bus) === bus);
  const outNodes = nodes.map((n) => {
    const p = n.properties;
    if (n.type !== "thingstudio/display_i2c" || (typeof p.i2cConfigId === "string" && p.i2cConfigId !== "")) return n;
    if (p.scl === undefined && p.sda === undefined) return n;
    const bus = Number(p.i2cBus ?? 0);
    const pins = { scl: p.scl ?? null, sda: p.sda ?? null, freq: p.freq ?? 400000 };
    let cfg = byBus(bus);
    if (!cfg) {
      cfg = { id: newId(), type: I2C_BUS_CONFIG_TYPE, properties: { bus, ...pins } } as unknown as C;
      outConfigs.push(cfg);
    } else if (cfg.properties.scl !== pins.scl || cfg.properties.sda !== pins.sda) {
      notes.push(
        `display_i2c #${n.id.slice(0, 6)} had SCL ${String(pins.scl)}/SDA ${String(pins.sda)} on bus ${bus}, but the bus is ` +
          `already SCL ${String(cfg.properties.scl)}/SDA ${String(cfg.properties.sda)}; it now uses the bus's pins.`,
      );
    }
    const { i2cBus: _b, scl: _s, sda: _d, freq: _f, ...rest } = p;
    moved++;
    return { ...n, properties: { ...rest, i2cConfigId: cfg.id } };
  });
  return { nodes: outNodes, configs: outConfigs, moved, notes };
}
