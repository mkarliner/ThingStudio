// thingstudio/inject node (editor/src/node-library/inject.ts) -- the
// click-only live-fire feature (2026-09-02,
// docs/working-notes/outstanding-items/inject-click-fire-missing.md).
// This is the first dedicated test file for inject; before this feature,
// every other node-*.test.ts file used inject purely as an anonymous
// "drives one message through the flow under test" fixture (still true --
// see pymock's runtime.py header for how those keep working unmodified
// now that inject is an always-looping event-source node instead of a
// terminating one), and inject's own codegen had no test of its own.
//
// What this file actually proves, same split node-interrupt.test.ts's own
// header draws between "provable off-device" and "needs real hardware":
// codegenEventSource's generated text shape (setup/wait/buildMsg,
// including the runtime.register_trigger self-registration call), the
// full compiled flow's structure (event-driven, no repeatMs/sleep_ms, one
// ThreadSafeEvent per inject instance), and an actual end-to-end run
// proving a real (pymock-simulated) trigger is what makes the chain fire
// -- NOT proof that a real §13 TRIGGER message from a real WebSerial
// connection reaches this device-side code; that half lives in
// device-runtime/test/test_listener_integration.py, and the real click ->
// wire round trip is unverified in a browser until Mike's own hands-on
// pass, same standing caveat every prior canvas-wiring session carries.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { injectNode } from "../src/node-library/inject.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- inject's codegen doesn't reference any config`);
  },
};

function node(id: number, properties: Record<string, unknown>): GraphNode {
  return { id, type: "thingstudio/inject", properties };
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

describe("thingstudio/inject node", () => {
  it("codegenEventSource registers a ThreadSafeEvent under this node's own ID", () => {
    const result = injectNode.codegenEventSource!(node(7, { payloadType: "bool", payloadValue: "true" }), ctx);
    expect(result.imports).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(result.statements?.[0]?.code).toContain("_inject_evt_7 = ThreadSafeEvent()");
    expect(result.statements?.[0]?.code).toContain(`runtime.register_trigger("7", _inject_evt_7)`);
    expect(result.waitStatement).toContain("await _inject_evt_7.wait()");
    expect(result.waitStatement).toContain("_inject_evt_7.clear()");
    expect(result.buildMsg).toBe("msg = {'payload': True, 'topic': ''}");
  });

  it("builds the msg payload for each payload type, same literals as before this rewrite", () => {
    // pyPayloadLiteral's default (non-bool/number) case runs the value
    // through pyStringLiteral -> JSON.stringify, which produces a
    // double-quoted Python string literal, NOT a single-quoted one --
    // only the dict's own fixed 'payload'/'topic' keys are single-quoted
    // (written directly in inject.ts's own template literal).
    expect(injectNode.codegenEventSource!(node(1, { payloadType: "string", payloadValue: "hi" }), ctx).buildMsg).toBe(
      `msg = {'payload': "hi", 'topic': ''}`,
    );
    expect(injectNode.codegenEventSource!(node(1, { payloadType: "number", payloadValue: "42.5" }), ctx).buildMsg).toBe(
      "msg = {'payload': 42.5, 'topic': ''}",
    );
  });

  it("has no codegenSource at all -- inject is event-source only now", () => {
    expect(injectNode.codegenSource).toBeUndefined();
  });

  it("compiles into a full flow with the expected structure -- event-driven, not repeatMs/sleep_ms", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(source).toContain("_inject_evt_1 = ThreadSafeEvent()");
    expect(source).toContain('runtime.register_trigger("1", _inject_evt_1)');
    expect(source).toContain("while True:");
    expect(source).toMatch(/await _inject_evt_1\.wait\(\)/);
    expect(source).toContain("_inject_evt_1.clear()");
    expect(source).not.toContain("asyncio.sleep_ms");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("two inject nodes in one flow each get their own event, keyed by their own node ID", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true" } },
        { id: 3, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "false" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
        { id: 4, type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 3, 0, 4, 0, "bool"],
      ],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("_inject_evt_1 = ThreadSafeEvent()");
    expect(source).toContain('runtime.register_trigger("1", _inject_evt_1)');
    expect(source).toContain("_inject_evt_3 = ThreadSafeEvent()");
    expect(source).toContain('runtime.register_trigger("3", _inject_evt_3)');
  });

  it("end to end: a fired trigger (pymock's auto-fire, simulating a real click) runs the chain exactly once", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "hello mike!" } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    const output = runGenerated(source);
    const hits = output.split("\n").filter((l) => l.includes("DEBUG node=2"));
    expect(hits).toEqual(["DEBUG node=2 payload='hello mike!'"]);
  });
});
