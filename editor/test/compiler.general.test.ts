// Beyond the POC-D regression: proof the compiler actually generalizes
// past a single hardcoded 3-node chain, since that's the whole point of
// replacing pocs/poc-d/compiler.js (docs/working-notes/mvp-feature-priorities.md's
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
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: "3", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "false", repeat: "manual" } },
        { id: "4", type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "3", 0, "4", 0, "bool"],
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
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = not msg['payload']\nreturn msg\n" } },
        { id: "3", type: "thingstudio/function", properties: { code: "msg['payload'] = not msg['payload']\nreturn msg\n" } },
        { id: "4", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
        [3, "3", 0, "4", 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    const output = runGenerated(source);
    // true -> not -> not -> true again: double negation round-trips.
    expect(output).toContain("PIN_VALUE 12 1");
  });

  it("a function node returning None stops propagation without skipping the sleep/yield", () => {
    // Uses `timer`, not `inject`, as the repeating source -- this test's
    // whole point is a codegenSource poll loop's sleep/yield surviving a
    // short-circuited chain (repeatMs > 0), and inject no longer has a
    // repeat option at all as of 2026-09-02 (inject.ts's own header:
    // click-only live-fire, event-source codegen, no sleep_ms in its loop
    // whatsoever). `timer` is the direct replacement: same "always
    // repeats, no config beyond an interval" shape inject's old "1s"
    // preset had.
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/timer", properties: { intervalMs: 1000 } },
        { id: "2", type: "thingstudio/function", properties: { code: "return None\n" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "int"],
        [2, "2", 0, "3", 0, "bool"],
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
    // would be indented 4 spaces further. The sink call itself is now
    // wrapped in a try/except (nodeCallWithFaultBoundary, §5's per-node
    // NODE_ERROR attribution) rather than a bare call, hence matching
    // "try:" as the first nested line instead of the call directly.
    // Sink calls are `await`-ed since transform/sink functions compile to
    // `async def` (see compile.ts's header comment on why).
    expect(source).toMatch(/if msg is not None:\n\s+try:\n\s+await _gpio_out\(msg\)/);
    const lines = source.split("\n");
    const buildMsgLine = lines.find((l) => l.includes("msg = {'payload'"));
    const sleepLine = lines.find((l) => l.includes("asyncio.sleep_ms"));
    expect(buildMsgLine).toBeDefined();
    expect(sleepLine).toBeDefined();
    const leadingSpaces = (l: string) => l!.match(/^\s*/)![0].length;
    expect(leadingSpaces(sleepLine!)).toBe(leadingSpaces(buildMsgLine!));
  });

  it("fans one inject's output out to two independent gpio_out sinks", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"], // node 1's output wired to both...
        [2, "1", 0, "3", 0, "bool"], // ...node 2 and node 3
      ],
    };
    const { source } = compile(graph, buildRegistry());
    const output = runGenerated(source);
    expect(output).toContain("PIN_VALUE 12 1");
    expect(output).toContain("PIN_VALUE 13 1");
  });

  it("fan-out clones msg per branch: one branch's mutation doesn't leak into a sibling", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        // branch A: flips payload to false before its sink
        { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = False\nreturn msg\n" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
        // branch B: untouched, straight to its own sink
        { id: "4", type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"], // node 1 -> branch A's function
        [2, "1", 0, "4", 0, "bool"], // node 1 -> branch B's sink directly
        [3, "2", 0, "3", 0, "bool"], // branch A's function -> its sink
      ],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("dict(msg)"); // the clone for the second branch
    const output = runGenerated(source);
    expect(output).toContain("PIN_VALUE 12 0"); // branch A: mutated to false
    expect(output).toContain("PIN_VALUE 13 1"); // branch B: still the original true
  });

  it("fan-in: two independent sources sharing one gpio_out sink each call it once, function generated once", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "false", repeat: "manual" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, "1", 0, "3", 0, "bool"], // source 1 -> shared sink
        [2, "2", 0, "3", 0, "bool"], // source 2 -> the same shared sink
      ],
    };
    const { source } = compile(graph, buildRegistry());
    // The shared sink's Python function is defined exactly once, even
    // though two different sources call it. `async def` since transform/
    // sink functions compile async (see compile.ts's header comment).
    expect(source.match(/^async def _gpio_out\(msg\):/gm)?.length).toBe(1);
    expect(source.match(/^runtime\.spawn\(/gm)?.length).toBe(2);

    const output = runGenerated(source);
    // pymock's spawn() runs each source's chain to completion sequentially
    // (see compiler.fault-isolation.test.ts's comment) -- both calls to
    // the shared sink still show up, one per source, in source order.
    expect(output).toContain("PIN_VALUE 12 1");
    expect(output).toContain("PIN_VALUE 12 0");
    // Only one PIN_INIT -- the pin-claim setup statement is deduplicated
    // by key regardless of how many sources reach the node that claims it.
    expect(output.match(/PIN_INIT 12/g)?.length).toBe(1);
  });
});
