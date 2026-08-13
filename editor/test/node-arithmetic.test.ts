// Tier 1 software-only node: arithmetic (editor/src/node-library/arithmetic.ts).
// See node-boolean.test.ts's header for why this runs against pymock.

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

// gpio_out only shows a bool-ish 0/1, not useful for checking a numeric
// result precisely -- debug's `payload=%r` prints the actual value, so
// use that as the sink for every arithmetic case.
function graphWith(injectValue: string, arithmeticProps: Record<string, unknown>): GraphData {
  return {
    nodes: [
      { id: 1, type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: injectValue, repeat: "manual" } },
      { id: 2, type: "thingstudio/arithmetic", properties: arithmeticProps },
      { id: 3, type: "thingstudio/debug", properties: {} },
    ],
    links: [
      [1, 1, 0, 2, 0, "number"],
      [2, 2, 0, 3, 0, "number"],
    ],
  };
}

describe("thingstudio/arithmetic node", () => {
  it("scale: multiplies and offsets (10 * 2 + 3 = 23)", () => {
    const { source } = compile(graphWith("10", { operator: "scale", scale: 2, offset: 3 }), registry);
    expect(runGenerated(source)).toContain("payload=23");
  });

  it("scale: default scale=1 offset=0 is a passthrough", () => {
    const { source } = compile(graphWith("7", { operator: "scale" }), registry);
    expect(runGenerated(source)).toContain("payload=7");
  });

  it("round: rounds to N decimals", () => {
    const { source } = compile(graphWith("3.14159", { operator: "round", decimals: 2 }), registry);
    expect(runGenerated(source)).toContain("payload=3.14");
  });

  it("abs: absolute value of a negative number", () => {
    const { source } = compile(graphWith("-7", { operator: "abs" }), registry);
    expect(runGenerated(source)).toContain("payload=7");
  });

  it("clamp: clamps above max", () => {
    const { source } = compile(graphWith("100", { operator: "clamp", min: 0, max: 10 }), registry);
    expect(runGenerated(source)).toContain("payload=10");
  });

  it("clamp: clamps below min", () => {
    const { source } = compile(graphWith("-5", { operator: "clamp", min: 0, max: 10 }), registry);
    expect(runGenerated(source)).toContain("payload=0");
  });

  it("clamp: passes a value already inside the bounds through unchanged", () => {
    const { source } = compile(graphWith("5", { operator: "clamp", min: 0, max: 10 }), registry);
    expect(runGenerated(source)).toContain("payload=5");
  });

  it("rejects clamp with min > max", () => {
    expect(() => compile(graphWith("5", { operator: "clamp", min: 10, max: 0 }), registry)).toThrow(CompileError);
    expect(() => compile(graphWith("5", { operator: "clamp", min: 10, max: 0 }), registry)).toThrow(/min.*greater than max/);
  });

  it("rejects a non-numeric scale property", () => {
    expect(() => compile(graphWith("5", { operator: "scale", scale: "not-a-number" }), registry)).toThrow(/not a valid number/);
  });

  it("rejects an unknown operator", () => {
    expect(() => compile(graphWith("5", { operator: "multiply" }), registry)).toThrow(/unknown operator/);
  });
});
