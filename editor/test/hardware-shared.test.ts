// SPDX-License-Identifier: Apache-2.0
// editor/test/hardware-shared.test.ts
//
// Hardware resources are keyed singletons (docs/working-notes/decisions/hardware-singletons.md): each node claims
// its pins and buses at compile time, the same use shares, a different use stops the compile naming both nodes.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { adcNode } from "../src/node-library/adc.js";
import { displaySpiNode } from "../src/node-library/display-spi.js";
import { encoderNode } from "../src/node-library/encoder.js";
import { gpioOutNode } from "../src/node-library/gpio-out.js";
import { i2cBusFromPins } from "../src/node-library/i2c-shared.js";
import { neopixelNode } from "../src/node-library/neopixel.js";

/** A ctx with compile.ts's claim rule, so node codegen hooks can be run one after another. */
function claimingCtx(): CodegenContext {
  const claims = new Map<string, { use: string; who: string }>();
  let n = 0;
  return {
    uniqueName: (hint) => `_${hint}_${++n}`,
    resolveConfig: () => ({}),
    claimResource(resource, use, who) {
      const prev = claims.get(resource);
      if (!prev) claims.set(resource, { use, who });
      else if (prev.use !== use) throw new Error(`${resource}: ${who} sets it up as ${use}, but ${prev.who} already has it as ${prev.use}.`);
    },
  };
}

const display = (id: string, props: Record<string, unknown> = {}): GraphNode => ({
  id,
  type: "thingstudio/display_spi",
  properties: { controller: "st7796", spiBus: 1, baudrate: 40000000, sck: 12, mosi: 11, dc: 46, cs: 10, reset: -1, backlight: 45, width: 320, height: 480, rotation: 1, ...props },
});
const gpioOut = (id: string, pin: number): GraphNode => ({ id, type: "thingstudio/gpio_out", properties: { pin } });

describe("hardware resources are keyed singletons", () => {
  it("two gpio_out nodes on one pin share one runtime.shared Pin", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        gpioOut("2", 5),
        gpioOut("3", 5),
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "1", 0, "3", 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_gpio_5 = runtime.shared('pin', 5, ('out', 'none'), lambda: machine.Pin(5, machine.Pin.OUT))");
    expect(source.match(/runtime\.shared\('pin', 5,/g)).toHaveLength(1);
    expect(source).not.toMatch(/^_\w+ = machine\.Pin\(/m);
  });

  it("a pwm_out and a gpio_out on one pin stop the compile", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "0.5", repeat: "manual" } },
        { id: "2", type: "thingstudio/pwm_out", properties: { pin: 5, freq: 1000 } },
        gpioOut("3", 5),
      ],
      links: [
        [1, "1", 0, "2", 0, "number"],
        [2, "1", 0, "3", 0, "bool"],
      ],
    };
    expect(() => compile(graph, buildRegistry())).toThrow("GPIO 5: gpio_out 3 sets it up as output, but pwm_out 2 already has it as PWM at 1000 Hz.");
  });

  it("a display's DC and CS are its own, but its backlight can be switched by a gpio_out", () => {
    const ctx = claimingCtx();
    displaySpiNode.codegenSink!(display("d1"), ctx);
    expect(() => gpioOutNode.codegenSink!(gpioOut("g1", 45), ctx)).not.toThrow();
    expect(() => gpioOutNode.codegenSink!(gpioOut("g2", 46), ctx)).toThrow(/GPIO 46: gpio_out g2 sets it up as output, but display_spi d1 already has it as display DC/);
    expect(() => gpioOutNode.codegenSink!(gpioOut("g3", 10), ctx)).toThrow(/already has it as SPI CS/);
  });

  it("two displays share an SPI bus only at the same pins and speed", () => {
    const ctx = claimingCtx();
    const first = displaySpiNode.codegenSink!(display("d1"), ctx);
    expect(first.statements!.map((s) => s.code).join("\n")).toContain(
      "_spi_bus_1 = runtime.shared('spi', 1, (12, 11, 40000000), lambda: machine.SPI(1, baudrate=40000000",
    );
    expect(() => displaySpiNode.codegenSink!(display("d2", { dc: 4, cs: 5, backlight: -1 }), ctx)).not.toThrow();
    expect(() => displaySpiNode.codegenSink!(display("d3", { dc: 6, cs: 7, backlight: -1, baudrate: 20000000 }), ctx)).toThrow(/SPI bus 1: display_spi d3/);
  });

  it("an I2C bus's pins can't be driven by a gpio_out", () => {
    const ctx = claimingCtx();
    i2cBusFromPins(ctx, { bus: 0, scl: 9, sda: 8 });
    expect(() => gpioOutNode.codegenSink!(gpioOut("g1", 8), ctx)).toThrow("GPIO 8: gpio_out g1 sets it up as output, but I2C bus 0 already has it as I2C bus 0 SDA.");
  });

  it("an adc node's channel can't also be a gpio_out", () => {
    const ctx = claimingCtx();
    adcNode.codegenEventSource!({ id: "a1", type: "thingstudio/adc", properties: { pin: 34 } }, ctx);
    expect(() => gpioOutNode.codegenSink!(gpioOut("g1", 34), ctx)).toThrow(/GPIO 34: gpio_out g1 sets it up as output, but adc a1 already has it as ADC input/);
  });

  it("two encoder nodes on the same pins must agree on their settings", () => {
    const ctx = claimingCtx();
    const enc = (id: string, props: Record<string, unknown> = {}): GraphNode => ({ id, type: "thingstudio/encoder", properties: { pinX: 10, pinY: 11, ...props } });
    encoderNode.codegenEventSource!(enc("e1", { div: 4 }), ctx);
    expect(() => encoderNode.codegenEventSource!(enc("e2", { div: 2 }), ctx)).toThrow(/GPIO 10,11 encoder: encoder e2/);
  });

  it("two neopixel nodes on the same pin must agree on count and order", () => {
    const ctx = claimingCtx();
    const neo = (id: string, props: Record<string, unknown> = {}): GraphNode => ({ id, type: "thingstudio/neopixel", properties: { pin: 13, count: 8, order: "GRB", ...props } });
    neopixelNode.codegenSink!(neo("n1"), ctx);
    expect(() => neopixelNode.codegenSink!(neo("n2", { count: 4 }), ctx)).toThrow(/GPIO 13 neopixel: neopixel n2/);
  });

  it("a named pin becomes a quoted Python literal and an identifier-safe variable name", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/gpio_out", properties: { pin: "X1" } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain(`_gpio_X1 = runtime.shared('pin', "X1", ('out', 'none'), lambda: machine.Pin("X1", machine.Pin.OUT))`);
  });

  it("a named pin with punctuation gets an injective, valid variable name", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/gpio_out", properties: { pin: "P3-1" } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain(`_gpio_P3_2d1 = runtime.shared('pin', "P3-1"`);
  });
});
