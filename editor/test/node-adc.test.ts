// editor/src/node-library/adc.ts codegen. Text-level (the driver's behaviour is Peter Hinch's,
// device-runtime/src/vendor/primitives_aadc/). Includes the ESP32 ADC2 + WiFi refusal.

import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import type { ProcessorDef } from "../src/definitions/definitions.js";
import type { Target } from "../src/definitions/target.js";
import { adcNode } from "../src/node-library/adc.js";

function target(processorId: string, label = "ESP32"): Target {
  const gpio = new Set<number>();
  for (let i = 0; i <= 48; i++) gpio.add(i);
  const processor: ProcessorDef = {
    id: processorId,
    name: label,
    match: [],
    nativeArch: "xtensawin",
    nativeArchConfirmed: true,
    gpio,
    inputOnly: new Set(),
    noPull: new Set(),
    reserved: new Map(),
    avoid: new Map(),
    spi: null,
    i2c: null,
    notes: "",
  };
  return {
    processor,
    board: null,
    label,
    gpio,
    inputOnly: new Set(),
    noPull: new Set(),
    reserved: new Map(),
    avoid: new Map(),
    pinLabels: new Map(),
  };
}

function ctx(opts: { target?: Target | null; nodes?: GraphNode[] } = {}): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    resolveConfig(): Record<string, unknown> {
      throw new Error("no configs");
    },
    findNodesOfType: (type) => (opts.nodes ?? []).filter((n) => n.type === type),
    target: opts.target ?? null,
  };
}

function node(properties: Record<string, unknown>, id = "a1"): GraphNode {
  return { id, type: "thingstudio/adc", properties };
}

const wifi = (): GraphNode => ({ id: "w", type: "thingstudio/wifi_status", properties: {} });

describe("thingstudio/adc node", () => {
  it("rejects a bad mode, an inverted range, and a non-positive delta", () => {
    expect(() => adcNode.codegenEventSource!(node({ pin: 34, mode: "sideways" }), ctx())).toThrow(/relative.*absolute/);
    expect(() => adcNode.codegenEventSource!(node({ pin: 34, mode: "absolute", lower: 10, upper: 5 }), ctx())).toThrow(/less than/);
    expect(() => adcNode.codegenEventSource!(node({ pin: 34, mode: "relative", delta: 0 }), ctx())).toThrow(/more than 0/);
  });

  it("generates a dict payload with raw, volts and percent", () => {
    const r = adcNode.codegenEventSource!(node({ pin: 34, mode: "relative", delta: 2000 }), ctx());
    expect(r.imports).toContain("from aadc import AADC");
    expect(r.waitStatement).toBe("await _aadc(2000)");
    expect(r.buildMsg).toContain("'raw'");
    expect(r.buildMsg).toContain("'volts'");
    expect(r.buildMsg).toContain("'percent'");
  });

  it("shares the ADC channel through runtime.shared", () => {
    const r = adcNode.codegenEventSource!(node({ pin: 34 }), ctx());
    const code = (r.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("_adc_34 = runtime.shared('adc', 34, (), lambda: machine.ADC(machine.Pin(34)))");
  });

  it("passes absolute bounds, and adds a poll timeout when pollMs is set", () => {
    const abs = adcNode.codegenEventSource!(node({ pin: 34, mode: "absolute", lower: 1000, upper: 50000 }), ctx());
    expect(abs.waitStatement).toBe("await _aadc(1000, 50000)");
    const polled = adcNode.codegenEventSource!(node({ pin: 34, mode: "relative", delta: 2000, pollMs: 500 }), ctx());
    expect(polled.waitStatement).toContain("asyncio.wait_for(_aadc(2000), 0.5)");
    expect(polled.waitStatement).toContain("asyncio.TimeoutError");
  });

  it("refuses an ESP32 ADC2 pin when the flow uses WiFi, and allows ADC1 or no-WiFi", () => {
    const esp32 = target("esp32");
    // pin 25 is ADC2 on classic ESP32
    expect(() => adcNode.codegenEventSource!(node({ pin: 25 }), ctx({ target: esp32, nodes: [wifi()] }))).toThrow(CompileError);
    // same pin, no WiFi -> allowed
    expect(() => adcNode.codegenEventSource!(node({ pin: 25 }), ctx({ target: esp32 }))).not.toThrow();
    // ADC1 pin with WiFi -> allowed
    expect(() => adcNode.codegenEventSource!(node({ pin: 34 }), ctx({ target: esp32, nodes: [wifi()] }))).not.toThrow();
  });
});
