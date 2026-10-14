// SPDX-License-Identifier: Apache-2.0
// editor/test/runtime-api-conformance.test.ts
//
// Runs the editor's side of the device-runtime API contract
// (interfaces/runtime-api/SPEC.md + api.json). The runtime module's
// surface lives in four places that must agree: the real runtime.py, the
// editor's pymock fixture (which generated flow code actually runs against
// in this test suite), the generated code itself, and the user docs. This
// test keeps the last three honest against api.json.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const API = JSON.parse(readFileSync(new URL("../../interfaces/runtime-api/api.json", import.meta.url), "utf8")) as {
  surface: { name: string; kind: "function" | "class" | "attribute"; caller: string[] }[];
};
const RUNTIME_PY = readFileSync(new URL("../../device-runtime/src/runtime.py", import.meta.url), "utf8");
const PYMOCK_PY = readFileSync(new URL("./fixtures/pymock/runtime.py", import.meta.url), "utf8");

/** Top-level names in a Python source: `def`/`async def`, `class`, and `name = ...` assignments. */
function topLevelNames(source: string): Map<string, "function" | "class" | "attribute"> {
  const names = new Map<string, "function" | "class" | "attribute">();
  for (const line of source.split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:async )?def (\w+)\s*\(/.exec(line))) names.set(m[1]!, "function");
    else if ((m = /^class (\w+)/.exec(line))) names.set(m[1]!, "class");
    else if ((m = /^import \w+ as (\w+)/.exec(line))) names.set(m[1]!, "attribute");
    else if ((m = /^([A-Za-z_]\w*) = /.exec(line))) names.set(m[1]!, "attribute");
  }
  return names;
}

const runtimeNames = topLevelNames(RUNTIME_PY);
const pymockNames = topLevelNames(PYMOCK_PY);

// Every `runtime.<name>` the editor's codegen sources mention. `runtime.py` / `runtime.md` in
// comments parse as `.py` / `.md`; those two tokens are documentation, not the API.
function codegenRuntimeRefs(): Set<string> {
  const dirs = ["compiler", "node-library", "gui"].map((d) => new URL(`../src/${d}/`, import.meta.url));
  const refs = new Set<string>();
  for (const dir of dirs) {
    for (const file of readdirSync(dir, { recursive: true }) as string[]) {
      if (!file.endsWith(".ts")) continue;
      for (const m of readFileSync(new URL(file, dir), "utf8").matchAll(/runtime\.([A-Za-z_]\w*)/g)) refs.add(m[1]!);
    }
  }
  return refs;
}

describe("device-runtime API conformance (editor)", () => {
  it("every documented name is present in the real runtime.py with the right kind", () => {
    for (const entry of API.surface) {
      expect(runtimeNames.get(entry.name), `${entry.name} in runtime.py`).toBe(entry.kind);
    }
  });

  it("every codegen-facing name is present in the pymock fixture", () => {
    for (const entry of API.surface) {
      if (!entry.caller.includes("codegen")) continue;
      expect(pymockNames.has(entry.name), `${entry.name} in pymock/runtime.py`).toBe(true);
    }
  });

  it("codegen sources only reference documented runtime names", () => {
    const allowed = new Set(API.surface.map((e) => e.name));
    allowed.add("py"); // "runtime.py" in a comment
    allowed.add("md"); // "runtime.md" in a comment
    const unknown = [...codegenRuntimeRefs()].filter((n) => !allowed.has(n));
    expect(unknown, `undeclared runtime.<name> in editor/src: ${unknown.join(", ")}`).toEqual([]);
  });
});
