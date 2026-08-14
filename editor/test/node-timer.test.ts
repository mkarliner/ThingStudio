// Tier 1 GPIO/timer node: timer (editor/src/node-library/timer.ts). See
// node-gpio-in.test.ts's header for why this calls codegenSource
// directly rather than running through the full compiler + asyncio
// machinery (timer's repeatMs, like gpio_in's, is always > 0).

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
import { timerNode } from "../src/node-library/timer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function node(properties: Record<string, unknown>): GraphNode {
  return { id: 1, type: "thingstudio/timer", properties };
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
  // buildMsg's `global` statement needs an actual function scope to mean
  // what it means in the real compiled flow (compile.ts inlines buildMsg
  // into the coroutine body, a real function) -- calling it directly at
  // bare module scope, with the counter's `= 0` init also at module
  // scope, is a SyntaxError ("assigned to before global declaration"):
  // module-level code is its own block for that check, same as a
  // function's, so the init assignment and the `global` referencing the
  // same name in that same block collide. Wrapping in a real function
  // avoids that and matches real usage.
  const lines = [
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    `def _iterate():\n${indent(`${result.buildMsg}\nprint(msg['payload'])`, 4)}`,
    ...Array.from({ length: n }, () => "_iterate()"),
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

  it("two timer node instances get independent counter variables", () => {
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
    expect(() => timerNode.codegenSource!(node({ intervalMs: -5 }), freshCtx())).toThrow(/positive number/);
  });

  it("compiles into a full flow with the expected structure (source text only -- not executed, see header)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/timer", properties: { intervalMs: 750 } },
        { id: 2, type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, 1, 0, 2, 0, "number"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("while True:");
    expect(source).toContain("asyncio.sleep_ms(750)");
    expect(source).toMatch(/global _timer_count/);
    expect(source).toMatch(/runtime\.spawn\(/);
  });
});
