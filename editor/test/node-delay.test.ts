// From mikes-questions-and-points.md's original node-prioritisation list:
// delay (editor/src/node-library/delay.ts) -- "gets a message and relays
// it after an interval." A transform, so this runs generated code
// end-to-end the same way node-udp-send.test.ts's `runSend` does (real
// `asyncio.run`, PYTHONPATH=pymock's runtime.py shim for `sleep_ms`), not
// just source-string assertions -- confirms the sleep actually happens,
// not just that the generated text mentions one.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { delayNode } from "../src/node-library/delay.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const ctx: CodegenContext = {
  uniqueName: (() => {
    const used = new Set<string>();
    return (hint: string) => {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    };
  })(),
  resolveConfig(id: string): Record<string, unknown> {
    throw new Error(`unexpected resolveConfig("${id}") call -- delay doesn't read config nodes`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/delay", properties };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** Runs codegenTransform's output once against a real msg dict, printing
 * the returned msg's payload/topic as JSON so the test can assert on it.
 * Same `asyncio.run` + pymock-runtime-alias harness node-udp-send.test.ts's
 * `runSend` uses, adapted for a transform's return value instead of a
 * sink's side effect. */
async function runDelay(properties: Record<string, unknown>, payload: unknown): Promise<{ elapsedMs: number; payload: unknown; topic: unknown }> {
  const result = delayNode.codegenTransform!(node(properties), ctx);
  const lines = [
    "import runtime",
    "import json",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    "async def _main():",
    `    msg = {'payload': ${JSON.stringify(payload)}, 'topic': 'in'}`,
    `    msg = await ${result.functionName}(msg)`,
    "    print(json.dumps({'payload': msg['payload'], 'topic': msg['topic']}))",
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  const start = Date.now();
  const { stdout } = await execFileAsync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: pymockDir },
    encoding: "utf8",
    timeout: 10_000,
  });
  const elapsedMs = Date.now() - start;
  const parsed = JSON.parse(stdout.trim());
  return { elapsedMs, payload: parsed.payload, topic: parsed.topic };
}

describe("thingstudio/delay node", () => {
  it("relays the msg unchanged after the configured delay", async () => {
    const { payload, topic } = await runDelay({ delayMs: 30 }, "hello delay");
    expect(payload).toBe("hello delay");
    expect(topic).toBe("in");
  });

  it("actually waits roughly delayMs before relaying -- not a no-op sleep", async () => {
    const { elapsedMs } = await runDelay({ delayMs: 150 }, "x");
    // Generous floor (not exactly 150) -- this is a real subprocess/event-
    // loop round trip, not a pure in-memory timer; the point is confirming
    // a real wait happened, not measuring precision.
    expect(elapsedMs).toBeGreaterThanOrEqual(100);
  });

  it("defaults delayMs to 1000ms when not configured", () => {
    const result = delayNode.codegenTransform!(node({}), ctx);
    expect(result.functionBody).toContain("asyncio.sleep_ms(1000)");
  });

  it("rejects a non-positive delayMs", () => {
    expect(() => delayNode.codegenTransform!(node({ delayMs: 0 }), ctx)).toThrow(CompileError);
    expect(() => delayNode.codegenTransform!(node({ delayMs: -5 }), ctx)).toThrow(/positive number/);
  });

  it("rejects a non-numeric delayMs", () => {
    expect(() => delayNode.codegenTransform!(node({ delayMs: "soon" }), ctx)).toThrow(/positive number/);
  });

  it("two delay node instances get independent function names", () => {
    const a = delayNode.codegenTransform!(node({ delayMs: 100 }), ctx);
    const b = delayNode.codegenTransform!(node({ delayMs: 200 }), ctx);
    expect(a.functionName).not.toBe(b.functionName);
  });

  it("declares an input and output msg port (transform kind, matching function-node.ts's shape)", () => {
    expect(delayNode.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(delayNode.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
  });
});
