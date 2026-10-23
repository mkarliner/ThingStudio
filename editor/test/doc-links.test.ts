// SPDX-License-Identifier: Apache-2.0
// editor/test/doc-links.test.ts
//
// Every "Help: …" link the console prints has to land somewhere. The paths are hand-written strings
// (board-diagnosis.ts's DOC_*, and the deploy memory advice's DEPLOY_MEMORY_DOC), the docs are
// hand-written pages, and nothing else in the build connects the two -- so renaming a heading silently
// turns a help link into a 404 at the moment a user needs it (2026-10-23: the memory ladder became the
// canonical page for deploying twice on a low-memory board).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as boardDiagnosis from "../src/app/board-diagnosis.js";
import { DEPLOY_MEMORY_DOC } from "../src/app/memory-advice.js";
import type { DocLink } from "../src/app/board-diagnosis.js";

const GUIDE = join(__dirname, "..", "..", "docs", "user-guide");

const links: [string, DocLink][] = [
  ...Object.entries(boardDiagnosis)
    .filter(([name, value]) => name.startsWith("DOC_") && typeof value === "object" && value !== null)
    .map(([name, value]) => [name, value as DocLink] as [string, DocLink]),
  ["DEPLOY_MEMORY_DOC", DEPLOY_MEMORY_DOC],
];

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/ /g, "-");
}

describe("console doc links", () => {
  it("has links to check", () => {
    expect(links.length).toBeGreaterThan(4);
  });

  for (const [name, doc] of links) {
    it(`${name} → ${doc.path}`, () => {
      expect(doc.label.length, `${name} needs a label`).toBeGreaterThan(0);
      const [raw, anchor] = doc.path.split("#");
      // MkDocs writes "debugging/" for debugging.md, so a trailing slash is a page, not a folder.
      const page = (raw ?? "").replace(/\/$/, "");
      const file = existsSync(join(GUIDE, `${page}.md`))
        ? join(GUIDE, `${page}.md`)
        : join(GUIDE, page, "index.md");
      expect(existsSync(file), `${name} points at a missing page: ${page}`).toBe(true);
      if (!anchor) return;
      const headings = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .map((line) => slug(line.replace(/^#+/, "")));
      expect(headings, `${name} points at a missing heading #${anchor} in ${page}`).toContain(anchor);
    });
  }
});
