// The compile-hook interpreter artifact (micropython-wasi/README.md): both copies must stay byte-identical, and the
// hash must be the one the pinned build (tools/build_micropython_wasi.py) recorded. This is the CI check the
// release review asked for -- a rebuild that changes the artifact must update this constant and the README together.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = readFileSync(new URL("../../micropython-wasi/micropython-wasi.wasm", import.meta.url));
const editorCopy = readFileSync(new URL("../public/vendor/micropython-wasi/micropython-wasi.wasm", import.meta.url));
const RECORDED_SHA256 = "49e76057f67398ef8c78c42fb065fba1d07e436a992557381cfddb5b57375987";

describe("micropython-wasi artifact", () => {
  it("is byte-identical in micropython-wasi/ and editor/public/vendor/", () => {
    expect(editorCopy.equals(root)).toBe(true);
  });

  it("matches the recorded build hash", () => {
    expect(createHash("sha256").update(root).digest("hex")).toBe(RECORDED_SHA256);
  });
});
