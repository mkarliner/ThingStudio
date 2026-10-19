// SPDX-License-Identifier: Apache-2.0
// editor/src/compile-hook/run-hook.ts
//
// Runs one package compile hook in the vendored MicroPython WASI interpreter
// (interfaces/node-compile-context/SPEC.md draft). This module is interpreter plumbing: build the
// wrapper script, run it, and turn the sentinel-prefixed output into a result or an Error. Result
// validation and node attribution stay in node-library/compile-hook(s).ts.
//
// NO TIMEOUT HERE. This blocks the caller until the hook finishes; the worker that hosts it enforces the
// wall-clock budget by terminating. Tests call this directly (trusted hooks only).

import { runWasi, runWasiSync, type WasiRunResult } from "./wasi.js";

const OK = "__TS_HOOK_OK__";
const ERR = "__TS_HOOK_ERROR__";

export interface HookRunRequest {
  readonly wasmBytes: Uint8Array;
  /** The package's `<name>.compile.py` text. */
  readonly hookSource: string;
  /** The context dict (interfaces/node-compile-context/), already JSON-shaped. */
  readonly context: unknown;
  /** The node's raw stored properties. */
  readonly properties: Record<string, unknown>;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The wrapper script. The user hook is spliced in unchanged; the result (or the exception) is printed
 * behind a sentinel on one line so ordinary prints from the hook cannot be mistaken for it. */
function wrapperScript(hookSource: string, ctxB64: string, propsB64: string): string {
  return `import json
import binascii

_ts_ctx = json.loads(binascii.a2b_base64('${ctxB64}'))
_ts_props = json.loads(binascii.a2b_base64('${propsB64}'))

${hookSource}

try:
    _ts_result = compile(_ts_ctx, _ts_props)
except Exception as _ts_err:
    print('${ERR}' + json.dumps({'type': type(_ts_err).__name__, 'message': str(_ts_err)}))
else:
    print('${OK}' + json.dumps(_ts_result))
`;
}

function lastLine(output: string, marker: string): string | null {
  const lines = output.split("\n").filter((l) => l.startsWith(marker));
  return lines.length > 0 ? lines[lines.length - 1]!.slice(marker.length) : null;
}

function codeFor(request: HookRunRequest): string {
  return wrapperScript(request.hookSource, toBase64(JSON.stringify(request.context)), toBase64(JSON.stringify(request.properties)));
}

function parse(run: WasiRunResult): unknown {
  const output = `${run.stdout}\n${run.stderr}`;

  const ok = lastLine(run.stdout, OK);
  if (ok !== null) {
    try {
      return JSON.parse(ok);
    } catch (err) {
      throw new Error(`compile hook returned output that is not JSON (${err instanceof Error ? err.message : String(err)}): ${ok}`);
    }
  }
  const errLine = lastLine(run.stdout, ERR);
  if (errLine !== null) {
    let detail = errLine;
    try {
      const parsed = JSON.parse(errLine) as { type?: string; message?: string };
      detail = `${parsed.type ?? "Error"}: ${parsed.message ?? ""}`.trim();
    } catch {
      // Keep the raw line; the message still names the failure.
    }
    throw new Error(`compile hook raised ${detail}`);
  }
  const excerpt = output.trim().split("\n").slice(-6).join("\n");
  throw new Error(
    run.exitCode !== 0
      ? `compile hook interpreter exited with code ${run.exitCode}${excerpt ? `:\n${excerpt}` : ""}`
      : `compile hook produced no result${excerpt ? `:\n${excerpt}` : ""}`,
  );
}

/** Runs the hook and returns its parsed JSON result. Throws an Error (with the interpreter's output) on a
 * hook exception, a syntax error, or output that is not the expected marker. */
export async function runHookOnce(request: HookRunRequest): Promise<unknown> {
  const run = await runWasi(request.wasmBytes, ["micropython", "-c", codeFor(request)]);
  return parse(run);
}

/** Synchronous variant for the CLI's synchronous check path. No containment (see wasi.ts). */
export function runHookOnceSync(request: HookRunRequest): unknown {
  const run = runWasiSync(request.wasmBytes, ["micropython", "-c", codeFor(request)]);
  return parse(run);
}
