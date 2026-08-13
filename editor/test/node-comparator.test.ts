// Tier 1 software-only node: comparator (editor/src/node-library/comparator.ts).
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

function graphWith(injectType: string, injectValue: string, comparatorProps: Record<string, unknown>): GraphData {
  return {
    nodes: [
      { id: 1, type: "thingstudio/inject", properties: { payloadType: injectType, payloadValue: injectValue, repeat: "manual" } },
      { id: 2, type: "thingstudio/comparator", properties: comparatorProps },
      { id: 3, type: "thingstudio/debug", properties: {} },
    ],
    links: [
      [1, 1, 0, 2, 0, injectType],
      [2, 2, 0, 3, 0, "bool"],
    ],
  };
}

describe("thingstudio/comparator node", () => {
  it("gt: 30 > 25 -> True (the 'turn something on above a threshold' case)", () => {
    const { source } = compile(graphWith("number", "30", { operator: "gt", payloadType: "number", threshold: 25 }), registry);
    expect(runGenerated(source)).toContain("payload=True");
  });

  it("gt: 20 > 25 -> False", () => {
    const { source } = compile(graphWith("number", "20", { operator: "gt", payloadType: "number", threshold: 25 }), registry);
    expect(runGenerated(source)).toContain("payload=False");
  });

  it("lte: 25 <= 25 -> True (boundary inclusive)", () => {
    const { source } = compile(graphWith("number", "25", { operator: "lte", payloadType: "number", threshold: 25 }), registry);
    expect(runGenerated(source)).toContain("payload=True");
  });

  it("lt: 25 < 25 -> False (boundary exclusive)", () => {
    const { source } = compile(graphWith("number", "25", { operator: "lt", payloadType: "number", threshold: 25 }), registry);
    expect(runGenerated(source)).toContain("payload=False");
  });

  it("eq on strings", () => {
    const { source } = compile(graphWith("string", "hello", { operator: "eq", payloadType: "string", threshold: "hello" }), registry);
    expect(runGenerated(source)).toContain("payload=True");
  });

  it("ne on strings", () => {
    const { source } = compile(graphWith("string", "hello", { operator: "ne", payloadType: "string", threshold: "world" }), registry);
    expect(runGenerated(source)).toContain("payload=True");
  });

  it("rejects an unknown operator", () => {
    expect(() => compile(graphWith("number", "1", { operator: "spaceship", payloadType: "number", threshold: 1 }), registry)).toThrow(CompileError);
    expect(() => compile(graphWith("number", "1", { operator: "spaceship", payloadType: "number", threshold: 1 }), registry)).toThrow(/unknown operator/);
  });

  it("rejects a non-numeric threshold when payloadType is number", () => {
    expect(() =>
      compile(graphWith("number", "1", { operator: "gt", payloadType: "number", threshold: "not-a-number" }), registry),
    ).toThrow(/not a valid number/);
  });
});
