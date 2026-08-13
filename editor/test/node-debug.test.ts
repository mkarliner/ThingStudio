// Tier 1 software-only node: debug (editor/src/node-library/debug.ts).
// See node-boolean.test.ts's header for why this runs against pymock.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

describe("thingstudio/debug node", () => {
  it("prints the node id and payload for a string payload", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "hello world", repeat: "manual" } },
        { id: 7, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 7, 0, "string"]],
    };
    const { source } = compile(graph, registry);
    expect(runGenerated(source)).toContain("DEBUG node=7 payload='hello world'");
  });

  it("prints a bool payload", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    const { source } = compile(graph, registry);
    expect(runGenerated(source)).toContain("DEBUG node=2 payload=True");
  });

  it("is a terminal sink -- rejects an outgoing wire from a debug node", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
        { id: 3, type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 2, 0, 3, 0, "bool"],
      ],
    };
    expect(() => compile(graph, registry)).toThrow(/sink/);
  });

  it("multiple debug nodes fanned out from one source each get their own function", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
        { id: 3, type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 1, 0, 3, 0, "bool"],
      ],
    };
    const { source } = compile(graph, registry);
    const output = runGenerated(source);
    expect(output).toContain("DEBUG node=2 payload=True");
    expect(output).toContain("DEBUG node=3 payload=True");
  });
});
