// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20): editor/src/node-library/custom-node.ts.
//
// Two halves tested separately, matching this project's usual split for a
// node type's own test file: descriptor validation (pure, synchronous --
// no Python involved) and codegen (executes the generated Python against
// real CPython via python3 + the pymock fixtures, exactly the harness
// node-timer.test.ts/node-udp-send.test.ts already establish -- `import
// runtime; asyncio = runtime.asyncio`, PYTHONPATH pointed at
// fixtures/pymock). Unlike every other node-*.test.ts file, this one's
// codegen is entirely generic (buildCustomNodeDefinition), not per-type --
// so these tests exercise the wrapper/closure machinery itself using a
// handful of representative descriptor+source pairs, not one fixed node
// type's own behavior.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import { evaluatePredicate, resolvePortType } from "../src/compiler/node-descriptor.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import type { Target } from "../src/definitions/target.js";
import { buildRegistry } from "../src/node-library/registry.js";
import {
  buildCustomNodeDefinition,
  CustomNodeDescriptorError,
  mergeCustomNodeRegistry,
  validateCustomNodeDescriptor,
  type CustomNodeDescriptor,
} from "../src/node-library/custom-node.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      throw new Error(`unexpected resolveConfig("${id}") call -- no custom node built in these tests reads a config`);
    },
  };
}

function node(id: number, properties: Record<string, unknown>): GraphNode {
  return { id: String(id), type: "custom/test", properties };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** compile.ts itself is what turns a TransformCodegenResult/SinkCodegenResult's
 * `functionName`/`functionBody` into the actual callable `async def
 * {functionName}(msg): {functionBody}` -- buildCustomNodeDefinition only
 * returns those two pieces, it never defines the function itself (see
 * custom-node.ts). A test driving codegenTransform!()/codegenSink!()
 * directly (bypassing compile()) has to assemble that same wrapper itself
 * before calling `result.functionName`, or the call is a NameError against
 * a function that was never defined -- exactly compile.ts's own assembly,
 * reproduced here rather than skipped. */
function wrapCallable(result: { functionName: string; functionBody: string }): { key: string; code: string } {
  return { key: result.functionName, code: `async def ${result.functionName}(msg):\n${indent(result.functionBody, 4)}` };
}

/** Runs a set of setup statements + a driver body through python3, with
 * `runtime`/`asyncio` aliased exactly the way every other node test's
 * harness does (fixtures/pymock/runtime.py). `driverBody` is NOT indented
 * -- it's placed inside `async def _main(): ...` and run via
 * `asyncio.run(_main())`. */
function runPython(statements: { key: string; code: string }[], driverBody: string): string {
  const lines = ["import runtime", "asyncio = runtime.asyncio", ...statements.map((s) => s.code), "", "async def _main():", indent(driverBody, 4), "", "asyncio.run(_main())"];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-customnode-test-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const pymockDir = join(__dirname, "fixtures", "pymock");
  return execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: pymockDir }, encoding: "utf8" });
}

const TRANSFORM_DESCRIPTOR_RAW = {
  type: "custom/doubler",
  kind: "transform",
  label: "doubler",
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
  properties: [{ name: "factor", label: "factor", kind: "number", default: 2 }],
};

const TRANSFORM_SOURCE = ["async def run(msg, properties):", "    msg['payload'] = msg['payload'] * properties['factor']", "    return msg"].join("\n");

describe("validateCustomNodeDescriptor", () => {
  it("accepts a well-formed transform descriptor", () => {
    const d = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
    expect(d.type).toBe("custom/doubler");
    expect(d.kind).toBe("transform");
    expect(d.properties?.[0]?.default).toBe(2);
  });

  it("rejects a type in the reserved thingstudio/ namespace", () => {
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, type: "thingstudio/doubler" })).toThrow(/reserved/);
  });

  it("rejects a malformed type id", () => {
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, type: "NoSlash" })).toThrow(CustomNodeDescriptorError);
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, type: "Custom/Doubler" })).toThrow(/namespace\/name/);
  });

  it("allows a transform to declare more than one output port", () => {
    const multi = { ...TRANSFORM_DESCRIPTOR_RAW, ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "a", type: "any" }, { name: "b", type: "any" }] } };
    const d = validateCustomNodeDescriptor(multi);
    expect(d.ports?.outputs?.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("rejects the wrong input/output port count for each kind", () => {
    // source: must have 0 inputs, 1 output
    expect(() =>
      validateCustomNodeDescriptor({
        type: "custom/src",
        kind: "source",
        label: "src",
        ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
        properties: [{ name: "intervalMs", label: "interval", kind: "number", default: 1000 }],
      }),
    ).toThrow(/must declare exactly 0 input/);
    // sink: must have 1 input, 0 outputs
    expect(() =>
      validateCustomNodeDescriptor({
        type: "custom/sink1",
        kind: "sink",
        label: "sink1",
        ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
      }),
    ).toThrow(/must declare exactly 0 output/);
  });

  it("requires a numeric intervalMs property on source nodes", () => {
    expect(() =>
      validateCustomNodeDescriptor({
        type: "custom/src2",
        kind: "source",
        label: "src2",
        ports: { outputs: [{ name: "msg", type: "any" }] },
      }),
    ).toThrow(/intervalMs/);
  });

  it("accepts an eventSource source with no intervalMs; a sink may be two-faced; a transform may not", () => {
    const eventSrc = { type: "custom/watcher", kind: "source", label: "watcher", eventSource: true, ports: { outputs: [{ name: "msg", type: "any" }] } };
    expect(validateCustomNodeDescriptor(eventSrc).eventSource).toBe(true);
    const twoFaced = {
      type: "custom/watcher",
      kind: "sink",
      label: "watcher",
      eventSource: true,
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
    };
    expect(validateCustomNodeDescriptor(twoFaced).eventSource).toBe(true);
    expect(() => validateCustomNodeDescriptor({ ...eventSrc, kind: "transform", ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] } })).toThrow(/not valid on a "transform"/);
    expect(() => validateCustomNodeDescriptor({ ...eventSrc, eventSource: "yes" })).toThrow(/must be a boolean/);
  });

  it("rejects a select property whose default isn't one of its options", () => {
    const bad = {
      type: "custom/x",
      kind: "sink",
      label: "x",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "mode", label: "mode", kind: "select", default: "z", options: [{ value: "a", label: "A" }] }],
    };
    expect(() => validateCustomNodeDescriptor(bad)).toThrow(/not one of the declared options/);
  });

  it("accepts a configRef property and requires configType", () => {
    const raw = {
      type: "custom/busreader",
      kind: "transform",
      label: "busreader",
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "bus", label: "I2C bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "" }],
    };
    expect(validateCustomNodeDescriptor(raw).properties?.[0]).toMatchObject({ kind: "configRef", configType: "thingstudio/config/i2c-bus" });
    const withoutConfigType = { name: "bus", label: "I2C bus", kind: "configRef", default: "" };
    expect(() => validateCustomNodeDescriptor({ ...raw, properties: [withoutConfigType] })).toThrow(/configType/);
  });

  it("requires a string default for a configRef property", () => {
    expect(() =>
      validateCustomNodeDescriptor({
        type: "custom/busreader",
        kind: "transform",
        label: "busreader",
        ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
        properties: [{ name: "bus", label: "bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: 0 }],
      }),
    ).toThrow(/must be a string/);
  });

  it("accepts a pin field and the shared field attributes", () => {
    const raw = {
      type: "custom/gpiothing",
      kind: "sink",
      label: "gpiothing",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [
        { name: "pin", label: "pin", kind: "pin", default: 4, min: 0, max: 40, optional: true, help: "the output pin" },
        { name: "level", label: "level", kind: "number", default: 0, step: "any", placeholder: "0-1" },
      ],
    };
    const d = validateCustomNodeDescriptor(raw);
    expect(d.properties?.[0]).toMatchObject({ kind: "pin", default: 4, optional: true, min: 0, max: 40, help: "the output pin" });
    expect(d.properties?.[1]).toMatchObject({ step: "any", placeholder: "0-1" });
  });

  it("rejects a bad pin default and malformed attributes", () => {
    const base = { type: "custom/x", kind: "sink", label: "x", ports: { inputs: [{ name: "msg", type: "any" }] } };
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "pin", label: "pin", kind: "pin", default: "4" }] })).toThrow(/must be a number/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "n", label: "n", kind: "number", default: 0, step: "sometimes" }] })).toThrow(/step must be a finite number or "any"/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "m", label: "m", kind: "number", default: 0, min: "0" }] })).toThrow(/min must be a finite number/);
  });

  it("accepts singleton configRef and pin direction/pull, and rejects misuse", () => {
    const base = { type: "custom/x", kind: "sink", label: "x", ports: { inputs: [{ name: "msg", type: "any" }] } };
    const ok = validateCustomNodeDescriptor({
      ...base,
      properties: [
        { name: "bus", label: "bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "", singleton: true },
        { name: "pin", label: "pin", kind: "pin", default: 4, pinUse: "output", pinPull: "up" },
        { name: "board", label: "board", kind: "target", default: "" },
        { name: "id", label: "id", kind: "nodeId", default: "" },
      ],
    });
    expect(ok.properties?.[0]).toMatchObject({ singleton: true });
    expect(ok.properties?.[1]).toMatchObject({ pinUse: "output", pinPull: "up" });
    expect(ok.properties?.[2]).toMatchObject({ kind: "target" });
    expect(ok.properties?.[3]).toMatchObject({ kind: "nodeId" });
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "n", label: "n", kind: "number", default: 0, singleton: true }] })).toThrow(/singleton is only valid/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "t", label: "t", kind: "text", default: "", pinUse: "output" }] })).toThrow(/pinUse is only valid/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "p", label: "p", kind: "pin", default: 4, pinUse: "sideways" }] })).toThrow(/pinUse must be/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "p", label: "p", kind: "pin", default: 4, pinPull: "middle" }] })).toThrow(/pinPull must be/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: [{ name: "b", label: "b", kind: "target", default: 5 }] })).toThrow(/must be a string/);
  });

  it("accepts a data-driven visibleWhen predicate and rejects malformed ones", () => {
    const base = { type: "custom/x", kind: "sink", label: "x", ports: { inputs: [{ name: "msg", type: "any" }] } };
    const field = (visibleWhen: unknown) => [{ name: "delta", label: "delta", kind: "number", default: 1, visibleWhen }];
    expect(validateCustomNodeDescriptor({ ...base, properties: field({ field: "mode", equals: "relative" }) }).properties?.[0]?.visibleWhen).toEqual({ field: "mode", equals: "relative" });
    expect(() => validateCustomNodeDescriptor({ ...base, properties: field({ equals: "x" }) })).toThrow(/must be a non-empty string/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: field({ field: "mode" }) })).toThrow(/exactly one of/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: field({ field: "mode", equals: "a", gt: 1 }) })).toThrow(/exactly one of/);
    expect(() => validateCustomNodeDescriptor({ ...base, properties: field({ field: "n", gt: "1" }) })).toThrow(/must be a finite number/);
  });

  it("accepts title/hidden/presetType/screenOutline and rejects bad types", () => {
    const d = validateCustomNodeDescriptor({
      type: "custom/x",
      kind: "sink",
      label: "x",
      title: "show x",
      hidden: true,
      presetType: "x",
      screenOutline: true,
      ports: { inputs: [{ name: "msg", type: "any" }] },
    });
    expect(d).toMatchObject({ title: "show x", hidden: true, presetType: "x", screenOutline: true });
    expect(() => validateCustomNodeDescriptor({ type: "custom/x", kind: "sink", label: "x", hidden: "yes" })).toThrow(/"hidden" must be a boolean/);
    expect(() => validateCustomNodeDescriptor({ type: "custom/x", kind: "sink", label: "x", title: "" })).toThrow(/"title" must be a non-empty string/);
  });

  it("rejects a boolean property with a non-boolean default", () => {
    const bad = {
      type: "custom/x",
      kind: "sink",
      label: "x",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "flag", label: "flag", kind: "boolean", default: "true" }],
    };
    expect(() => validateCustomNodeDescriptor(bad)).toThrow(/must be a boolean/);
  });

  it("rejects duplicate property names", () => {
    const bad = {
      type: "custom/x",
      kind: "sink",
      label: "x",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [
        { name: "a", label: "A", kind: "number", default: 1 },
        { name: "a", label: "A again", kind: "number", default: 2 },
      ],
    };
    expect(() => validateCustomNodeDescriptor(bad)).toThrow(/duplicate property/);
  });

  it("rejects an unknown port payload type", () => {
    const bad = { ...TRANSFORM_DESCRIPTOR_RAW, ports: { inputs: [{ name: "msg", type: "object" }], outputs: [{ name: "msg", type: "any" }] } };
    expect(() => validateCustomNodeDescriptor(bad)).toThrow(/must be one of/);
  });

  // Palette ordering (outstanding-items/palette-node-family-ordering.md, 2026-09-13):
  // priority controls display order within a node's group, same field name/meaning
  // as palette.ts's KindStyle.priority for built-in kinds.
  it("accepts a numeric priority and carries it through to the descriptor", () => {
    const d = validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, priority: 25 });
    expect(d.priority).toBe(25);
  });

  it("leaves priority undefined when not declared", () => {
    const d = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
    expect(d.priority).toBeUndefined();
  });

  it("rejects a non-numeric priority", () => {
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, priority: "first" })).toThrow(/"priority" must be a finite number/);
  });

  it("rejects a non-finite priority", () => {
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, priority: Number.POSITIVE_INFINITY })).toThrow(/"priority" must be a finite number/);
  });

  // Node -> board mapping (decisions/node-board-mapping.md): a custom node can declare the hardware it
  // needs, checked centrally against the target like a built-in's `requires`.
  it("carries a requires.capabilities list onto the descriptor", () => {
    const d = validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, requires: { capabilities: ["pio"] } });
    expect(d.requires).toEqual({ capabilities: ["pio"] });
  });

  it("defaults requires to an empty object when present with no capabilities", () => {
    expect(validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, requires: {} }).requires).toEqual({});
  });

  it("rejects an unknown requires key, and a bad capabilities value", () => {
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, requires: { radios: ["wifi"] } })).toThrow(/not recognised/);
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, requires: { capabilities: "pio" } })).toThrow(/non-empty strings/);
    expect(() => validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, requires: { capabilities: [""] } })).toThrow(/non-empty strings/);
  });
});

describe("buildCustomNodeDefinition -- transform", () => {
  const descriptor = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
  const def = buildCustomNodeDefinition(descriptor, TRANSFORM_SOURCE);

  it("registers the expected type/kind/ports", () => {
    expect(def.type).toBe("custom/doubler");
    expect(def.kind).toBe("transform");
    expect(def.ports?.inputs?.[0]).toEqual({ name: "msg", type: "any" });
  });

  it("carries its requires onto the produced NodeDefinition", () => {
    const d = validateCustomNodeDescriptor({ ...TRANSFORM_DESCRIPTOR_RAW, requires: { capabilities: ["pio"] } });
    expect(buildCustomNodeDefinition(d, TRANSFORM_SOURCE).requires).toEqual({ capabilities: ["pio"] });
  });

  it("runs the node author's run(msg, properties) and returns the modified msg", () => {
    const result = def.codegenTransform!(node(1, { factor: 3 }), freshCtx());
    const output = runPython(
      [...(result.statements ?? []), wrapCallable(result)],
      [`msg = {'payload': 5, 'topic': ''}`, `msg = await ${result.functionName}(msg)`, `print(msg['payload'])`].join("\n"),
    );
    expect(output.trim()).toBe("15");
  });

  it("falls back to the property's declared default when the instance doesn't set it", () => {
    const result = def.codegenTransform!(node(1, {}), freshCtx());
    const output = runPython(
      [...(result.statements ?? []), wrapCallable(result)],
      [`msg = {'payload': 10, 'topic': ''}`, `msg = await ${result.functionName}(msg)`, `print(msg['payload'])`].join("\n"),
    );
    expect(output.trim()).toBe("20"); // default factor is 2
  });

  it("rejects a non-numeric property value at codegen time", () => {
    expect(() => def.codegenTransform!(node(1, { factor: "not a number" }), freshCtx())).toThrow(CompileError);
  });

  it("inlines a resolved configRef property's config as a dict (and None for an empty id)", () => {
    const busDescriptor = validateCustomNodeDescriptor({
      type: "custom/busreader",
      kind: "transform",
      label: "busreader",
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "bus", label: "bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "" }],
    });
    const busDef = buildCustomNodeDefinition(busDescriptor, "async def run(msg, properties):\n    msg['payload'] = properties['bus']['bus']\n    return msg\n");

    const ctx = freshCtx();
    ctx.resolveConfig = (id: string) => (id === "cfg1" ? { bus: 0, scl: 22, sda: 21, freq: 100000 } : {});
    const result = busDef.codegenTransform!(node(1, { bus: "cfg1" }), ctx);
    const output = runPython(
      [...(result.statements ?? []), wrapCallable(result)],
      [`msg = {'payload': None, 'topic': ''}`, `msg = await ${result.functionName}(msg)`, `print(msg['payload'])`].join("\n"),
    );
    expect(output.trim()).toBe("0");

    // An empty id resolves to None, and resolveConfig isn't called for it.
    const emptyCtx = freshCtx();
    const emptyResult = busDef.codegenTransform!(node(2, {}), emptyCtx); // default is ""
    expect(emptyResult.statements?.[0]?.code).toContain('"bus": None');
  });

  it("gives two instances of the same custom type independent closures, not shared state", () => {
    // A node type whose setup code keeps a private counter -- if the two
    // instances' closures leaked into each other (e.g. via a naming
    // collision in the generated wrapper), the second instance's counter
    // would start from the first's value instead of its own fresh 0. This
    // is exactly the scoping note's "no cross-instance dedup" claim, run
    // for real rather than just asserted in prose.
    const counterDescriptor = validateCustomNodeDescriptor({
      type: "custom/counter",
      kind: "transform",
      label: "counter",
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
      properties: [],
    });
    // `nonlocal`, not `global` -- see custom-node.ts's own header on why:
    // this source runs inside the generated per-instance wrapper function,
    // not at true module scope, so `global` would look in the wrong place
    // entirely (a real NameError against no such module-level name).
    const counterSource = ["_n = 0", "", "async def run(msg, properties):", "    nonlocal _n", "    _n += 1", "    msg['payload'] = _n", "    return msg"].join("\n");
    const counterDef = buildCustomNodeDefinition(counterDescriptor, counterSource);

    const ctx = freshCtx();
    const a = counterDef.codegenTransform!(node(1, {}), ctx);
    const b = counterDef.codegenTransform!(node(2, {}), ctx);
    const statements = [...(a.statements ?? []), wrapCallable(a), ...(b.statements ?? []), wrapCallable(b)];
    const output = runPython(
      statements,
      [
        `m1 = {'payload': None, 'topic': ''}`,
        `m1 = await ${a.functionName}(m1)`,
        `m1 = await ${a.functionName}(m1)`,
        `m2 = {'payload': None, 'topic': ''}`,
        `m2 = await ${b.functionName}(m2)`,
        `print(m1['payload'], m2['payload'])`,
      ].join("\n"),
    );
    expect(output.trim()).toBe("2 1"); // instance A called twice (2), instance B once (1) -- no shared counter
  });
});

describe("buildCustomNodeDefinition -- sink", () => {
  it("runs run(msg, properties) for its side effect, return value ignored", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/printer",
      kind: "sink",
      label: "printer",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "prefix", label: "prefix", kind: "text", default: ">" }],
    });
    const source = ["async def run(msg, properties):", "    print(properties['prefix'] + str(msg['payload']))", "    return 'ignored'"].join("\n");
    const def = buildCustomNodeDefinition(descriptor, source);
    const result = def.codegenSink!(node(1, { prefix: "sensor: " }), freshCtx());
    const output = runPython(
      [...(result.statements ?? []), wrapCallable(result)],
      [`msg = {'payload': 42, 'topic': ''}`, `await ${result.functionName}(msg)`].join("\n"),
    );
    expect(output.trim()).toBe("sensor: 42");
  });

  it("renders a pin property as a number in the properties dict", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/blink",
      kind: "sink",
      label: "blink",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "pin", label: "pin", kind: "pin", default: 2 }],
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    pass\n");
    const result = def.codegenSink!(node(1, { pin: 5 }), freshCtx());
    expect((result.statements ?? []).map((s) => s.code).join("\n")).toContain('"pin": 5');
  });

  it("resolves a singleton configRef from the flow's one config of that type", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/wifireader",
      kind: "transform",
      label: "wifireader",
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "wifi", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", default: "", singleton: true }],
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    msg['payload'] = properties['wifi']['ssid']\n    return msg\n");
    const ctx = freshCtx();
    ctx.findConfigsOfType = (t: string) => (t === "thingstudio/config/wifi" ? [{ id: "w1", properties: { ssid: "mynet", password: "pw" } }] : []);
    const result = def.codegenTransform!(node(1, {}), ctx);
    const output = runPython(
      [...(result.statements ?? []), wrapCallable(result)],
      [`msg = {'payload': None, 'topic': ''}`, `msg = await ${result.functionName}(msg)`, `print(msg['payload'])`].join("\n"),
    );
    expect(output.trim()).toBe("mynet");

    const zero = freshCtx();
    zero.findConfigsOfType = () => [];
    expect(() => def.codegenTransform!(node(2, {}), zero)).toThrow(/needs a/);
    const many = freshCtx();
    many.findConfigsOfType = () => [{ id: "a", properties: {} }, { id: "b", properties: {} }];
    expect(() => def.codegenTransform!(node(3, {}), many)).toThrow(/exactly one/);
  });

  it("checks a custom pin against the board and claims it as a resource", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/ledthing",
      kind: "sink",
      label: "ledthing",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "pin", label: "pin", kind: "pin", default: 4, pinUse: "output" }],
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    pass\n");
    const claims: string[] = [];
    const ctx = freshCtx();
    ctx.claimResource = (resource: string, use: string): void => {
      claims.push(`${resource}|${use}`);
    };
    const result = def.codegenSink!(node(1, { pin: 5 }), ctx);
    expect((result.statements ?? []).map((s) => s.code).join("\n")).toContain('"pin": 5');
    expect(claims).toEqual(["GPIO 5|output"]);
  });

  it("refuses a custom pin that isn't on the board, and an output on an input-only pin", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/ledthing2",
      kind: "sink",
      label: "ledthing2",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "pin", label: "pin", kind: "pin", default: 2, pinUse: "output" }],
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    pass\n");
    const target = {
      label: "TestBoard",
      gpio: new Set([0, 1, 2, 3]),
      inputOnly: new Set([3]),
      noPull: new Set(),
      reserved: new Map(),
      avoid: new Map(),
      pinLabels: new Map(),
      capabilities: new Set(),
    } as unknown as Target;
    const ctx = freshCtx();
    ctx.target = target;
    expect(() => def.codegenSink!(node(1, { pin: 9 }), ctx)).toThrow(/doesn't exist on TestBoard/);
    expect(() => def.codegenSink!(node(2, { pin: 3 }), ctx)).toThrow(/input-only/);
  });

  it("inlines the board identity for a target field, and None with no board", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/imu",
      kind: "sink",
      label: "imu",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "board", label: "board", kind: "target", default: "" }],
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    pass\n");
    const noneCode = (def.codegenSink!(node(1, {}), freshCtx()).statements ?? []).map((s) => s.code).join("\n");
    expect(noneCode).toContain('"board": None');

    const ctx = freshCtx();
    ctx.target = {
      label: "Seeed XIAO nRF52840",
      processor: { id: "nrf52840", name: "nRF52840" },
      board: { id: "xiao-nrf52840", name: "Seeed XIAO nRF52840" },
      capabilities: new Set(["ble"]),
      gpio: new Set(),
      inputOnly: new Set(),
      noPull: new Set(),
      reserved: new Map(),
      avoid: new Map(),
      pinLabels: new Map(),
    } as unknown as Target;
    const code = (def.codegenSink!(node(2, {}), ctx).statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain('"boardId": "xiao-nrf52840"');
    expect(code).toContain('"boardName": "Seeed XIAO nRF52840"');
    expect(code).toContain('"processorId": "nrf52840"');
    expect(code).toContain('"capabilities": ["ble"]');
  });

  it("inlines the node's own id for a nodeId field (so a package can report its status)", () => {
    const descriptor = validateCustomNodeDescriptor({
      type: "custom/statuser",
      kind: "transform",
      label: "statuser",
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "id", label: "id", kind: "nodeId", default: "" }],
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    msg['payload'] = properties['id']\n    return msg\n");
    const code = (def.codegenTransform!(node(7, {}), freshCtx()).statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain('"id": "7"');
  });
});

describe("buildCustomNodeDefinition -- source", () => {
  const descriptor = validateCustomNodeDescriptor({
    type: "custom/ticker",
    kind: "source",
    label: "ticker",
    ports: { outputs: [{ name: "msg", type: "number" }] },
    properties: [{ name: "intervalMs", label: "interval (ms)", kind: "number", default: 500 }],
  });
  const source = ["_n = 0", "", "async def emit(properties):", "    nonlocal _n", "    _n += 1", "    return {'payload': _n, 'topic': ''}"].join("\n");
  const def = buildCustomNodeDefinition(descriptor, source);

  it("sets repeatMs from the configured intervalMs", () => {
    const result = def.codegenSource!(node(1, { intervalMs: 2500 }), freshCtx());
    expect(result.repeatMs).toBe(2500);
  });

  it("rejects a non-positive intervalMs at codegen time", () => {
    expect(() => def.codegenSource!(node(1, { intervalMs: 0 }), freshCtx())).toThrow(CompileError);
  });

  it("calling emit() repeatedly advances the node's own private state", () => {
    const result = def.codegenSource!(node(1, { intervalMs: 500 }), freshCtx());
    const output = runPython(
      result.statements ?? [],
      [result.buildMsg, "print(msg['payload'])", result.buildMsg, "print(msg['payload'])", result.buildMsg, "print(msg['payload'])"].join("\n"),
    );
    expect(output.trim().split("\n")).toEqual(["1", "2", "3"]);
  });
});

describe("buildCustomNodeDefinition -- event source", () => {
  const descriptor = validateCustomNodeDescriptor({
    type: "custom/watcher",
    kind: "source",
    label: "watcher",
    eventSource: true,
    ports: { outputs: [{ name: "msg", type: "number" }] },
  });

  it("builds a codegenEventSource whose wait/emit come from one closure", () => {
    const source = ["_n = 0", "", "async def wait(properties):", "    pass", "", "async def emit(properties):", "    nonlocal _n", "    _n += 1", "    return {'payload': _n, 'topic': ''}"].join("\n");
    const def = buildCustomNodeDefinition(descriptor, source);
    expect(def.codegenEventSource).toBeTypeOf("function");
    expect(def.codegenSource).toBeUndefined();
    const result = def.codegenEventSource!(node(1, {}), freshCtx());
    expect(result.waitStatement).toMatch(/await _custom_custom_watcher_wait\(/);
    expect(result.buildMsg).toMatch(/msg = await _custom_custom_watcher_emit\(/);
    // One setup statement: both entry functions come from the same per-instance closure.
    expect(result.statements).toHaveLength(1);
    const output = runPython(result.statements ?? [], [result.waitStatement, result.buildMsg, "print(msg['payload'])"].join("\n"));
    expect(output.trim()).toBe("1");
  });

  it("supports a hardware-interrupt source (ThreadSafeEvent + Pin.irq)", () => {
    const source = [
      "import machine",
      "from threadsafe_event import ThreadSafeEvent",
      "",
      "_evt = ThreadSafeEvent()",
      "_pin = runtime.shared('pin', properties['pin'], ('in', 'none'), lambda: machine.Pin(properties['pin'], machine.Pin.IN))",
      "",
      "def _irq(_p):",
      "    _evt.set()",
      "",
      "_pin.irq(trigger=machine.Pin.IRQ_RISING, handler=_irq)",
      "",
      "async def wait(properties):",
      "    await _evt.wait()",
      "    _evt.clear()",
      "",
      "async def emit(properties):",
      "    return {'payload': True, 'topic': ''}",
    ].join("\n");
    const irqDescriptor = validateCustomNodeDescriptor({
      type: "custom/irqbutton",
      kind: "source",
      label: "irqbutton",
      eventSource: true,
      ports: { outputs: [{ name: "msg", type: "bool" }] },
      properties: [{ name: "pin", label: "pin", kind: "pin", default: 11, pinUse: "input" }],
    });
    const def = buildCustomNodeDefinition(irqDescriptor, source);
    const claims: string[] = [];
    const ctx = freshCtx();
    ctx.claimResource = (resource: string, use: string): void => {
      claims.push(`${resource}|${use}`);
    };
    const result = def.codegenEventSource!(node(1, { pin: 11 }), ctx);
    const code = (result.statements ?? []).map((s) => s.code).join("\n");
    expect(code).toContain("from threadsafe_event import ThreadSafeEvent");
    expect(code).toContain("_pin.irq(trigger=machine.Pin.IRQ_RISING, handler=_irq)");
    expect(code).toContain('"pin": 11');
    expect(result.waitStatement).toMatch(/await .*_wait\(/);
    // The pin is board-checked and claimed (phase 2a), so an IRQ package shares/conflicts like a built-in.
    expect(claims).toEqual(["GPIO 11|input, no pull"]);
  });
});

describe("buildCustomNodeDefinition -- two-faced sink", () => {
  const descriptor = validateCustomNodeDescriptor({
    type: "custom/twoway",
    kind: "sink",
    label: "twoway",
    eventSource: true,
    ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "number" }] },
  });
  const source = [
    "_seen = 0",
    "",
    "async def run(msg, properties):",
    "    nonlocal _seen",
    "    _seen += 1",
    "",
    "async def wait(properties):",
    "    pass",
    "",
    "async def emit(properties):",
    "    nonlocal _seen",
    "    return {'payload': _seen, 'topic': ''}",
  ].join("\n");

  it("builds both faces from one closure", () => {
    const def = buildCustomNodeDefinition(descriptor, source);
    expect(def.codegenSink).toBeTypeOf("function");
    expect(def.codegenEventSource).toBeTypeOf("function");
    const ctx = freshCtx();
    const sink = def.codegenSink!(node(1, {}), ctx);
    const event = def.codegenEventSource!(node(1, {}), ctx);
    expect(sink.statements).toHaveLength(1);
    expect(event.statements).toBe(sink.statements); // cached: one setup, one set of state
    const body = [
      "msg = {'payload': 1, 'topic': ''}",
      sink.functionBody,
      event.waitStatement,
      event.buildMsg,
      "print(msg['payload'])",
    ].join("\n");
    const output = runPython(sink.statements ?? [], body);
    expect(output.trim()).toBe("1"); // run() incremented the state emit() reads
  });
});

describe("mergeCustomNodeRegistry", () => {
  it("adds a custom definition without mutating the built-in registry", () => {
    const builtIn = buildRegistry();
    const before = builtIn.size;
    const descriptor = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
    const def = buildCustomNodeDefinition(descriptor, TRANSFORM_SOURCE);
    const merged = mergeCustomNodeRegistry(builtIn, [def]);
    expect(merged.size).toBe(before + 1);
    expect(builtIn.size).toBe(before); // untouched
    expect(merged.get("custom/doubler")).toBe(def);
  });

  it("rejects a custom type colliding with a built-in one", () => {
    const builtIn = buildRegistry();
    const collidingDescriptor: CustomNodeDescriptor = {
      type: "thingstudio/gpio_out", // can't actually be produced by validateCustomNodeDescriptor (reserved namespace), constructed directly to test the merge guard itself
      kind: "sink",
      label: "evil twin",
      ports: { inputs: [{ name: "signal", type: "bool" }] },
      properties: [],
    };
    const def = buildCustomNodeDefinition(collidingDescriptor, "async def run(msg, properties):\n    pass");
    expect(() => mergeCustomNodeRegistry(builtIn, [def])).toThrow(/collides/);
  });

  it("rejects two custom types colliding with each other", () => {
    const builtIn = buildRegistry();
    const descriptor = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
    const defA = buildCustomNodeDefinition(descriptor, TRANSFORM_SOURCE);
    const defB = buildCustomNodeDefinition(descriptor, TRANSFORM_SOURCE);
    expect(() => mergeCustomNodeRegistry(builtIn, [defA, defB])).toThrow(/collides/);
  });
});

describe("custom node inside a full compile()", () => {
  it("compiles into the flow alongside a built-in source/sink, indistinguishable from a first-party node type", () => {
    const descriptor = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
    const def = buildCustomNodeDefinition(descriptor, TRANSFORM_SOURCE);
    const registry = mergeCustomNodeRegistry(buildRegistry(), [def]);

    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/timer", properties: { intervalMs: 1000 } },
        { id: "2", type: "custom/doubler", properties: { factor: 5 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "number"],
        [2, "2", 0, "3", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    // identifierHint() prefixes the type's own sanitized form with "custom_"
    // unconditionally (custom-node.ts), so a type already starting with
    // "custom/" doubles up here -- "_custom_custom_doubler_setup", not
    // "_custom_doubler_setup". Asserting the real generated name, not a
    // hand-guessed one.
    expect(source).toContain("def _custom_custom_doubler_setup");
    expect(source).toContain("properties['factor']");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("routes a multi-output custom transform's returned list across its outputs", () => {
    const descriptor = validateCustomNodeDescriptor({
      ...TRANSFORM_DESCRIPTOR_RAW,
      type: "custom/splitter",
      ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "a", type: "any" }, { name: "b", type: "any" }] },
    });
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    return [msg, msg]\n");
    const registry = mergeCustomNodeRegistry(buildRegistry(), [def]);

    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/timer", properties: { intervalMs: 1000 } },
        { id: "2", type: "custom/splitter", properties: { factor: 2 } },
        { id: "3", type: "thingstudio/debug", properties: {} },
        { id: "4", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "1", 0, "2", 0, "number"],
        [2, "2", 0, "3", 0, "any"],
        [2, "2", 1, "4", 0, "any"],
      ],
    };
    const { source } = compile(graph, registry);
    // The multi-output contract (compile.ts): the returned value is coerced to a list and each wired
    // output slot indexes into it, using None for a slot the list doesn't reach.
    expect(source).toMatch(/isinstance\([a-z0-9_]+, list\)/);
    expect(source).toContain("else None");
  });
});

describe("evaluatePredicate (the data-driven field conditional)", () => {
  const p = (props: Record<string, unknown>, pred: Parameters<typeof evaluatePredicate>[0]) => evaluatePredicate(pred, props);
  it("covers equals/notEquals/in and the numeric comparisons", () => {
    expect(p({ mode: "relative" }, { field: "mode", equals: "relative" })).toBe(true);
    expect(p({ mode: "absolute" }, { field: "mode", equals: "relative" })).toBe(false);
    expect(p({ mode: "relative" }, { field: "mode", notEquals: "relative" })).toBe(false);
    expect(p({ mode: "scan" }, { field: "mode", in: ["read", "scan"] })).toBe(true);
    expect(p({ steps: 3 }, { field: "steps", gt: 0 })).toBe(true);
    expect(p({ steps: 0 }, { field: "steps", gt: 0 })).toBe(false);
    expect(p({ n: 5 }, { field: "n", lte: 5 })).toBe(true);
    // a missing property compares as undefined, and a non-numeric value fails numeric comparisons
    expect(p({}, { field: "mode", equals: "relative" })).toBe(false);
    expect(p({ steps: "x" }, { field: "steps", gt: 0 })).toBe(false);
    // an empty predicate is always visible
    expect(p({}, { field: "anything" })).toBe(true);
  });
});

describe("pin fields: direction opt-in and named pins", () => {
  const descriptor = (props: object[]) =>
    validateCustomNodeDescriptor({ type: "custom/gpio", kind: "sink", label: "gpio", ports: { inputs: [{ name: "msg", type: "any" }] }, properties: props as never });

  it("a pin field with no pinUse is a plain value: checked, never claimed", () => {
    const def = buildCustomNodeDefinition(descriptor([{ name: "scl", label: "scl", kind: "pin", default: 5 }]), "async def run(msg, properties):\n    pass\n");
    const claims: string[] = [];
    const ctx = freshCtx();
    ctx.claimResource = (resource: string): void => {
      claims.push(resource);
    };
    const result = def.codegenSink!(node(1, { scl: 5 }), ctx);
    expect((result.statements ?? []).map((s) => s.code).join("\n")).toContain('"scl": 5');
    expect(claims).toEqual([]);
  });

  it("accepts a named pin value, inlined as a quoted string", () => {
    const def = buildCustomNodeDefinition(descriptor([{ name: "scl", label: "scl", kind: "pin", default: 5 }]), "async def run(msg, properties):\n    pass\n");
    const result = def.codegenSink!(node(1, { scl: "X1" }), freshCtx());
    expect((result.statements ?? []).map((s) => s.code).join("\n")).toContain('"scl": "X1"');
  });
});

describe("select option values", () => {
  it("inlines a numeric option value as a number (a core descriptor allows it)", () => {
    // A custom .node.json may only use string option values, but a built-in/core descriptor allows numbers
    // (canonical PropertyFieldOption) -- e.g. bme280's I2C address. The generic codegen must handle both.
    const descriptor = {
      type: "custom/addr", kind: "sink", label: "addr",
      ports: { inputs: [{ name: "msg", type: "any" }] },
      properties: [{ name: "addr", label: "addr", kind: "select", default: 118, options: [{ value: 118, label: "0x76" }, { value: 119, label: "0x77" }] }],
    } as unknown as Parameters<typeof buildCustomNodeDefinition>[0];
    const def = buildCustomNodeDefinition(descriptor, "async def run(msg, properties):\n    pass\n");
    const result = def.codegenSink!(node(1, { addr: 118 }), freshCtx());
    expect((result.statements ?? []).map((s) => s.code).join("\n")).toContain('"addr": 118');
  });
});

describe("validateCustomNodeDescriptor: property-dependent port types", () => {
  const DATA_PORT_RAW = {
    type: "custom/typed",
    kind: "source",
    eventSource: true,
    label: "typed",
    ports: {
      outputs: [
        { name: "msg", type: { property: "payloadType", map: { bool: "bool", number: "number" }, default: "bool" } },
      ],
    },
    properties: [
      {
        name: "payloadType",
        label: "payload type",
        kind: "select",
        default: "bool",
        options: [
          { value: "bool", label: "Bool" },
          { value: "number", label: "Number" },
        ],
      },
    ],
  };

  it("accepts the data form and resolves it against the instance's property", () => {
    const d = validateCustomNodeDescriptor(DATA_PORT_RAW);
    const port = d.ports!.outputs![0]!;
    expect(port.type).toEqual({ property: "payloadType", map: { bool: "bool", number: "number" }, default: "bool" });
    expect(resolvePortType(port, { payloadType: "number" })).toBe("number");
    expect(resolvePortType(port, {})).toBe("bool");
  });

  it("rejects a map key the select property does not offer", () => {
    const raw = structuredClone(DATA_PORT_RAW) as any;
    raw.ports.outputs[0]!.type.map = { string: "string" };
    expect(() => validateCustomNodeDescriptor(raw)).toThrow(/does not offer/);
  });

  it("rejects a property the descriptor does not declare", () => {
    const raw = structuredClone(DATA_PORT_RAW);
    raw.ports.outputs[0]!.type.property = "missing";
    expect(() => validateCustomNodeDescriptor(raw)).toThrow(/does not declare/);
  });

  it("rejects a type property that is not a select", () => {
    const raw = structuredClone(DATA_PORT_RAW);
    raw.properties[0]!.kind = "text";
    expect(() => validateCustomNodeDescriptor(raw)).toThrow(/must be a select/);
  });

  it("rejects an unknown payload type in the map or default", () => {
    const badMap = structuredClone(DATA_PORT_RAW) as any;
    badMap.ports.outputs[0]!.type.map = { bool: "text" };
    expect(() => validateCustomNodeDescriptor(badMap)).toThrow(/map\["bool"\]/);
    const badDefault = structuredClone(DATA_PORT_RAW) as any;
    badDefault.ports.outputs[0]!.type.default = "text";
    expect(() => validateCustomNodeDescriptor(badDefault)).toThrow(/default must be one of/);
  });
});

describe("validateCustomNodeDescriptor: runOnce sources", () => {
  const RUN_ONCE_RAW = {
    type: "custom/once",
    kind: "source",
    label: "once",
    runOnce: true,
    ports: { outputs: [{ name: "msg", type: "any" }] },
  };

  it("accepts a source with runOnce and no intervalMs", () => {
    expect(validateCustomNodeDescriptor(RUN_ONCE_RAW).runOnce).toBe(true);
  });

  it("rejects runOnce on a non-source", () => {
    expect(() => validateCustomNodeDescriptor({ ...RUN_ONCE_RAW, kind: "transform", ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] } })).toThrow(/only valid on a "source"/);
  });

  it("rejects runOnce together with eventSource", () => {
    expect(() => validateCustomNodeDescriptor({ ...RUN_ONCE_RAW, eventSource: true })).toThrow(/mutually exclusive/);
  });
});
