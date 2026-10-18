// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/compile-hook.ts
//
// The data side of a package's optional <name>.compile.py hook: validates and normalizes what the
// sandboxed interpreter returns (interfaces/node-compile-context/SPEC.md, v1 draft). Running the hook
// lives elsewhere (the async pre-pass + worker); this file is pure so the contract can be tested without
// an interpreter, and so a malformed result is a CompileError naming the package, never a partial
// application.

import { CompileError } from "../compiler/errors.js";
import type { CompileHookClaim, CompileHookResult } from "../compiler/node-definition.js";

/** Limits from interfaces/node-compile-context/api.json. Kept in one place; the conformance test asserts
 * they match the spec file, so this cannot drift silently. */
export const COMPILE_HOOK_LIMITS = {
  propertiesBytes: 65536,
  claims: 64,
  warnings: 32,
  errors: 32,
  hookWallMs: 1000,
  compileWallMs: 5000,
} as const;

const RESULT_KEYS = new Set(["properties", "claims", "warnings", "errors"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** JSON-safe: null, boolean, finite number, string, array of those, or a plain object with string keys.
 * Rejects undefined, NaN/Infinity, functions and cycles -- the hook's result crosses a JSON boundary, so
 * anything that would not survive it is a mistake worth naming here. */
function assertJsonSafe(value: unknown, where: string, seen: Set<object>): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CompileError(`${where} is ${String(value)}; numbers must be finite`);
    return;
  }
  if (typeof value !== "object") throw new CompileError(`${where} is ${typeof value}; only JSON values are allowed`);
  if (seen.has(value)) throw new CompileError(`${where} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${where}[${i}]`, seen));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) assertJsonSafe(v, `${where}.${k}`, seen);
  } else {
    throw new CompileError(`${where} is not a plain object or array`);
  }
  seen.delete(value);
}

function stringList(raw: unknown, key: string, limit: number, label: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new CompileError(`${label}: compile hook "${key}" must be a list of strings`);
  if (raw.length > limit) throw new CompileError(`${label}: compile hook returned ${raw.length} ${key}, limit is ${limit}`);
  return raw.map((v, i) => {
    if (typeof v !== "string") throw new CompileError(`${label}: compile hook ${key}[${i}] must be a string`);
    return v;
  });
}

/** Validates a hook's return value. `null`/`undefined` means the hook had nothing to add; anything else
 * must match SPEC.md §3 exactly (unknown keys are an error, not ignored). */
export function validateCompileHookResult(raw: unknown, label: string): CompileHookResult {
  if (raw === null || raw === undefined) {
    return { properties: {}, claims: [], warnings: [], errors: [] };
  }
  if (!isPlainObject(raw)) throw new CompileError(`${label}: compile hook must return a dict, not ${Array.isArray(raw) ? "a list" : typeof raw}`);
  for (const key of Object.keys(raw)) {
    if (!RESULT_KEYS.has(key)) throw new CompileError(`${label}: compile hook returned unknown key "${key}" (allowed: ${[...RESULT_KEYS].join(", ")})`);
  }

  let properties: Record<string, unknown> = {};
  if (raw.properties !== undefined) {
    if (!isPlainObject(raw.properties)) throw new CompileError(`${label}: compile hook "properties" must be a dict`);
    assertJsonSafe(raw.properties, `${label} compile hook properties`, new Set());
    const bytes = new TextEncoder().encode(JSON.stringify(raw.properties)).length;
    if (bytes > COMPILE_HOOK_LIMITS.propertiesBytes) {
      throw new CompileError(`${label}: compile hook properties are ${bytes} bytes, limit is ${COMPILE_HOOK_LIMITS.propertiesBytes}`);
    }
    properties = raw.properties;
  }

  let claims: CompileHookClaim[] = [];
  if (raw.claims !== undefined) {
    if (!Array.isArray(raw.claims)) throw new CompileError(`${label}: compile hook "claims" must be a list`);
    if (raw.claims.length > COMPILE_HOOK_LIMITS.claims) {
      throw new CompileError(`${label}: compile hook returned ${raw.claims.length} claims, limit is ${COMPILE_HOOK_LIMITS.claims}`);
    }
    claims = raw.claims.map((c, i) => {
      if (!isPlainObject(c) || typeof c.resource !== "string" || c.resource === "" || typeof c.use !== "string" || c.use === "") {
        throw new CompileError(`${label}: compile hook claims[${i}] must be {"resource": non-empty string, "use": non-empty string}`);
      }
      for (const key of Object.keys(c)) {
        if (key !== "resource" && key !== "use") throw new CompileError(`${label}: compile hook claims[${i}] has unknown key "${key}"`);
      }
      return { resource: c.resource, use: c.use };
    });
  }


  return {
    properties,
    claims,
    warnings: stringList(raw.warnings, "warnings", COMPILE_HOOK_LIMITS.warnings, label),
    errors: stringList(raw.errors, "errors", COMPILE_HOOK_LIMITS.errors, label),
  };
}

/** A hook's `errors` entries stop the compile, attributed to the node, before anything it returned is
 * applied. Separate from validateCompileHookResult so a caller can validate first and still attribute. */
export function throwIfHookErrors(result: CompileHookResult, label: string): void {
  if (result.errors.length === 0) return;
  throw new CompileError(`${label}: ${result.errors.join("; ")}`);
}
