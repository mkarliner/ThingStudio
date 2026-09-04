// Design doc §5's per-task fault isolation, exercised at the compiler
// output level -- the off-device half of the validation plan's
// "Fault isolation" bar (docs/working-notes/validation/mvp-validation-plan.md):
// "confirm NODE_ERROR reports the correct node ID and exception info, and
// confirm every other node/task keeps running unaffected." The plan
// itself calls the *real* version of this a hardware test (real uasyncio
// scheduling); this is the compiler/codegen half that's actually testable
// off-device -- does the generated Python correctly attribute a node's own
// exception to that node's ID, not the chain's source, via
// runtime.NodeError (device-runtime/src/runtime.py,
// nodeCallWithFaultBoundary in ../src/compiler/compile.ts)? Real uasyncio
// task-completion behavior is covered separately, against real
// MicroPython, in device-runtime/test/test_runtime.py.

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

describe("fault isolation: NODE_ERROR attribution in generated code", () => {
  it("blames the failing function node, not the chain's inject source", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "raise ValueError('deliberately broken')\n" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    const output = runGenerated(source);

    // node 2 (the function node), not node 1 (the chain's inject/source) --
    // this is the exact distinction nodeCallWithFaultBoundary exists for.
    expect(output).toContain("NODE_ERROR node=2 type=ValueError msg=deliberately broken");
    expect(output).not.toContain("node=1 ");
    // the sink never ran -- the exception stopped the chain at node 2, as
    // §5 says it should ("the failing subgraph's task stops").
    expect(output).not.toContain("PIN_VALUE");
  });

  it("a passthrough transform ahead of a working sink triggers no NodeError wrapper at all", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "return msg\n" } }, // passthrough, doesn't fail
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    // Every node call is still wrapped (nodeCallWithFaultBoundary applies
    // unconditionally), but when nothing actually raises, that's invisible
    // in the output -- no NODE_ERROR line, sink runs normally.
    const output = runGenerated(source);
    expect(output).not.toContain("NODE_ERROR");
    expect(output).toContain("PIN_VALUE 13 1");
  });

  it("one failing chain doesn't stop an independent second chain (per-chain task isolation)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "2", type: "thingstudio/function", properties: { code: "raise RuntimeError('chain A is broken')\n" } },
        { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: "4", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: "5", type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, "1", 0, "2", 0, "bool"],
        [2, "2", 0, "3", 0, "bool"],
        [3, "4", 0, "5", 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/^runtime\.spawn\(/gm)?.length).toBe(2); // two independent tasks

    // pymock's spawn() runs each chain to completion via asyncio.run(),
    // sequentially, in source order -- good enough here since the point is
    // "chain B's own output still appears, unaffected by chain A having
    // already failed," not real concurrent scheduling (that's
    // test_runtime.py's job, against real uasyncio).
    const output = runGenerated(source);
    expect(output).toContain("NODE_ERROR node=2 type=RuntimeError msg=chain A is broken");
    expect(output).toContain("PIN_VALUE 13 1"); // chain B's sink still ran
  });
});
