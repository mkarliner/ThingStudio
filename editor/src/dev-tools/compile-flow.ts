// SPDX-License-Identifier: Apache-2.0
// editor/src/dev-tools/compile-flow.ts
//
// Scratch CLI, not part of the product: takes a GraphData-shaped flow JSON
// (graph.ts's `{ nodes, links }` shape -- the same input compile.ts's own
// tests construct by hand) and prints the compiled Python source, the same
// way the real editor's Deploy button would generate it before handing it
// to mpy-cross. Exists because there's no real flow-file load/save yet
// (design doc §6/Tier 3 -- "not built in any POC yet") and no canvas
// session to paste a hand-written test flow into, so this is the only way
// to get a JSON flow from disk through the real compiler today.
//
// Usage: node dist-dev-tools/dev-tools/compile-flow.js path/to/flow.json
// (compiled via a one-off `tsc` invocation -- see test-flows/README.md).

import { readFileSync } from "node:fs";
import { compile } from "../compiler/compile.js";
import type { GraphData } from "../compiler/graph.js";
import { buildRegistry } from "../node-library/registry.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: compile-flow.js <flow.json>");
  process.exit(2);
}

const graph = JSON.parse(readFileSync(path, "utf8")) as GraphData;
const { source } = compile(graph, buildRegistry());
process.stdout.write(source);
