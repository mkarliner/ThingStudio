// Compile-context conformance vectors (interfaces/node-compile-context/vectors/): each vector is run in the real
// vendored MicroPython WASI interpreter and its result validated by the same code the compiler uses. The timeout
// vector is containment, not result data -- the WASI runner has no budget by design -- so it is checked for shape
// here and exercised by compile-hook-runner.test.ts (worker budget) and the browser smoke test.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { throwIfHookErrors, validateCompileHookResult } from "../src/node-library/compile-hook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorsDir = join(__dirname, "../../interfaces/node-compile-context/vectors");
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));

interface Vector {
  name: string;
  runner?: string;
  hook: string;
  context: unknown;
  properties: Record<string, unknown>;
  expect: {
    properties?: Record<string, unknown>;
    claims?: unknown[];
    warnings?: string[];
    errors?: string[];
    validation_error?: string;
    raised?: string;
    timeout_ms?: number;
  };
}

function vectors(): Vector[] {
  return readdirSync(vectorsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(vectorsDir, f), "utf8")) as Vector);
}

const all = vectors();
const runnable = all.filter((v) => v.runner !== "worker");

describe("compile-context conformance vectors", () => {
  it("includes the required cases", () => {
    const names = all.map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(["worked-example", "errors-entry", "malformed-return", "newer-context", "runaway-hook"]));
  });

  it("the timeout vector is the worker-containment case", () => {
    const timeout = all.find((v) => v.runner === "worker");
    expect(timeout?.name).toBe("runaway-hook");
    expect(timeout?.expect.timeout_ms).toBe(1000);
    expect(timeout?.hook).toContain("while True");
  });

  for (const vector of runnable) {
    it(`${vector.name}: runs the hook and matches the expected result`, async () => {
      const run = runHookOnce({ wasmBytes, hookSource: vector.hook, context: vector.context, properties: vector.properties });

      if (vector.expect.raised !== undefined) {
        await expect(run).rejects.toThrow(vector.expect.raised);
        return;
      }

      const raw = await run;
      if (vector.expect.validation_error !== undefined) {
        expect(() => validateCompileHookResult(raw, vector.name)).toThrow(vector.expect.validation_error);
        return;
      }

      const result = validateCompileHookResult(raw, vector.name);
      if (vector.expect.errors !== undefined) {
        expect(result.errors).toEqual(vector.expect.errors);
        expect(() => throwIfHookErrors(result, vector.name)).toThrow(vector.expect.errors.join("; "));
        return;
      }
      if (vector.expect.properties !== undefined) expect(result.properties).toEqual(vector.expect.properties);
      if (vector.expect.claims !== undefined) expect(result.claims).toEqual(vector.expect.claims);
      if (vector.expect.warnings !== undefined) expect(result.warnings).toEqual(vector.expect.warnings);
    });
  }
});
