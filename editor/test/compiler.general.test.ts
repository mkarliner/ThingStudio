// Beyond the POC-D regression: proof the compiler actually generalizes
// past a single hardcoded 3-node chain, since that's the whole point of
// replacing poc-d/compiler.js (docs/working-notes/mvp-feature-priorities.md's
// Tier 0: "a topological walk over arbitrary graphs... instead of one
// function that already knows every node type by name").

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

describe("general compiler: shapes POC-D's hardcoded compiler could never accept", () => {
  it("compiles two independent inject -> gpio_out chains (multiple sources) into one flow", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: 3, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "false", repeat: "manual" } },
        { id: 4, type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 3, 0, 4, 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    // Two independent coroutines, two spawns -- not folded into one.
    expect(source.match(/^async def _flow_\d+\(\):/gm)?.length).toBe(2);
    expect(source.match(/^runtime\.spawn\(/gm)?.length).toBe(2);

    const output = runGenerated(source);
    expect(output).toContain("PIN_VALUE 12 1");
    expect(output).toContain("PIN_VALUE 13 0");
  });

  it("compiles a chain of two function nodes before the sink (depth POC-D's compiler never handled)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/function", properties: { code: "msg['payload'] = not msg['payload']\nreturn msg\n" } },
        { id: 3, type: "thingstudio/function", properties: { code: "msg['payload'] = not msg['payload']\nreturn msg\n" } },
        { id: 4, type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 2, 0, 3, 0, "bool"],
        [3, 3, 0, 4, 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    const output = runGenerated(source);
    // true -> not -> not -> true again: double negation round-trips.
    expect(output).toContain("PIN_VALUE 12 1");
  });

  it("a function node returning None stops propagation without skipping the sleep/yield", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "1s" } },
        { id: 2, type: "thingstudio/function", properties: { code: "return None\n" } },
        { id: 3, type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 2, 0, 3, 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    // The sink call must be nested inside the None-check; the sleep must
    // NOT be -- otherwise a short-circuited chain would busy-loop the
    // event loop instead of yielding (the exact hazard class §5 and
    // POC-D's hardware bugs warn about). Checked by comparing the
    // sleep line's indentation against the msg-construction line's --
    // both sit directly inside the coroutine's `while True:`, so they
    // must match; a sleep nested inside the `if msg is not None:` block
    // would be indented 4 spaces further.
    expect(source).toMatch(/if msg is not None:\n\s+_gpio_out\(msg\)/);
    const lines = source.split("\n");
    const buildMsgLine = lines.find((l) => l.includes("msg = {'payload'"));
    const sleepLine = lines.find((l) => l.includes("asyncio.sleep_ms"));
    expect(buildMsgLine).toBeDefined();
    expect(sleepLine).toBeDefined();
    const leadingSpaces = (l: string) => l!.match(/^\s*/)![0].length;
    expect(leadingSpaces(sleepLine!)).toBe(leadingSpaces(buildMsgLine!));
  });
});
