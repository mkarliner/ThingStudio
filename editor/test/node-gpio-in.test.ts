// Tier 1 GPIO/timer node: gpio_in (editor/src/node-library/gpio-in.ts).
//
// gpio_in's repeatMs is always > 0 (a real polling source), and pymock's
// runtime.py aliases CPython's real `asyncio` module, which has no
// `sleep_ms` -- a repeating flow run through the full compiler +
// runGenerated (like node-boolean.test.ts does for one-shot chains)
// would hit an AttributeError the instant it reached the `while True`
// loop's `await asyncio.sleep_ms(...)`. compiler.general.test.ts's "None
// stops propagation" test hits this same constraint and works around it
// by checking generated source TEXT rather than executing it -- this
// file does the same for the "does it compile into a sane flow" question
// (see the last two tests below), but for the "does the codegen actually
// read a pin correctly" question, calls gpioInNode.codegenSource
// directly and runs just the returned setup+buildMsg snippet against
// pymock's machine module, skipping the coroutine/asyncio machinery
// entirely -- real behavior against a real (test-driven) pin value,
// without the unrelated concern of repeating-loop scheduling, which is
// device-runtime/test/test_runtime.py's job against real uasyncio.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { gpioInNode } from "../src/node-library/gpio-in.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx: CodegenContext = { uniqueName: (hint) => `_${hint}` };

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/gpio_in", properties };
}

function runSnippet(preamble: string, properties: Record<string, unknown>): string {
  const result = gpioInNode.codegenSource!(node(properties), ctx);
  const lines = [...(result.imports ?? []), preamble, ...(result.statements ?? []).map((s) => s.code), result.buildMsg, "print(msg)"];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

describe("thingstudio/gpio_in node", () => {
  it("reads a HIGH pin as payload True", () => {
    const output = runSnippet("machine.Pin.INPUT_VALUES[12] = 1", { pin: 12, pollMs: 100 });
    expect(output).toContain("'payload': True");
  });

  it("reads a LOW pin as payload False", () => {
    const output = runSnippet("machine.Pin.INPUT_VALUES[12] = 0", { pin: 12, pollMs: 100 });
    expect(output).toContain("'payload': False");
  });

  it("defaults to False (LOW) if nothing has driven the pin", () => {
    const output = runSnippet("", { pin: 14, pollMs: 100 });
    expect(output).toContain("'payload': False");
  });

  it("sets repeatMs from the configured pollMs", () => {
    const result = gpioInNode.codegenSource!(node({ pin: 12, pollMs: 250 }), ctx);
    expect(result.repeatMs).toBe(250);
  });

  it("defaults pollMs to 100ms when not configured", () => {
    const result = gpioInNode.codegenSource!(node({ pin: 12 }), ctx);
    expect(result.repeatMs).toBe(100);
  });

  it("rejects an out-of-range pin", () => {
    expect(() => gpioInNode.codegenSource!(node({ pin: 99, pollMs: 100 }), ctx)).toThrow(CompileError);
    expect(() => gpioInNode.codegenSource!(node({ pin: 99, pollMs: 100 }), ctx)).toThrow(/out of range/);
  });

  it("rejects a non-positive pollMs", () => {
    expect(() => gpioInNode.codegenSource!(node({ pin: 12, pollMs: 0 }), ctx)).toThrow(/positive number/);
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/gpio_in", properties: { pin: 14, pollMs: 50 } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_pin_14_in = machine.Pin(14, machine.Pin.IN)");
    expect(source).toContain("while True:");
    expect(source).toContain("asyncio.sleep_ms(50)");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("a gpio_in and gpio_out on the same pin number get two independently-configured Pin objects, not one shared/misconfigured one", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/gpio_in", properties: { pin: 12, pollMs: 100 } },
        { id: 2, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 3, type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [[1, 2, 0, 3, 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_pin_12_in = machine.Pin(12, machine.Pin.IN)");
    expect(source).toContain("_pin_12 = machine.Pin(12, machine.Pin.OUT)");
  });
});
