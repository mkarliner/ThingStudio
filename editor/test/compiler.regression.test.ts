// The regression check docs/working-notes/validation/mvp-validation-plan.md's
// Tier 0 section calls for: "recompile POC-D's exact inject -> function ->
// gpio_out graph through the new general compiler; output must be
// behaviorally identical to POC-D's hand-verified result (§15.5)."
//
// "Behaviorally identical" -- not textually identical. The general
// compiler is expected to produce different variable/function names and
// module structure than pocs/poc-d/compiler.js's hardcoded version (it uses
// `runtime` not `harness_api`, generates `_function`/`_gpio_out` not
// `_node_function`/`_node_gpio_out`, etc.) -- what has to match is what
// the code actually does when run: initialize pin 12 as an output, then
// set it high because the inject node's payload is `true`.
//
// Run for real against mock `machine`/`runtime` modules (see
// test/fixtures/pymock/) since this sandbox has no MicroPython -- not a
// substitute for the real headless-unix-port check the validation plan
// calls for, just the closest thing achievable here.

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

// The exact graph pocs/poc-d/compiler.js hardcoded support for -- see
// pocs/poc-d/compiler.js and pocs/poc-d/nodes.js's default properties: inject's
// default bool payload `true` and `manual` repeat, function as a
// passthrough, gpio_out on pin 12 (this board's onboard LED, per
// pocs/poc-a's and pocs/poc-d's own comments about GPIO12/13 being the wired ones).
function pocDGraph(): GraphData {
  return {
    nodes: [
      { id: "1", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
      { id: "2", type: "thingstudio/function", properties: { code: "msg['payload'] = msg['payload']\nreturn msg\n" } },
      { id: "3", type: "thingstudio/gpio_out", properties: { pin: 12 } },
    ],
    links: [
      [1, "1", 0, "2", 0, "bool"],
      [2, "2", 0, "3", 0, "bool"],
    ],
  };
}

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

describe("general compiler: POC-D regression", () => {
  it("recompiles POC-D's exact graph to Python that runs and behaves the same way", () => {
    const { source } = compile(pocDGraph(), buildRegistry());

    expect(source).toContain("import runtime");
    expect(source).toContain("import machine");

    const output = runGenerated(source);

    // Same physical outcome POC-D verified on real hardware (§15.5):
    // pin 12 initialized as an output, then driven high (payload true).
    expect(output).toContain("PIN_INIT 12 OUT");
    expect(output).toContain("PIN_VALUE 12 1");
  });

  it("reflects a changed inject payload (false) in the pin value", () => {
    const graph = pocDGraph();
    graph.nodes[0]!.properties.payloadValue = "false";
    const { source } = compile(graph, buildRegistry());
    const output = runGenerated(source);
    expect(output).toContain("PIN_VALUE 12 0");
  });
});
