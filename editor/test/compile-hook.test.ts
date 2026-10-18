// The compile-hook result contract (interfaces/node-compile-context/SPEC.md v1 draft): validation,
// limits and attribution. Deterministic data only, so no interpreter is needed here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import { COMPILE_HOOK_LIMITS, throwIfHookErrors, validateCompileHookResult } from "../src/node-library/compile-hook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dirname, "../../interfaces/node-compile-context/api.json"), "utf8"));

const label = "custom/dht22 (node n1)";

describe("validateCompileHookResult", () => {
  it("treats null/undefined as nothing to add", () => {
    expect(validateCompileHookResult(null, label)).toEqual({ properties: {}, claims: [], warnings: [], errors: [] });
    expect(validateCompileHookResult(undefined, label).properties).toEqual({});
  });

  it("accepts a full result", () => {
    expect(
      validateCompileHookResult(
        {
          properties: { madctl: 96, label: "screen" },
          claims: [{ resource: "GPIO 22", use: "I2C0 SCL" }],
          warnings: ["capped"],
          errors: [],
        },
        label,
      ),
    ).toEqual({
      properties: { madctl: 96, label: "screen" },
      claims: [{ resource: "GPIO 22", use: "I2C0 SCL" }],
      warnings: ["capped"],
      errors: [],
    });
  });

  it("rejects an unknown key rather than ignoring it", () => {
    expect(() => validateCompileHookResult({ propertys: {} }, label)).toThrow(CompileError);
    expect(() => validateCompileHookResult({ propertys: {} }, label)).toThrow(/unknown key "propertys"/);
  });

  it("rejects a non-dict result", () => {
    expect(() => validateCompileHookResult([1, 2], label)).toThrow(/must return a dict/);
    expect(() => validateCompileHookResult("hi", label)).toThrow(/must return a dict/);
  });

  it("rejects non-JSON values and cycles", () => {
    expect(() => validateCompileHookResult({ properties: { x: NaN } }, label)).toThrow(/finite/);
    expect(() => validateCompileHookResult({ properties: { x: undefined } }, label)).toThrow(/only JSON values/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validateCompileHookResult({ properties: cyclic }, label)).toThrow(/cycle/);
  });

  it("enforces the size and count limits", () => {
    expect(() => validateCompileHookResult({ properties: { x: "a".repeat(COMPILE_HOOK_LIMITS.propertiesBytes) } }, label)).toThrow(/limit is 65536/);
    expect(() => validateCompileHookResult({ claims: Array.from({ length: 65 }, () => ({ resource: "GPIO 1", use: "out" })) }, label)).toThrow(/limit is 64/);
    expect(() => validateCompileHookResult({ warnings: Array.from({ length: 33 }, () => "w") }, label)).toThrow(/limit is 32/);
  });

  it("rejects a malformed claim", () => {
    expect(() => validateCompileHookResult({ claims: [{ resource: "", use: "x" }] }, label)).toThrow(/non-empty string/);
    expect(() => validateCompileHookResult({ claims: [{ resource: "GPIO 1", use: "x", who: "me" }] }, label)).toThrow(/unknown key "who"/);
  });

  it("attributes errors to the node and joins them", () => {
    const result = validateCompileHookResult({ errors: ["pin 35 is input-only", "no bus"] }, label);
    expect(() => throwIfHookErrors(result, label)).toThrow(`${label}: pin 35 is input-only; no bus`);
  });
});

describe("compile-context limits match the spec", () => {
  it("mirrors interfaces/node-compile-context/api.json", () => {
    expect(COMPILE_HOOK_LIMITS).toEqual({
      propertiesBytes: spec.limits.properties_bytes,
      claims: spec.limits.claims,
      warnings: spec.limits.warnings,
      errors: spec.limits.errors,
      hookWallMs: spec.limits.hook_wall_ms,
      compileWallMs: spec.limits.compile_wall_ms,
    });
  });
});
