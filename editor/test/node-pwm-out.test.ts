// Tier 1 GPIO/timer node: pwm_out (editor/src/node-library/pwm-out.ts).
// Unlike gpio_in/timer (both repeating sources), pwm_out is a sink --
// driven once per incoming message the same way gpio_out is, so this
// runs through the full compiler + a manual (one-shot) inject source,
// same pattern as node-boolean.test.ts.

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

function graphWith(injectValue: string, pwmProps: Record<string, unknown>): GraphData {
  return {
    nodes: [
      { id: 1, type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: injectValue, repeat: "manual" } },
      { id: 2, type: "thingstudio/pwm_out", properties: pwmProps },
    ],
    links: [[1, 1, 0, 2, 0, "number"]],
  };
}

describe("thingstudio/pwm_out node", () => {
  it("full duty (1.0) -> 65535", () => {
    const { source } = compile(graphWith("1.0", { pin: 12, freq: 1000 }), registry);
    const output = runGenerated(source);
    expect(output).toContain("PWM_INIT 12 freq=1000");
    expect(output).toContain("PWM_DUTY 12 65535");
  });

  it("zero duty (0.0) -> 0", () => {
    const { source } = compile(graphWith("0.0", { pin: 12, freq: 1000 }), registry);
    expect(runGenerated(source)).toContain("PWM_DUTY 12 0");
  });

  it("half duty (0.5) -> 32767", () => {
    const { source } = compile(graphWith("0.5", { pin: 12, freq: 1000 }), registry);
    expect(runGenerated(source)).toContain("PWM_DUTY 12 32767");
  });

  it("clamps a payload above 1.0 to full duty", () => {
    const { source } = compile(graphWith("2.5", { pin: 12, freq: 1000 }), registry);
    expect(runGenerated(source)).toContain("PWM_DUTY 12 65535");
  });

  it("clamps a negative payload to zero duty", () => {
    const { source } = compile(graphWith("-1", { pin: 12, freq: 1000 }), registry);
    expect(runGenerated(source)).toContain("PWM_DUTY 12 0");
  });

  it("defaults freq to 1000Hz when not configured", () => {
    const { source } = compile(graphWith("1.0", { pin: 13 }), registry);
    expect(runGenerated(source)).toContain("PWM_INIT 13 freq=1000");
  });

  it("rejects an out-of-range pin", () => {
    expect(() => compile(graphWith("1.0", { pin: 99, freq: 1000 }), registry)).toThrow(CompileError);
    expect(() => compile(graphWith("1.0", { pin: 99, freq: 1000 }), registry)).toThrow(/out of range/);
  });

  it("rejects a non-positive freq", () => {
    expect(() => compile(graphWith("1.0", { pin: 12, freq: 0 }), registry)).toThrow(/positive number/);
  });
});
