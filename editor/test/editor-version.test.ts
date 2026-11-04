// SPDX-License-Identifier: Apache-2.0
// editor/test/editor-version.test.ts -- how the editor names its own build (2026-10-07).

import { describe, expect, it } from "vitest";
import { editorVersionLabel, editorVersionLine, servedBuildCheck, staleTabLine } from "../src/app/editor-version.js";

const B = { version: "0.1.2", commit: "3f2a9c1", dirty: false, builtAt: "2026-10-07 14:08 UTC", id: "2026-10-07T14:08:11.123Z" };

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

// 2026-11-04: a tab left open across an update kept its old JavaScript; /api/alive's editorBuild names the build
// the backend serves now.
describe("servedBuildCheck", () => {
  const NEW = { ...B, commit: "9d1e4b7", builtAt: "2026-11-04 09:30 UTC", id: "2026-11-04T09:30:02.000Z" };

  it("is the same build when the ids match", () => {
    expect(servedBuildCheck(B, { ...B }, true)).toEqual({ state: "same" });
  });
  it("is stale when the backend serves another build", () => {
    expect(servedBuildCheck(B, NEW, true)).toEqual({ state: "stale", served: NEW });
  });
  it("is stale after a rebuild of the same commit (only the id differs)", () => {
    expect(servedBuildCheck(B, { ...B, id: "2026-10-07T14:09:40.000Z" }, true).state).toBe("stale");
  });
  it("can't confirm when the page didn't come from this backend (npm run dev)", () => {
    expect(servedBuildCheck(B, NEW, false)).toEqual({ state: "unknown" });
  });
  it("can't confirm when the backend reports no build or a malformed one", () => {
    for (const served of [undefined, null, "x", 3, {}, { id: "" }, { id: 7 }, { ...NEW, id: undefined }]) {
      expect(servedBuildCheck(B, served, true)).toEqual({ state: "unknown" });
    }
  });
  it("tolerates odd field types in a served build", () => {
    const check = servedBuildCheck(B, { id: "x", version: 1, commit: null, dirty: "yes" }, true);
    expect(check).toEqual({ state: "stale", served: { version: null, commit: null, dirty: false, builtAt: "x", id: "x" } });
  });
});

describe("staleTabLine", () => {
  it("names both builds and what to do, in one line", () => {
    const line = staleTabLine(B, { ...B, commit: "9d1e4b7", id: "y" });
    expect(line).toBe(
      "[editor] this tab's build (v0.1.2 · 3f2a9c1) isn't the one the backend now serves (v0.1.2 · 9d1e4b7). " +
        "Deploy is off: save your flow, then reload the page",
    );
    expect(line).not.toContain("\n");
  });
  it("adds build times when the labels alone would read the same", () => {
    const line = staleTabLine(B, { ...B, builtAt: "2026-10-07 15:00 UTC", id: "y" });
    expect(line).toContain("(v0.1.2 · 3f2a9c1, built 2026-10-07 14:08 UTC)");
    expect(line).toContain("(v0.1.2 · 3f2a9c1, built 2026-10-07 15:00 UTC)");
  });
});
