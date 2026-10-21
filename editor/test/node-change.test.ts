// thingstudio/change (2026-10-21): one rule per node, set/delete a msg property or a flow variable. Replaces the
// hidden variable_get/variable_set pair. Runs the generated flow through pymock; the hook validates the rule.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphData } from "../src/compiler/graph.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { compileWithHooks } from "./compile-with-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = { run: (src: string, ctx: unknown, props: Record<string, unknown>) => runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }) };
const TYPE = "thingstudio/change";

function node(id: string, properties: Record<string, unknown>) {
  return { id, type: TYPE, properties };
}

function run(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-change-"));
  const script = join(dir, "_flow.py");
  writeFileSync(script, source);
  return execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

async function hookError(properties: Record<string, unknown>): Promise<string | undefined> {
  const g: GraphData = { nodes: [node("1", properties)], links: [] };
  try {
    await runCompileHooks(g, buildRegistry(), runner);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("thingstudio/change", () => {
  it("is a transform with one input and one output", () => {
    const def = buildRegistry().get(TYPE)!;
    expect(def.kind).toBe("transform");
    expect(def.ports?.inputs).toEqual([{ name: "msg", type: "any" }]);
    expect(def.ports?.outputs).toEqual([{ name: "msg", type: "any" }]);
  });

  it("sets a msg property from a number literal", async () => {
    const graph: GraphData = {
      nodes: [
        { id: "i", type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true" } },
        node("c", { operation: "set", scope: "msg", property: "payload", valueFrom: "literal", valueType: "number", value: "42" }),
        { id: "d", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "i", 0, "c", 0, "any"], [2, "c", 0, "d", 0, "any"]],
    };
    const { source } = await compileWithHooks(graph, buildRegistry());
    expect(run(source)).toContain("payload=42");
  });

  it("sets a flow variable from msg and reads it back into msg", async () => {
    const graph: GraphData = {
      nodes: [
        { id: "i", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "hi" } },
        node("c1", { operation: "set", scope: "flow", property: "x", valueFrom: "msg", value: "payload" }),
        node("c2", { operation: "set", scope: "msg", property: "payload", valueFrom: "flow", value: "x" }),
        { id: "d", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "i", 0, "c1", 0, "any"], [2, "c1", 0, "c2", 0, "any"], [3, "c2", 0, "d", 0, "any"]],
    };
    const { source } = await compileWithHooks(graph, buildRegistry());
    expect(run(source)).toContain("payload='hi'");
  });

  it("deletes a msg property", async () => {
    const graph: GraphData = {
      nodes: [
        { id: "i", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "x" } },
        node("c1", { operation: "set", scope: "msg", property: "extra", valueFrom: "literal", valueType: "string", value: "present" }),
        node("c2", { operation: "delete", scope: "msg", property: "extra" }),
        { id: "f", type: "thingstudio/function", properties: { code: "msg['payload'] = 'has' if 'extra' in msg else 'gone'\nreturn msg" } },
        { id: "d", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "i", 0, "c1", 0, "any"], [2, "c1", 0, "c2", 0, "any"], [3, "c2", 0, "f", 0, "any"], [4, "f", 0, "d", 0, "any"]],
    };
    const { source } = await compileWithHooks(graph, buildRegistry());
    expect(run(source)).toContain("payload='gone'");
  });

  it("rejects an empty property", async () => {
    expect(await hookError({ operation: "set", scope: "msg", property: "  ", valueFrom: "literal", value: "x" })).toMatch(/needs a property/);
  });

  it("rejects an invalid number literal", async () => {
    expect(await hookError({ operation: "set", scope: "msg", property: "payload", valueFrom: "literal", valueType: "number", value: "nope" })).toMatch(/not a valid number/);
  });

  it("rejects an unknown target or operation", async () => {
    expect(await hookError({ operation: "set", scope: "context", property: "x" })).toMatch(/must be msg or flow/);
    expect(await hookError({ operation: "move", scope: "msg", property: "x" })).toMatch(/must be set or delete/);
  });
});
