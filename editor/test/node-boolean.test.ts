// Tier 1 software-only node: boolean (editor/src/node-library/boolean.ts).
// Off-device codegen test per docs/working-notes/validation/
// mvp-validation-plan.md's Tier 1 bar: given known properties, does the
// generated Python behave correctly against a sample msg -- run for real
// against pymock (see compiler.regression.test.ts's header for why this,
// not the real MicroPython unix-port build, is what's achievable here).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

function graphWith(injectValue: string, booleanProps: Record<string, unknown>): GraphData {
  return {
    nodes: [
      { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: injectValue, repeat: "manual" } },
      { id: 2, type: "thingstudio/boolean", properties: booleanProps },
      { id: 3, type: "thingstudio/gpio_out", properties: { pin: 12 } },
    ],
    links: [
      [1, 1, 0, 2, 0, "bool"],
      [2, 2, 0, 3, 0, "bool"],
    ],
  };
}

describe("thingstudio/boolean node", () => {
  it("not: inverts true to false", () => {
    const { source } = compile(graphWith("true", { operator: "not" }), registry);
    expect(source).toContain("not msg.get('payload')");
    expect(runGenerated(source)).toContain("PIN_VALUE 12 0");
  });

  it("not: inverts false to true", () => {
    const { source } = compile(graphWith("false", { operator: "not" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 1");
  });

  it("and: true AND false constant -> false", () => {
    const { source } = compile(graphWith("true", { operator: "and", operand: "false" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 0");
  });

  it("and: true AND true constant -> true", () => {
    const { source } = compile(graphWith("true", { operator: "and", operand: "true" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 1");
  });

  it("or: false OR true constant -> true", () => {
    const { source } = compile(graphWith("false", { operator: "or", operand: "true" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 1");
  });

  it("or: false OR false constant -> false", () => {
    const { source } = compile(graphWith("false", { operator: "or", operand: "false" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 0");
  });

  it("xor: true XOR true constant -> false", () => {
    const { source } = compile(graphWith("true", { operator: "xor", operand: "true" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 0");
  });

  it("xor: true XOR false constant -> true", () => {
    const { source } = compile(graphWith("true", { operator: "xor", operand: "false" }), registry);
    expect(runGenerated(source)).toContain("PIN_VALUE 12 1");
  });

  it("rejects an unknown operator", () => {
    expect(() => compile(graphWith("true", { operator: "nand" }), registry)).toThrow(CompileError);
    expect(() => compile(graphWith("true", { operator: "nand" }), registry)).toThrow(/unknown operator/);
  });
});
