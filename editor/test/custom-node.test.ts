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
import type { CodegenContext } from "../src/compiler/node-definition.js";
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

  it("rejects more than one declared output port", () => {
    const bad = { ...TRANSFORM_DESCRIPTOR_RAW, ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "a", type: "any" }, { name: "b", type: "any" }] } };
    expect(() => validateCustomNodeDescriptor(bad)).toThrow(/at most 1/);
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
});

describe("buildCustomNodeDefinition -- transform", () => {
  const descriptor = validateCustomNodeDescriptor(TRANSFORM_DESCRIPTOR_RAW);
  const def = buildCustomNodeDefinition(descriptor, TRANSFORM_SOURCE);

  it("registers the expected type/kind/ports", () => {
    expect(def.type).toBe("custom/doubler");
    expect(def.kind).toBe("transform");
    expect(def.ports?.inputs?.[0]).toEqual({ name: "msg", type: "any" });
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
});
