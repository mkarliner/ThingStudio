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
//   - no editor source imports outside editor/src.
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
  it("only app/ and cli/ import app/", () => {
    const bad = violations((e) => e.toTop === "app" && e.fromTop !== "app" && e.fromTop !== "cli");
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

  it("no editor source imports outside editor/src", () => {
    const bad = violations((e) => e.toTop === "(outside src)");
    expect(bad, `relative imports must resolve inside editor/src: ${bad.join(", ")}`).toEqual([]);
  });

  it("the source tree was actually scanned", () => {
    expect(EDGES.length).toBeGreaterThan(100);
    expect(relative(SRC, SRC)).toBe("");
  });
});
