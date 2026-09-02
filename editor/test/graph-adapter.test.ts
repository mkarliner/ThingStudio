// SPDX-License-Identifier: Apache-2.0
// editor/test/graph-adapter.test.ts
//
// Headless -- no DOM, no AreaPlugin -- exercising toGraphData() directly
// against the real installed `rete` package's NodeEditor/ClassicPreset,
// same discipline pocs/poc-rete/verify-checkpoint1.mjs used for its own
// checkpoint. The last test round-trips the adapter's output through the
// real, untouched compile() (compiler/compile.ts) and actually runs the
// generated Python via pymock -- proof this is genuinely compiler-
// compatible output, not just a shape that happens to type-check.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes } from "../src/app/rete/schemes.js";
import { InjectNode, FunctionNode, DebugNode, GpioOutNode, TimerNode } from "../src/app/rete/nodes.js";
import { toGraphData } from "../src/app/rete/graph-adapter.js";
import { compile } from "../src/compiler/compile.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-adapter-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  try {
    return execFileSync(
      "python3",
      [
        // -u: unbuffered stdout. Load-bearing, not a style preference --
        // see the timeout comment below. Without it, everything this
        // script prints before being killed sits in Python's own stdio
        // buffer (block-buffered whenever stdout isn't a TTY, which it
        // never is under execFileSync) and is simply lost on SIGTERM, no
        // atexit flush runs. Confirmed by reproducing both ways before
        // landing this fix -- the un-flagged version genuinely returns
        // empty output on a timeout-kill, not just a hang.
        "-u",
        scriptPath,
      ],
      {
        env: { ...process.env, PYTHONPATH: pymockDir },
        encoding: "utf8",
        // The one test in this file compiles a graph with a genuinely
        // repeating source (timer, intervalMs>0) alongside a one-shot
        // inject chain -- runtime.spawn() runs each chain's coroutine to
        // completion in turn (pymock's own runtime.py), and the timer
        // chain's `while True: ...; await asyncio.sleep_ms(...)` never
        // completes by design, matching real on-device behavior. That only
        // became a real hang (rather than an immediate, silently-swallowed
        // AttributeError) once runtime.py's own asyncio.sleep_ms shim
        // started working for real (2026-08-18, udp-receive.ts's session --
        // see that file's own comment) -- previously this test finished by
        // accident, not by design. Bounding with a timeout and recovering
        // whatever was already printed is the honest fix: both this test's
        // expected PIN_VALUE lines are written before the timer's first
        // sleep_ms call, so a short bound is plenty, and Node's
        // execFileSync still populates the thrown error's own .stdout with
        // everything captured before the kill (now that -u guarantees
        // there's actually something there to capture).
        timeout: 3000,
      },
    );
  } catch (err) {
    const asExecError = err as { stdout?: string };
    if (typeof asExecError.stdout === "string") return asExecError.stdout;
    throw err;
  }
}

async function connect(editor: NodeEditor<Schemes>, source: ClassicPreset.Node, sourceKey: string, target: ClassicPreset.Node, targetKey: string) {
  await editor.addConnection(new ClassicPreset.Connection(source, sourceKey, target, targetKey) as Schemes["Connection"]);
}

describe("graph-adapter: Rete NodeEditor -> compiler GraphData", () => {
  it("maps node type/properties and assigns sequential 1-indexed numeric IDs", async () => {
    const editor = new NodeEditor<Schemes>();
    const inject = new InjectNode();
    const gpio = new GpioOutNode();
    await editor.addNode(inject);
    await editor.addNode(gpio);
    await connect(editor, inject, "msg", gpio, "signal");

    const { graphData, nodeIdByReteId, reteIdByNodeId } = toGraphData(editor);

    expect(graphData.nodes).toEqual([
      // `repeat` removed 2026-09-02 (inject click-only live-fire feature,
      // nodes.ts's own header note) -- InjectNode's real properties object
      // no longer has it at all, so toGraphData()'s pass-through here
      // reflects that directly.
      { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true" } },
      { id: 2, type: "thingstudio/gpio_out", properties: { pin: 12 } },
    ]);
    expect(nodeIdByReteId.get(inject.id)).toBe(1);
    expect(nodeIdByReteId.get(gpio.id)).toBe(2);
    expect(reteIdByNodeId.get(1)).toBe(inject.id);
    expect(reteIdByNodeId.get(2)).toBe(gpio.id);
  });

  it("computes real slot indices from socket key position, not hardcoded 0 -- sub-decision 1", async () => {
    // A synthetic two-output node, standing in for the status-router/switch
    // node type mvp-feature-priorities.md has waiting on real slot indices
    // -- nothing in nodes.ts has more than one output today, so this proves
    // the adapter's math generalizes rather than merely happening to
    // produce 0 because every real node type currently only has one port.
    class TwoOutputNode extends ClassicPreset.Node {
      width = 100;
      height = 34;
      kind = "test_router" as const;
      properties = {};
      constructor() {
        super("router");
        this.addOutput("true", new ClassicPreset.Output(new ClassicPreset.Socket("any"), "true"));
        this.addOutput("false", new ClassicPreset.Output(new ClassicPreset.Socket("any"), "false"));
      }
    }
    const editor = new NodeEditor<Schemes>();
    const router = new TwoOutputNode();
    const debugTrue = new DebugNode();
    const debugFalse = new DebugNode();
    await editor.addNode(router);
    await editor.addNode(debugTrue);
    await editor.addNode(debugFalse);
    await connect(editor, router, "true", debugTrue, "msg");
    await connect(editor, router, "false", debugFalse, "msg");

    const { graphData } = toGraphData(editor);
    const trueLink = graphData.links.find((l) => l[3] === graphData.nodes[1]!.id)!;
    const falseLink = graphData.links.find((l) => l[3] === graphData.nodes[2]!.id)!;
    expect(trueLink[2]).toBe(0); // "true" is addOutput'd first
    expect(falseLink[2]).toBe(1); // "false" is addOutput'd second -- not 0
  });

  it("assigns distinct sequential link IDs and correct slots for a fan-out (one source, two sinks)", async () => {
    const editor = new NodeEditor<Schemes>();
    const inject = new InjectNode();
    const gpio = new GpioOutNode();
    const debug = new DebugNode();
    await editor.addNode(inject);
    await editor.addNode(gpio);
    await editor.addNode(debug);
    await connect(editor, inject, "msg", gpio, "signal");
    await connect(editor, inject, "msg", debug, "msg");

    const { graphData } = toGraphData(editor);
    expect(graphData.links).toHaveLength(2);
    expect(new Set(graphData.links.map((l) => l[0])).size).toBe(2); // distinct link ids
    for (const link of graphData.links) {
      expect(link[1]).toBe(1); // both originate at the inject node (id 1)
      expect(link[2]).toBe(0); // inject's only output, "msg", is index 0
    }
  });

  it("round-trips through the real, untouched compiler and produces working generated Python", async () => {
    const editor = new NodeEditor<Schemes>();
    const inject = new InjectNode();
    inject.properties.payloadType = "bool";
    inject.properties.payloadValue = "true";
    const fn = new FunctionNode();
    const gpio = new GpioOutNode();
    gpio.properties.pin = 12;
    const timer = new TimerNode();
    timer.properties.intervalMs = 500;
    const gpio2 = new GpioOutNode();
    gpio2.properties.pin = 13;

    await editor.addNode(inject);
    await editor.addNode(fn);
    await editor.addNode(gpio);
    await editor.addNode(timer);
    await editor.addNode(gpio2);
    await connect(editor, inject, "msg", fn, "msg");
    await connect(editor, fn, "msg", gpio, "signal");
    await connect(editor, timer, "msg", gpio2, "signal");

    const { graphData, reteIdByNodeId } = toGraphData(editor);
    const { source, nodeLineRanges } = compile(graphData, buildRegistry());

    // Two independent sources (inject chain + timer chain) -> two coroutines.
    expect(source.match(/^async def _flow_\d+\(\):/gm)?.length).toBe(2);
    // nodeLineRanges' IDs must be real, resolvable numeric IDs the adapter
    // handed out -- not just "some number" -- proving the two halves
    // (adapter's numbering, compiler's own node-ID bookkeeping) agree.
    for (const range of nodeLineRanges) {
      expect(reteIdByNodeId.has(range.nodeId)).toBe(true);
    }

    const output = runGenerated(source);
    expect(output).toContain("PIN_VALUE 12 1"); // inject(true) -> function(pass-through) -> gpio_out
    expect(output).toContain("PIN_VALUE 13 1"); // timer's first tick (count=1, truthy) -> gpio_out
  });
});
