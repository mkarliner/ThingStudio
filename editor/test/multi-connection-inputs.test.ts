// SPDX-License-Identifier: Apache-2.0
// editor/test/multi-connection-inputs.test.ts
//
// Multi-connection node inputs (outstanding-items/multi-connection-node-
// inputs.md, Mike's design call 2026-09-10): every node input now allows
// any number of incoming wires, Node-RED-style, not just one.
//
// Headless -- no DOM, no AreaPlugin/rete-connection-plugin -- same
// discipline graph-adapter.test.ts already established: exercises the
// real installed `rete` package's NodeEditor/ClassicPreset directly.
// Deliberately does NOT attempt to test rete-connection-plugin's own
// interactive-drag `syncConnections()` auto-eviction behavior (nodes.ts's
// own 2026-09-10 header note explains that mechanism and why reading its
// source was enough to trust it without a browser -- that's real-browser,
// Mike's-own-hands-on-pass territory, same as every other canvas-drag
// behavior in this codebase, not something this headless suite can drive
// at all). What IS tested here, at the two layers this headless harness
// *can* actually reach:
//   1. Each affected node class's real input port objects carry
//      `multipleConnections: true` -- a direct, one-line-per-class
//      regression guard on the nodes.ts change itself.
//   2. The full pipeline -- two independent sources wired into ONE
//      shared input on one debug node, through the real (untouched)
//      toGraphData()/compile()/generated-Python path -- actually runs and
//      produces both messages. This is the identical mechanism
//      compiler.general.test.ts's pre-existing "fan-in: two independent
//      sources sharing one gpio_out sink" test already covers at the
//      compiler layer (proving compile.ts needed no change at all); this
//      test proves the same thing end-to-end starting from the Rete
//      editor layer instead of a hand-built GraphData literal.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes } from "../src/app/rete/schemes.js";
import {
  InjectNode,
  FunctionNode,
  DelayNode,
  DebugNode,
  GpioOutNode,
  PwmOutNode,
  UdpSendNode,
  HttpRequestNode,
  HttpResponseNode,
  MqttPublishNode,
  CustomNode,
} from "../src/app/rete/nodes.js";
import { toGraphData } from "../src/app/rete/graph-adapter.js";
import { compile } from "../src/compiler/compile.js";
import { buildRegistry } from "../src/node-library/registry.js";
import type { CustomNodeDescriptor } from "../src/node-library/custom-node.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runGenerated(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-multiconn-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

async function connect(editor: NodeEditor<Schemes>, source: ClassicPreset.Node, sourceKey: string, target: ClassicPreset.Node, targetKey: string) {
  await editor.addConnection(new ClassicPreset.Connection(source, sourceKey, target, targetKey) as Schemes["Connection"]);
}

function multipleConnections(node: ClassicPreset.Node, inputKey: string): boolean | undefined {
  return (node.inputs as Record<string, { multipleConnections?: boolean } | undefined>)[inputKey]?.multipleConnections;
}

// One test per input-bearing first-party class -- mirrors nodes.ts's own
// addInput call list exactly (grep "new ClassicPreset.Input(" there to
// keep this in sync if a new input-bearing node type is added).
describe("multi-connection node inputs -- port declarations", () => {
  it("function's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new FunctionNode(), "msg")).toBe(true);
  });

  it("delay's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new DelayNode(), "msg")).toBe(true);
  });

  it("debug's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new DebugNode(), "msg")).toBe(true);
  });

  it("gpio_out's signal input has multipleConnections=true", () => {
    expect(multipleConnections(new GpioOutNode(), "signal")).toBe(true);
  });

  it("pwm_out's duty input has multipleConnections=true", () => {
    expect(multipleConnections(new PwmOutNode(), "duty")).toBe(true);
  });

  it("udp_send's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new UdpSendNode(), "msg")).toBe(true);
  });

  it("http_request's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new HttpRequestNode(), "msg")).toBe(true);
  });

  it("http_response's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new HttpResponseNode(), "msg")).toBe(true);
  });

  it("mqtt_publish's msg input has multipleConnections=true", () => {
    expect(multipleConnections(new MqttPublishNode(), "msg")).toBe(true);
  });

  it("a loaded custom node's inputs also get multipleConnections=true", () => {
    const descriptor: CustomNodeDescriptor = {
      type: "custom/multiconn-test",
      kind: "sink",
      label: "multiconn test",
      ports: { inputs: [{ name: "msg", type: "any" }] },
    };
    const node = new CustomNode(descriptor);
    expect(multipleConnections(node, "msg")).toBe(true);
  });
});

describe("multi-connection node inputs -- end-to-end fan-in through the Rete editor layer", () => {
  it("two independent sources wired into ONE debug node's single input both fire -- toGraphData()/compile()/generated Python, no compiler change needed", async () => {
    const editor = new NodeEditor<Schemes>();
    const injectA = new InjectNode();
    injectA.properties.payloadType = "string";
    injectA.properties.payloadValue = "from A";
    const injectB = new InjectNode();
    injectB.properties.payloadType = "string";
    injectB.properties.payloadValue = "from B";
    const debug = new DebugNode();

    await editor.addNode(injectA);
    await editor.addNode(injectB);
    await editor.addNode(debug);
    // Both sources target the SAME "msg" input on the SAME debug node --
    // exactly what rete-connection-plugin's syncConnections() used to
    // silently evict the first of, before this change.
    await connect(editor, injectA, "msg", debug, "msg");
    await connect(editor, injectB, "msg", debug, "msg");

    const graphData = toGraphData(editor);
    // Both links present -- the adapter never de-duplicated or dropped
    // either one (this file's header: it never had to change).
    expect(graphData.links).toHaveLength(2);
    expect(graphData.links.every((l) => l[3] === debug.id)).toBe(true);

    const { source } = compile(graphData, buildRegistry());
    // debug's Python function is defined exactly once, same "shared sink,
    // one function, called from each incoming path" guarantee
    // compiler.general.test.ts's own fan-in test already established.
    expect(source.match(/^async def _debug\(msg\):/gm)?.length).toBe(1);
    expect(source.match(/^runtime\.spawn\(/gm)?.length).toBe(2);

    const output = runGenerated(source);
    expect(output).toContain(`DEBUG node=${debug.id} payload='from A'`);
    expect(output).toContain(`DEBUG node=${debug.id} payload='from B'`);
  });
});
