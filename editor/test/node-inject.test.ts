// inject as a core package (2026-10-21). Event source: a ThreadSafeEvent per instance, registered under the node's
// own id; a §13 TRIGGER fires it and the output face emits the configured payload. Typing is at run time, so a flow
// with inject still compiles through the plain compiler (it is the fixture most other node tests use).

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
const registry = buildRegistry();

function graphOf(propertiesList: Record<string, unknown>[]): GraphData {
  const nodes = propertiesList.flatMap((props, i) => [
    { id: String(i + 1), type: "thingstudio/inject", properties: props },
    { id: `d${i + 1}`, type: "thingstudio/debug", properties: {} },
  ]);
  const links = propertiesList.map((_, i) => [i + 1, String(i + 1), 0, `d${i + 1}`, 0, "any"] as [number, string, number, string, number, string]);
  return { nodes, links };
}

function run(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-inject-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, source);
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("thingstudio/inject package", () => {
  it("is an event source with a data-form output port and a nodeId field", () => {
    const def = registry.get("thingstudio/inject")!;
    expect(def.kind).toBe("source");
    expect(def.codegenEventSource).toBeDefined();
    expect(def.codegenSource).toBeUndefined();
    expect(def.ports?.outputs?.[0]?.type).toEqual({ property: "payloadType", map: { bool: "bool", number: "number", string: "string" }, default: "bool" });
    expect(def.properties?.some((p) => p.name === "nodeId")).toBe(true);
  });

  it("registers one ThreadSafeEvent per node under its own id", () => {
    const { source } = compile(graphOf([{ payloadType: "bool", payloadValue: "true" }, { payloadType: "bool", payloadValue: "false" }]), registry);
    expect(source.match(/ThreadSafeEvent\(\)/g)?.length).toBe(2);
    expect(source).toContain('"nodeId": "1"');
    expect(source).toContain('"nodeId": "2"');
    expect(source).toContain("runtime.register_trigger(properties['nodeId'], _evt)");
    expect(source).toContain("while True:");
    expect(source).not.toContain("asyncio.sleep_ms");
  });

  it("emits a bool payload", () => {
    const output = run(compile(graphOf([{ payloadType: "bool", payloadValue: "true" }]), registry).source);
    expect(output).toContain("DEBUG node=d1 payload=True");
  });

  it("emits a number payload", () => {
    const output = run(compile(graphOf([{ payloadType: "number", payloadValue: "42.5" }]), registry).source);
    expect(output).toContain("DEBUG node=d1 payload=42.5");
  });

  it("emits a string payload once per fired trigger", () => {
    const output = run(compile(graphOf([{ payloadType: "string", payloadValue: "hello mike!" }]), registry).source);
    const hits = output.split("\n").filter((l) => l.includes("DEBUG node=d1"));
    expect(hits).toEqual(["DEBUG node=d1 payload='hello mike!'"]);
  });

  it("reports an invalid number at run time", () => {
    const output = run(compile(graphOf([{ payloadType: "number", payloadValue: "nope" }]), registry).source);
    expect(output).toContain("is not a valid number");
  });
});
