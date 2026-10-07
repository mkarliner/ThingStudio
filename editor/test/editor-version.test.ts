// SPDX-License-Identifier: Apache-2.0
// editor/test/editor-version.test.ts -- how the editor names its own build (2026-10-07).

import { describe, expect, it } from "vitest";
import { editorVersionLabel, editorVersionLine } from "../src/app/editor-version.js";

const B = { version: "0.1.2", commit: "3f2a9c1", dirty: false, builtAt: "2026-10-07 14:08 UTC" };

describe("editor version", () => {
  it("labels a clean build with version and commit", () => {
    expect(editorVersionLabel(B)).toBe("v0.1.2 · 3f2a9c1");
    expect(editorVersionLine(B)).toBe("Editor 0.1.2, commit 3f2a9c1, built 2026-10-07 14:08 UTC");
  });
  it("marks a build made from uncommitted changes", () => {
    expect(editorVersionLabel({ ...B, dirty: true })).toBe("v0.1.2 · 3f2a9c1+");
    expect(editorVersionLine({ ...B, dirty: true })).toContain("commit 3f2a9c1 with uncommitted changes");
  });
  it("still says something without git or a version", () => {
    expect(editorVersionLabel({ ...B, version: null, commit: null })).toBe("dev build");
    expect(editorVersionLine({ ...B, version: null, commit: null })).toBe("Editor (version unknown), commit unknown, built 2026-10-07 14:08 UTC");
  });
});
