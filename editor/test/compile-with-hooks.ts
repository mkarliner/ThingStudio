// Shared test helper: compile through the async package-hook pre-pass (the same order main.ts uses), with
// the real vendored MicroPython WASI interpreter. A flow containing a hooked package (wifi_status) refuses a
// plain compile() -- that refusal is deliberate (a hook must not be silently skipped), so tests use this.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompileOptions, CompileResult } from "../src/compiler/compile.js";
import type { NodeDefinition } from "../src/compiler/node-definition.js";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks, type CompileHookRunner } from "../src/node-library/compile-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));

export const testHookRunner: CompileHookRunner = {
  run: (hookSource, ctx, properties) => runHookOnce({ wasmBytes, hookSource, context: ctx, properties }),
};

export async function compileWithHooks(
  graph: GraphData,
  registry: ReadonlyMap<string, NodeDefinition>,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const hooks = await runCompileHooks(graph, registry, testHookRunner, { target: options.target });
  return compile(graph, registry as Map<string, NodeDefinition>, {
    ...options,
    hookResults: hooks.results,
    hookWarnings: [...hooks.warnings, ...(options.hookWarnings ?? [])],
  });
}
