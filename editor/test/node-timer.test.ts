// timer as a core package (editor/src/node-library/core-packages/timer.ts). See node-gpio-in.test.ts's header
// for why the codegen tests call codegenSource directly rather than going through the full compiler + asyncio
// machinery; the iteration test runs the generated setup/emit against pymock's runtime.asyncio.

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
import { descriptor as timerDescriptor, python as timerPython } from "../src/node-library/core-packages/timer.js";
import { buildCoreNodeDefinition } from "../src/node-library/custom-node.js";
import { buildRegistry } from "../src/node-library/registry.js";

const timerNode = buildCoreNodeDefinition(timerDescriptor, timerPython);

const __dirname = dirname(fileURLToPath(import.meta.url));

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/timer", properties };
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
    // resolveConfig isn't exercised here -- the timer node doesn't read
    // config nodes. Stub throws if ever called, matching every other node
    // test file's updated ctx.
    resolveConfig(id: string): Record<string, unknown> {
      throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
    },
  };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

function runIterations(properties: Record<string, unknown>, n: number): string {
  const result = timerNode.codegenSource!(node(properties), freshCtx());
  // The generic package codegen's buildMsg is `msg = await <emit>(<props>)`; pull the two names out so the
  // snippet can call the generated entry function the same way the compiled flow's coroutine does.
  const call = /^msg = await (\w+)\((\w+)\)$/.exec(result.buildMsg);
  if (!call) throw new Error(`unexpected package buildMsg: ${result.buildMsg}`);
  const [, emitName, propsName] = call;
  const lines = [
    "import runtime",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    "async def _iterate():",
    indent(`for _ in range(${n}):`, 4),
    indent(`msg = await ${emitName}(${propsName})`, 8),
    indent(`print(msg['payload'])`, 8),
    "",
    "asyncio.run(_iterate())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
  });
}

describe("thingstudio/timer node", () => {
  it("emits an incrementing tick count across repeated iterations", () => {
    const output = runIterations({ intervalMs: 500 }, 3);
    expect(output.trim().split("\n")).toEqual(["1", "2", "3"]);
  });

  it("two timer node instances get independent setup closures", () => {
    const ctx = freshCtx();
    const a = timerNode.codegenSource!(node({ intervalMs: 500 }), ctx);
    const b = timerNode.codegenSource!(node({ intervalMs: 1000 }), ctx);
    expect(a.statements?.[0]?.key).not.toBe(b.statements?.[0]?.key);
  });

  it("sets repeatMs from the configured intervalMs", () => {
    const result = timerNode.codegenSource!(node({ intervalMs: 2500 }), freshCtx());
    expect(result.repeatMs).toBe(2500);
  });

  it("defaults intervalMs to 1000ms when not configured", () => {
    const result = timerNode.codegenSource!(node({}), freshCtx());
    expect(result.repeatMs).toBe(1000);
  });

  it("rejects a non-positive intervalMs", () => {
    expect(() => timerNode.codegenSource!(node({ intervalMs: 0 }), freshCtx())).toThrow(CompileError);
    expect(() => timerNode.codegenSource!(node({ intervalMs: -5 }), freshCtx())).toThrow(CompileError);
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/timer", properties: { intervalMs: 750 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "number"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("while True:");
    expect(source).toContain("asyncio.sleep_ms(750)");
    expect(source).toMatch(/def \w*timer_setup\(properties\):/);
    expect(source).toMatch(/runtime\.spawn\(/);
  });
});
