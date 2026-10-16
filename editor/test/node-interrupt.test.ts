// interrupt as a core package (editor/src/node-library/core-packages/interrupt.ts), replacing the TypeScript
// node-library/interrupt.ts. Event-driven via machine.Pin.irq() + the vendored ThreadSafeEvent.
//
// No off-device test can fire a real interrupt or prove the hard-IRQ handler itself is safe (that is why
// device-runtime/src/vendor/threadsafe_event/README.md traces hard-IRQ safety from upstream's docs, and why a
// hands-on hardware pass is this node's real proof). What these tests cover: property validation, the generated
// event-source structure, and the hardware-resource claims. The debounce cooldown this file used to test is gone
// (Mike, 2026-10-16: eswitch/ebutton own debounce now), which is also what lets the node fit the package
// event-source shape -- its buildMsg always builds a message.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { descriptor as interruptDescriptor, python as interruptPython } from "../src/node-library/core-packages/interrupt.js";
import { buildCoreNodeDefinition } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const interruptNode = buildCoreNodeDefinition(interruptDescriptor, interruptPython);

// resolveConfig is unused by this node type -- stub throws if ever called, same "fail loudly on the unexpected"
// instinct as the real compile.ts implementation.
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/interrupt", properties };
}

describe("thingstudio/interrupt node", () => {
  it("rejects an out-of-range pin", () => {
    expect(() => interruptNode.codegenEventSource!(node({ pin: 99, edge: "rising" }), ctx)).toThrow(CompileError);
    expect(() => interruptNode.codegenEventSource!(node({ pin: 99, edge: "rising" }), ctx)).toThrow(/out of range/);
  });

  it("rejects an invalid edge mode", () => {
    expect(() => interruptNode.codegenEventSource!(node({ pin: 12, edge: "sideways" }), ctx)).toThrow(/not one of the declared options/);
  });

  it("defaults edge to rising, and builds the trigger selection + wait/emit", () => {
    expect(interruptNode.properties?.find((p) => p.name === "edge")?.default).toBe("rising");
    const result = interruptNode.codegenEventSource!(node({ pin: 12 }), ctx);
    const code = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("_trigger = machine.Pin.IRQ_RISING");
    expect(code).toContain("machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING");
    expect(code).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(code).toContain("await _evt.wait()");
    expect(code).toContain("_evt.clear()");
    expect(result.waitStatement).toContain("await");
    expect(result.buildMsg).toContain("msg = await");
  });

  it("compiles into a full flow with the expected structure -- event-driven, not repeatMs/sleep_ms", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/interrupt", properties: { pin: 14, edge: "both" } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(source).toContain("machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING");
    expect(source).toMatch(/\.irq\(trigger=.*handler=/);
    expect(source).toContain("while True:");
    expect(source).toMatch(/await .*\.wait\(\)/);
    expect(source).toMatch(/\.clear\(\)/);
    expect(source).not.toContain("asyncio.sleep_ms");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("an interrupt and a gpio_out on the same pin is a compile error naming both (hardware-singletons.md)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/interrupt", properties: { pin: 12, edge: "rising" } },
        { id: "2", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [[1, "2", 0, "3", 0, "bool"]],
    };
    expect(() => compile(graph, buildRegistry())).toThrow(
      "GPIO 12: gpio_out 3 sets it up as output, but interrupt 1 already has it as input, no pull. Set both up the same way, or use another pin.",
    );
  });

  it("two interrupt nodes on one pin share the pin with the same edge, and stop the compile with a different one", () => {
    const graph = (edge2: string): GraphData => ({
      nodes: [
        { id: "1", type: "thingstudio/interrupt", properties: { pin: 12, edge: "rising" } },
        { id: "2", type: "thingstudio/interrupt", properties: { pin: 12, edge: edge2 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "3", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
      ],
    });
    const { source } = compile(graph("rising"), buildRegistry());
    // A package: each instance calls runtime.shared for the same pin; the on-device singleton shares one Pin.
    expect(source.match(/runtime\.shared\('pin', _pin_num,/g)).toHaveLength(2);
    expect(() => compile(graph("falling"), buildRegistry())).toThrow(/GPIO 12 interrupt: interrupt 2 sets it up as falling edge/);
  });
});
