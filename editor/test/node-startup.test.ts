// startup as a core package (2026-10-21). A run-once source: one emit at flow start, no trigger, no interval. The
// payload is typed at run time, so the plain compiler handles it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { resolvePortType } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry();
const TYPE = "thingstudio/startup";

function ctx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    resolveConfig: () => ({}),
  };
}

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "startup-1", type: TYPE, properties };
}

function graphOf(properties: Record<string, unknown>, extra: GraphData["nodes"] = [], links: GraphData["links"] = []): GraphData {
  return { nodes: [node(properties), ...extra], links };
}

function runSnippet(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-startup-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, source);
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

function runBuildMsg(properties: Record<string, unknown>, key = "payload", startReason?: string): string {
  const def = registry.get(TYPE)!;
  const result = def.codegenSource!(node(properties), ctx());
  return runSnippet(
    [
      "import runtime",
      "asyncio = runtime.asyncio",
      ...(startReason === undefined ? [] : [`runtime.start_reason = ${JSON.stringify(startReason)}`]),
      ...(result.imports ?? []),
      ...(result.statements ?? []).map((s) => s.code),
      "",
      "async def _main():",
      ...result.buildMsg.split("\n").map((l) => `    ${l}`),
      `    print(msg[${JSON.stringify(key)}])`,
      "",
      "asyncio.run(_main())",
    ].join("\n"),
  );
}

describe("thingstudio/startup package", () => {
  it("builds a bool payload", () => {
    expect(runBuildMsg({ payloadType: "bool", payloadValue: "true" }).trim()).toBe("True");
  });

  it("builds a number payload", () => {
    expect(runBuildMsg({ payloadType: "number", payloadValue: "7" }).trim()).toBe("7");
  });

  it("builds a string payload", () => {
    expect(runBuildMsg({ payloadType: "string", payloadValue: "boot" }).trim()).toBe("boot");
  });

  it("defaults payloadType to bool", () => {
    expect(runBuildMsg({ payloadValue: "true" }).trim()).toBe("True");
  });

  it("adds msg['reason'] alongside a fixed payload", () => {
    expect(runBuildMsg({ payloadType: "bool", payloadValue: "true" }, "reason", "deep_sleep").trim()).toBe("deep_sleep");
  });

  it("payload type 'reason' sends the start reason, with a string output port", () => {
    expect(runBuildMsg({ payloadType: "reason" }, "payload", "deploy").trim()).toBe("deploy");
    expect(resolvePortType(registry.get(TYPE)!.ports!.outputs![0]!, { payloadType: "reason" })).toBe("string");
  });

  it("falls back to 'unknown' when the runtime has no start_reason", () => {
    const def = registry.get(TYPE)!;
    const result = def.codegenSource!(node({ payloadType: "reason" }), ctx());
    const out = runSnippet(
      [
        "import runtime",
        "asyncio = runtime.asyncio",
        "if hasattr(runtime, 'start_reason'): del runtime.start_reason",
        ...(result.statements ?? []).map((s) => s.code),
        "",
        "async def _main():",
        ...result.buildMsg.split("\n").map((l) => `    ${l}`),
        "    print(msg['payload'], msg['reason'])",
        "",
        "asyncio.run(_main())",
      ].join("\n"),
    );
    expect(out.trim()).toBe("unknown unknown");
  });

  it("reports an invalid number at run time", () => {
    const def = registry.get(TYPE)!;
    const result = def.codegenSource!(node({ payloadType: "number", payloadValue: "nope" }), ctx());
    expect(() =>
      runSnippet(
        [
          "import runtime",
          "asyncio = runtime.asyncio",
          ...(result.statements ?? []).map((s) => s.code),
          "",
          "async def _main():",
          ...result.buildMsg.split("\n").map((l) => `    ${l}`),
          "",
          "asyncio.run(_main())",
        ].join("\n"),
      ),
    ).toThrow(/not a valid number/);
  });

  it("runs once: repeatMs 0 and a plain source, not an event source", () => {
    const def = registry.get(TYPE)!;
    const result = def.codegenSource!(node({ payloadType: "bool", payloadValue: "true" }), ctx());
    expect(result.repeatMs).toBe(0);
    expect(def.codegenEventSource).toBeUndefined();
  });

  it("compiles into a spawned straight-line coroutine with no loop, sleep or trigger registration", () => {
    const g = graphOf(
      { payloadType: "bool", payloadValue: "true" },
      [{ id: "gpio-1", type: "thingstudio/gpio_out", properties: { pin: 12 } }],
      [[1, "startup-1", 0, "gpio-1", 0, "bool"]],
    );
    const { source } = compile(g, registry);
    expect(source).toMatch(/runtime\.spawn\(.*"startup-1"\)/);
    expect(source).not.toContain("while True:");
    expect(source).not.toContain("asyncio.sleep_ms");
    expect(source).not.toMatch(/runtime\.register_trigger\(/);
  });

  it("runs once at flow start, actually firing the sink", () => {
    const g = graphOf(
      { payloadType: "bool", payloadValue: "true" },
      [{ id: "gpio-1", type: "thingstudio/gpio_out", properties: { pin: 12 } }],
      [[1, "startup-1", 0, "gpio-1", 0, "bool"]],
    );
    const output = runSnippet(compile(g, registry).source);
    expect(output).toContain("PIN_VALUE 12 1");
  });
});
