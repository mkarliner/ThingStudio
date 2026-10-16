// SPDX-License-Identifier: Apache-2.0
// editor/test/resource-check.test.ts
//
// The generic shared-resource resolver (node-library/resource-check.ts): a core package's descriptor declares a
// bus or a claimed pin, and the resolver validates it and records the same claims a built-in's own codegen did.
// The i2c path (validation, the two-configs-one-bus conflict) is exercised end to end in node-bme280.test.ts;
// this covers the spi and pin kinds and the direct error cases.

import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext, ResourceSpec } from "../src/compiler/node-definition.js";
import { checkResources } from "../src/node-library/resource-check.js";

interface Claim {
  resource: string;
  use: string;
}

function recordingCtx(): { ctx: CodegenContext; claims: Claim[] } {
  const claims: Claim[] = [];
  const used = new Set<string>();
  const ctx: CodegenContext = {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    resolveConfig: () => ({ bus: 0, scl: 22, sda: 21, freq: 100000 }),
    claimResource(resource, use) {
      claims.push({ resource, use });
    },
  };
  return { ctx, claims };
}

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "n1", type: "thingstudio/demo", properties };
}

function owner(resources: ResourceSpec[]) {
  return { type: "thingstudio/demo", paletteId: "demo", resources };
}

describe("checkResources", () => {
  it("does nothing when no resources are declared", () => {
    const { ctx, claims } = recordingCtx();
    checkResources(ctx, node({}), { type: "thingstudio/demo" });
    expect(claims).toEqual([]);
  });

  it("claims an SPI bus and its pins", () => {
    const { ctx, claims } = recordingCtx();
    checkResources(
      ctx,
      node({ spiBus: 1, sck: 14, mosi: 13, baudrate: 27000000 }),
      owner([{ kind: "spi", bus: "spiBus", sck: "sck", mosi: "mosi", baudrate: "baudrate" }]),
    );
    expect(claims).toEqual([
      { resource: "SPI bus 1", use: "SCK 14, MOSI 13 at 27000000 Hz" },
      { resource: "GPIO 14", use: "SPI bus 1 SCK" },
      { resource: "GPIO 13", use: "SPI bus 1 MOSI" },
    ]);
  });

  it("rejects an SPI baudrate of zero", () => {
    const { ctx } = recordingCtx();
    expect(() =>
      checkResources(
        ctx,
        node({ spiBus: 1, sck: 14, mosi: 13, baudrate: 0 }),
        owner([{ kind: "spi", bus: "spiBus", sck: "sck", mosi: "mosi", baudrate: "baudrate" }]),
      ),
    ).toThrow(/baudrate 0 must be above 0/);
  });

  it("claims a pin with a role, and a derived device claim from property templates", () => {
    const { ctx, claims } = recordingCtx();
    checkResources(
      ctx,
      node({ pin: 13, count: 8, order: "GRB" }),
      owner([
        {
          kind: "pin",
          property: "pin",
          direction: "output",
          use: "output",
          claim: { resource: "{pin} neopixel", use: "count {count}, order {order}" },
        },
      ]),
    );
    expect(claims).toEqual([
      { resource: "GPIO 13", use: "output" },
      { resource: "GPIO 13 neopixel", use: "count 8, order GRB" },
    ]);
  });

  it("defaults a pin's claim text to its direction and pull", () => {
    const { ctx, claims } = recordingCtx();
    checkResources(ctx, node({ pin: 5 }), owner([{ kind: "pin", property: "pin", direction: "input", pull: "up" }]));
    expect(claims).toEqual([{ resource: "GPIO 5", use: "input, pull-up" }]);
  });

  it("rejects a pin that isn't set", () => {
    const { ctx } = recordingCtx();
    expect(() =>
      checkResources(ctx, node({}), owner([{ kind: "pin", property: "pin", direction: "output" }])),
    ).toThrow(/demo pin undefined isn't a GPIO number or a pin name/);
  });
});
