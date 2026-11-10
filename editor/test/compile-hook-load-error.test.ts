// SPDX-License-Identifier: Apache-2.0
// A runtime missing a Wasm feature the hook interpreter needs (exnref: Node 24.13, an older browser) gets one
// message naming the fix, not V8's raw CompileError (Discussions #19 follow-up, 2026-11-10).

import { describe, expect, it } from "vitest";
import { HOOK_BROWSER_MINIMUM, explainInterpreterLoadError } from "../src/compile-hook/wasi.js";

const v8Exnref =
  "WebAssembly.compile(): Compiling function #178 failed: invalid value type 'exn', enable with --experimental-wasm-exnref @+36964";

describe("explainInterpreterLoadError", () => {
  it("turns a missing-feature CompileError into a message naming the fix", () => {
    const out = explainInterpreterLoadError(new WebAssembly.CompileError(v8Exnref));
    expect(out).toBeInstanceOf(Error);
    // Under vitest this is Node, so the Node wording applies; the browser wording names HOOK_BROWSER_MINIMUM.
    expect((out as Error).message).toMatch(/Node\.js .* can't load the interpreter/);
    expect((out as Error).message).toContain("22.23");
  });

  it("names Chrome, Firefox and Safari versions for the browser", () => {
    expect(HOOK_BROWSER_MINIMUM).toMatch(/Chrome.*137.*Firefox 131.*Safari 18\.4/);
  });

  it("leaves other errors alone", () => {
    const plain = new Error("could not load /vendor/micropython-wasi/micropython-wasi.wasm: HTTP 404");
    expect(explainInterpreterLoadError(plain)).toBe(plain);
    const corrupt = new WebAssembly.CompileError("WebAssembly.compile(): expected magic word 00 61 73 6d");
    expect(explainInterpreterLoadError(corrupt)).toBe(corrupt);
  });
});
