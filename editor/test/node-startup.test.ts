// docs/working-notes/inject-node-live-fire-and-startup-node.md: startup
// (editor/src/node-library/startup.ts) is the node that took over
// inject's old "runs automatically at flow start" role -- structurally
// inject's own pre-split shape (codegenSource, hardcoded repeatMs: 0, "run
// once then stop"). See node-timer.test.ts's header for the general
// "call codegen directly, run the emitted snippet through python3
// against fixtures/pymock" pattern this file also follows.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { startupNode } from "../src/node-library/startup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/startup", properties };
}

function freshCtx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    resolveConfig(id: string): Record<string, unknown> {
      throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
    },
  };
}

function runBuildMsg(properties: Record<string, unknown>): string {
  const result = startupNode.codegenSource!(node(properties), freshCtx());
  const lines = [...(result.imports ?? []), ...(result.statements ?? []).map((s) => s.code), result.buildMsg, "print(msg['payload'])"];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: pymockDir }, encoding: "utf8" });
}

describe("thingstudio/startup node", () => {
  it("builds a bool payload", () => {
    expect(runBuildMsg({ payloadType: "bool", payloadValue: "true" }).trim()).toBe("True");
  });

  it("builds a number payload", () => {
    expect(runBuildMsg({ payloadType: "number", payloadValue: "7" }).trim()).toBe("7");
  });

  it("builds a string payload", () => {
    expect(runBuildMsg({ payloadType: "string", payloadValue: "boot" }).trim()).toBe("boot");
  });

  it("defaults payloadType to bool when unset", () => {
    expect(runBuildMsg({ payloadValue: "true" }).trim()).toBe("True");
  });

  it("rejects an invalid number payload", () => {
    expect(() => startupNode.codegenSource!(node({ payloadType: "number", payloadValue: "nope" }), freshCtx())).toThrow(CompileError);
  });

  it("always sets repeatMs to 0 -- runs once, never repeats", () => {
    const result = startupNode.codegenSource!(node({ payloadType: "bool", payloadValue: "true" }), freshCtx());
    expect(result.repeatMs).toBe(0);
  });

  it("is a plain source, not an event source -- auto-runs at flow start, not click-fired", () => {
    expect(typeof startupNode.codegenSource).toBe("function");
    expect(startupNode.codegenEventSource).toBeUndefined();
  });

  it("compiles into a spawned, straight-line coroutine -- no while loop, no sleep, no fire registration", () => {
    const graph: GraphData = {
      nodes: [
        { id: "startup-1", type: "thingstudio/startup", properties: { payloadType: "bool", payloadValue: "true" } },
        { id: "gpio-1", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [[1, "startup-1", 0, "gpio-1", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toMatch(/runtime\.spawn\(.*"startup-1"\)/);
    expect(source).not.toContain("while True:");
    expect(source).not.toContain("asyncio.sleep_ms");
    expect(source).not.toMatch(/runtime\.register_trigger\(/);
  });

  it("runs once at flow start, actually firing the sink, when the whole compiled flow is executed", () => {
    const graph: GraphData = {
      nodes: [
        { id: "startup-1", type: "thingstudio/startup", properties: { payloadType: "bool", payloadValue: "true" } },
        { id: "gpio-1", type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [[1, "startup-1", 0, "gpio-1", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    const dir = mkdtempSync(join(tmpdir(), "thingstudio-compile-"));
    const scriptPath = join(dir, "_flow.py");
    writeFileSync(scriptPath, source);
    const pymockDir = join(__dirname, "fixtures", "pymock");
    const output = execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: pymockDir }, encoding: "utf8" });
    expect(output).toContain("PIN_VALUE 12 1");
  });
});
