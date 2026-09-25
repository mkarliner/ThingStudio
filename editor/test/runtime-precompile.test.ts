// Every runtime file an install pushes must compile with the editor's own mpy-cross (2026-09-25:
// installs are precompiled -- main.ts's precompileRuntime(), backend runtime_installer.py's
// with_compiled()). A file that doesn't would make the install quietly fall back to source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../device-runtime/", import.meta.url);
const manifest = readFileSync(new URL("runtime_manifest.py", root), "utf8");

function runtimeFiles(): string[] {
  const core = [...(manifest.match(/CORE_FILES[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const listener = manifest.match(/LISTENER_FILE[^=]*=\s*"([^"]+)"/)?.[1];
  const vendor = [...manifest.matchAll(/\("([^"]+\.py)",\s*"[^"]+"\)/g)].map((m) => `vendor/${m[1]}`);
  return [...core, ...(listener ? [listener] : []), ...vendor];
}

describe("runtime precompile", () => {
  it("finds the manifest's files", () => {
    const files = runtimeFiles();
    expect(files).toContain("listener.py");
    expect(files).toContain("vendor/mqtt_as/__init__.py");
    expect(files.length).toBeGreaterThan(10);
  });

  it("compiles every one to bytecode with no -march", async () => {
    // @ts-expect-error -- plain JS module from the vendored WASM build
    const mod = await import("../public/vendor/mpy-cross/mpy-cross.mjs");
    const wasmBinary = readFileSync(fileURLToPath(new URL("../public/vendor/mpy-cross/mpy-cross.wasm", import.meta.url)));
    const errors: string[] = [];
    const M = await mod.default({ wasmBinary, print: () => {}, printErr: (t: string) => errors.push(t) });
    for (const rel of runtimeFiles()) {
      M.FS.writeFile("/in.py", readFileSync(new URL(`src/${rel}`, root), "utf8"));
      const code = M.callMain(["-o", "/out.mpy", "/in.py"]);
      expect(code, `${rel}: ${errors.join(" ")}`).toBe(0);
      const out = M.FS.readFile("/out.mpy") as Uint8Array;
      expect(out[0], rel).toBe(0x4d); // "M"
    }
  }, 60_000);
});
