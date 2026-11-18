// SPDX-License-Identifier: Apache-2.0
// editor/test/module-boundaries.test.ts
//
// Dependency-free enforcement of the editor's internal module boundaries
// (AGENTS.md "Architecture first at subsystem interfaces"). A repo can't rely
// on review alone to stop an agent (or a hurried human) from reaching across
// layers -- this scans the real import graph and fails on a forbidden edge.
//
// The rules below are the ones the codebase already satisfies, chosen so a
// future wrong coupling is caught rather than documented:
//   - `app/` is the top layer: only `app/` and `cli/` may import it.
//   - `protocol/` is the wire layer and imports no other editor subsystem.
//   - `compiler/` (the engine) does not import `node-library/` (which registers
//     into it) or `app/` (the canvas).
//   - no editor source imports outside editor/src (except the demo's example flows, as text).
//   - `install/` (the install page) imports only `definitions/`, `raw-repl/` and `app/board-diagnosis.ts`.
//   - `raw-repl/` (MicroPython's raw REPL) imports no other editor subsystem.
// Adding a legitimate new cross-layer edge means updating this list on purpose,
// in the change that adds it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

interface Edge {
  readonly from: string; // e.g. "app/main.ts"
  readonly fromTop: string;
  readonly toTop: string;
  readonly spec: string;
}

function collectEdges(): Edge[] {
  const edges: Edge[] = [];
  const files = readdirSync(SRC, { recursive: true }) as string[];
  for (const raw of files) {
    if (!raw.endsWith(".ts")) continue;
    const from = raw.split("\\").join("/");
    const fromTop = from.split("/")[0]!;
    const source = readFileSync(join(SRC, raw), "utf8");
    for (const m of source.matchAll(/from\s+"(\.[^"]*)"/g)) {
      const spec = m[1]!;
      const target = normalize(join(dirname(from), spec)).split("\\").join("/");
      const toTop = target.startsWith("..") ? "(outside src)" : target.split("/")[0]!;
      edges.push({ from, fromTop, toTop, spec });
    }
  }
  return edges;
}

const EDGES = collectEdges();

function violations(check: (e: Edge) => boolean): string[] {
  return EDGES.filter(check).map((e) => `${e.from} -> ${e.spec}`);
}

describe("editor module boundaries", () => {
  it("only app/ and cli/ import app/ (and install/, board-diagnosis.ts alone)", () => {
    const bad = violations(
      (e) => e.toTop === "app" && e.fromTop !== "app" && e.fromTop !== "cli" && !(e.fromTop === "install" && e.spec === "../app/board-diagnosis.js"),
    );
    expect(bad, `lower layers must not import app/: ${bad.join(", ")}`).toEqual([]);
  });

  it("protocol/ imports no other editor subsystem", () => {
    const bad = violations((e) => e.fromTop === "protocol" && e.toTop !== "protocol");
    expect(bad, `protocol/ must stay self-contained: ${bad.join(", ")}`).toEqual([]);
  });

  it("compiler/ does not import node-library/ or app/", () => {
    const bad = violations((e) => e.fromTop === "compiler" && (e.toTop === "node-library" || e.toTop === "app"));
    expect(bad, `compiler/ must not depend on the node library or the canvas: ${bad.join(", ")}`).toEqual([]);
  });

  // The one exception, on purpose: the online demo's Examples menu bundles flow files as text from the repo's
  // tutorials/ and test-flows/ (2026-11-08, online-editor-demo-scoping.md). Data, not code, from the folders
  // that own those flows, so they can't drift from a copy kept under src.
  const allowedOutside = (e: Edge): boolean =>
    e.from === "app/demo-examples.ts" && /^\.\.\/\.\.\/\.\.\/(tutorials|test-flows)\/[^/]+\.flow\.json\?raw$/.test(e.spec);

  it("no editor source imports outside editor/src", () => {
    const bad = violations((e) => e.toTop === "(outside src)" && !allowedOutside(e));
    expect(bad, `relative imports must resolve inside editor/src: ${bad.join(", ")}`).toEqual([]);
  });

  // The install page (setup.html, online build) is a page of its own: it reads the board definitions and nothing
  // else of the editor's, so it can't come to depend on the canvas or the compiler (2026-11-18).
  // It also uses the raw-REPL client (raw-repl/, self-contained like protocol/) and the editor's own advice for a
  // board that won't install (app/board-diagnosis.ts, which imports nothing), so both pages give the same advice.
  it("install/ imports only definitions/, raw-repl/, protocol/ and app/board-diagnosis.ts", () => {
    const bad = violations(
      (e) =>
        e.fromTop === "install" &&
        !["install", "definitions", "raw-repl", "protocol"].includes(e.toTop) &&
        e.spec !== "../app/board-diagnosis.js",
    );
    expect(bad, `install/ must stay a small page of its own: ${bad.join(", ")}`).toEqual([]);
  });

  it("raw-repl/ imports no other editor subsystem", () => {
    const bad = violations((e) => e.fromTop === "raw-repl" && e.toTop !== "raw-repl");
    expect(bad, `raw-repl/ must stay self-contained: ${bad.join(", ")}`).toEqual([]);
  });

  it("the source tree was actually scanned", () => {
    expect(EDGES.length).toBeGreaterThan(100);
    expect(relative(SRC, SRC)).toBe("");
  });
});
