// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/custom-node.ts
//
// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20) -- the generic half of §7's "two halves" model
// made real for node types nobody wrote TypeScript codegen for. A custom
// node type is a package of two files sharing a base name:
//   - `<name>.node.json` -- the editor descriptor, validated by
//     validateCustomNodeDescriptor() below into a CustomNodeDescriptor.
//     Inert data, never eval'd/executed in the editor process (scoping
//     note, Decision 5's "worth naming the actual alternative this
//     rejects" -- Node-RED's node.html registers a real edit-dialog via
//     literal JS executed in the browser admin UI; this project
//     deliberately doesn't do that).
//   - `<name>.node.py` -- ordinary MicroPython, read as opaque text and
//     spliced (never executed) into the generated flow source at compile
//     time, exactly like the `function` node's own verbatim-user-code
//     inlining (function-node.ts) already does. Must define exactly one
//     top-level function matching the descriptor's `kind`:
//       - "transform"/"sink": `async def run(msg, properties):`
//       - "source":           `async def emit(properties):`
//
// buildCustomNodeDefinition() below is the actual codegen: it wraps one
// instance's `.node.py` text in a uniquely-named closure (so N instances
// of the same custom type never collide on top-level state -- no
// resource-claim dedup the way e.g. gpio-out.ts's shared pin key gets,
// see the scoping note's own named limitation on this) and produces an
// ordinary NodeDefinition (compiler/node-definition.ts) -- indistinguishable
// to compile.ts from a first-party node's registry entry. No compiler
// core changes were needed for this feature at all; that's the point of
// building the contract this way rather than trying to let a custom
// node's `.node.json` describe arbitrary JS codegen (which no browser-
// loaded, non-rebuilt editor could safely execute anyway).
//
// Real gotcha worth stating loudly, not just in docs/custom-nodes.md
// (CLAUDE.md's fault-handling priority: this is exactly the kind of thing
// that should be impossible to miss, not discovered via a confusing
// NameError): a custom node's `.node.py` top-level code does NOT run at
// true Python module scope -- it runs *inside* the generated per-instance
// wrapper function (see buildCustomNodeDefinition below), which is what
// gives two instances of the same type independent state with zero
// resource-dedup risk. That means a node author wanting mutable state
// across calls (a running counter, a cached sensor handle) must declare it
// `nonlocal` inside `run`/`emit`, NOT `global` -- `global` only ever binds
// to real module scope, and there is no module-level name to find, so it
// fails (a NameError, not a silent wrong answer, but still worth avoiding
// entirely by documenting the right pattern up front). This differs from
// how e.g. timer.ts's own first-party codegen uses `global` for its tick
// counter -- that code is inlined directly into the coroutine body at true
// module scope, a different code shape than a custom node's wrapped
// closure.
//
// Output-port cardinality (scoping note, resolved with Mike 2026-08-20):
// at most one declared output port per custom node, enforced by
// validateCustomNodeDescriptor() below, NOT by PortDefinition/ports'
// underlying shape (still a real array, unrestricted) -- a codegen
// restriction (this file only knows how to route one `return` value to
// one output, same ceiling every first-party node already has), not a
// package-format one. Loosens the moment a real multi-output compiler
// contract exists, without needing `.node.json` to change shape.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type {
  CodegenContext,
  NodeDefinition,
  NodeKind,
  PayloadType,
  PortDefinition,
  SinkCodegenResult,
  SourceCodegenResult,
  TransformCodegenResult,
} from "../compiler/node-definition.js";
import { pyStringLiteral } from "./py-literals.js";

const PAYLOAD_TYPES: readonly PayloadType[] = ["int", "number", "bool", "string", "bytes", "any"];
const NODE_KINDS: readonly NodeKind[] = ["source", "transform", "sink"];
const PROPERTY_KINDS = ["text", "number", "boolean", "select"] as const;
type CustomPropertyKind = (typeof PROPERTY_KINDS)[number];

/** Package-loading/shape errors -- distinct from CompileError (per-instance
 * property VALUE problems, raised by the codegen hooks below at actual
 * compile time) because these are caught the moment a package is loaded,
 * before any flow using it is ever compiled. */
export class CustomNodeDescriptorError extends Error {}

export interface CustomNodePort {
  name: string;
  type: PayloadType;
}

export interface CustomNodePropertyOption {
  value: string;
  label: string;
}

export interface CustomNodePropertyField {
  /** Dict key in the generated `properties` argument -- also the key
   * PropertyPanel.vue's generic renderer binds an input to. */
  name: string;
  label: string;
  kind: CustomPropertyKind;
  /** Must match `kind` (number -> number, boolean -> boolean, text/select -> string). */
  default: unknown;
  /** Required, non-empty, when kind is "select"; ignored otherwise. */
  options?: CustomNodePropertyOption[];
}

export interface CustomNodeDescriptor {
  /** e.g. "custom/dht22" -- must NOT start with "thingstudio/" (reserved
   * for first-party node types; see validateCustomNodeDescriptor). */
  type: string;
  kind: NodeKind;
  label: string;
  color?: string;
  bgcolor?: string;
  /** Single-glyph icon, matching palette.ts's own convention for built-in kinds. */
  icon?: string;
  ports?: {
    inputs?: CustomNodePort[];
    outputs?: CustomNodePort[];
  };
  properties?: CustomNodePropertyField[];
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const TYPE_ID_RE = /^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/;

function fail(detail: string): never {
  throw new CustomNodeDescriptorError(`invalid custom node descriptor: ${detail}`);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) fail(`"${key}" must be a non-empty string`);
  return v as string;
}

function validatePort(raw: unknown, where: string): CustomNodePort {
  if (typeof raw !== "object" || raw === null) fail(`${where} must be an object`);
  const rec = raw as Record<string, unknown>;
  const name = requireString(rec, "name");
  if (!IDENTIFIER_RE.test(name)) fail(`${where}.name "${name}" must be a valid identifier (letters/digits/underscore, not starting with a digit)`);
  const type = rec.type;
  if (typeof type !== "string" || !PAYLOAD_TYPES.includes(type as PayloadType)) {
    fail(`${where}.type must be one of ${PAYLOAD_TYPES.join(", ")}, got ${JSON.stringify(type)}`);
  }
  return { name, type: type as PayloadType };
}

function validatePropertyField(raw: unknown, where: string): CustomNodePropertyField {
  if (typeof raw !== "object" || raw === null) fail(`${where} must be an object`);
  const rec = raw as Record<string, unknown>;
  const name = requireString(rec, "name");
  if (!IDENTIFIER_RE.test(name)) fail(`${where}.name "${name}" must be a valid identifier (letters/digits/underscore, not starting with a digit)`);
  const label = requireString(rec, "label");
  const kind = rec.kind;
  if (typeof kind !== "string" || !PROPERTY_KINDS.includes(kind as CustomPropertyKind)) {
    fail(`${where}.kind must be one of ${PROPERTY_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  }
  const field: CustomNodePropertyField = { name, label, kind: kind as CustomPropertyKind, default: rec.default };
  if (kind === "select") {
    if (!Array.isArray(rec.options) || rec.options.length === 0) {
      fail(`${where}.options must be a non-empty array when kind is "select"`);
    }
    field.options = rec.options.map((o, i) => {
      if (typeof o !== "object" || o === null) fail(`${where}.options[${i}] must be an object`);
      const orec = o as Record<string, unknown>;
      return { value: requireString(orec, "value"), label: requireString(orec, "label") };
    });
  }
  // default's shape must already match kind -- a mismatched default would
  // otherwise only surface the first time some node instance's property
  // panel field gets left untouched, at compile time, far from the actual
  // mistake (CLAUDE.md's fault-handling priority: fail at the boundary,
  // not downstream).
  if (kind === "number" && typeof field.default !== "number") fail(`${where}.default must be a number when kind is "number"`);
  if (kind === "boolean" && typeof field.default !== "boolean") fail(`${where}.default must be a boolean when kind is "boolean"`);
  if ((kind === "text" || kind === "select") && typeof field.default !== "string") fail(`${where}.default must be a string when kind is "${kind}"`);
  if (kind === "select" && !field.options!.some((o) => o.value === field.default)) {
    fail(`${where}.default "${String(field.default)}" is not one of the declared options`);
  }
  return field;
}

/**
 * Parses and validates one `.node.json` descriptor's raw parsed JSON.
 * Strict, matching flow-file.ts's parseFlowFile() style: a malformed or
 * hand-edited-wrong package should fail loudly and specifically, not load
 * partially or silently coerce. Enforces the two structural rules the
 * scoping note calls out explicitly: the `thingstudio/` namespace is
 * reserved for first-party node types, and at most one output port is
 * accepted for now (a codegen ceiling, see this file's header).
 */
export function validateCustomNodeDescriptor(raw: unknown): CustomNodeDescriptor {
  if (typeof raw !== "object" || raw === null) fail("must be a JSON object");
  const obj = raw as Record<string, unknown>;

  const type = requireString(obj, "type");
  if (type.startsWith("thingstudio/")) fail(`type "${type}" starts with the reserved "thingstudio/" namespace -- pick your own namespace prefix`);
  if (!TYPE_ID_RE.test(type)) fail(`type "${type}" must look like "namespace/name" (lowercase letters, digits, underscores)`);

  const kind = obj.kind;
  if (typeof kind !== "string" || !NODE_KINDS.includes(kind as NodeKind)) {
    fail(`kind must be one of ${NODE_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  }

  const label = requireString(obj, "label");

  const portsRaw = (obj.ports ?? {}) as Record<string, unknown>;
  if (typeof portsRaw !== "object" || portsRaw === null) fail('"ports" must be an object');
  const inputsRaw = portsRaw.inputs ?? [];
  const outputsRaw = portsRaw.outputs ?? [];
  if (!Array.isArray(inputsRaw)) fail('"ports.inputs" must be an array');
  if (!Array.isArray(outputsRaw)) fail('"ports.outputs" must be an array');
  const inputs = inputsRaw.map((p, i) => validatePort(p, `ports.inputs[${i}]`));
  const outputs = outputsRaw.map((p, i) => validatePort(p, `ports.outputs[${i}]`));

  if (outputs.length > 1) fail(`"ports.outputs" has ${outputs.length} entries -- at most 1 is supported for now (see custom-node.ts header)`);
  const expectedInputs = kind === "source" ? 0 : 1;
  const expectedOutputs = kind === "sink" ? 0 : 1;
  if (inputs.length !== expectedInputs) {
    fail(`kind "${kind}" must declare exactly ${expectedInputs} input port${expectedInputs === 1 ? "" : "s"}, got ${inputs.length}`);
  }
  if (outputs.length !== expectedOutputs) {
    fail(`kind "${kind}" must declare exactly ${expectedOutputs} output port${expectedOutputs === 1 ? "" : "s"}, got ${outputs.length}`);
  }

  const propertiesRaw = obj.properties ?? [];
  if (!Array.isArray(propertiesRaw)) fail('"properties" must be an array');
  const properties = propertiesRaw.map((p, i) => validatePropertyField(p, `properties[${i}]`));
  const names = new Set<string>();
  for (const p of properties) {
    if (names.has(p.name)) fail(`duplicate property name "${p.name}"`);
    names.add(p.name);
  }

  // Source nodes drive their own poll loop via a declared numeric
  // `intervalMs` property (scoping note, Decision 3) -- there's no other
  // way for the generic codegen below to know how often to call `emit()`,
  // since event-driven custom sources aren't supported (same note).
  if (kind === "source") {
    const interval = properties.find((p) => p.name === "intervalMs");
    if (!interval || interval.kind !== "number") {
      fail('a "source" custom node must declare a "properties" entry named "intervalMs" with kind "number" (drives the poll interval; see docs/custom-nodes.md)');
    }
  }

  const descriptor: CustomNodeDescriptor = { type, kind: kind as NodeKind, label, ports: { inputs, outputs }, properties };
  if (typeof obj.color === "string") descriptor.color = obj.color;
  if (typeof obj.bgcolor === "string") descriptor.bgcolor = obj.bgcolor;
  if (typeof obj.icon === "string") descriptor.icon = obj.icon;
  return descriptor;
}

/** Turns a `namespace/name` type id into a Python-identifier-safe hint for
 * ctx.uniqueName() -- that helper prepends "_" and dedups but does not
 * itself sanitize its `hint` argument, so a raw "/" would produce an
 * invalid Python identifier in generated source. */
function identifierHint(type: string): string {
  return "custom_" + type.replace(/[^a-zA-Z0-9_]/g, "_");
}

function pyBoolLiteral(value: unknown, contextLabel: string): string {
  if (typeof value !== "boolean") throw new CompileError(`${contextLabel} must be a boolean, got ${JSON.stringify(value)}`);
  return value ? "True" : "False";
}

function pyNumberLiteral(value: unknown, contextLabel: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new CompileError(`${contextLabel} must be a finite number, got ${JSON.stringify(value)}`);
  return String(n);
}

/**
 * Resolves one node instance's raw properties (node.properties, from the
 * graph) against its descriptor's property schema -- missing keys fall
 * back to the field's declared default, present values are validated and
 * coerced per field.kind -- and renders the result as a Python dict
 * literal, in declared-field order (deterministic, matches this project's
 * general "same input -> byte-identical output" bias, e.g. flow-file.ts's
 * sorted serialization). Unknown keys on the instance's raw properties
 * (present but not declared in the schema) are ignored, not rejected --
 * forward-compatible with a `.node.json` that grows a new field after a
 * flow file was last saved with the old one.
 */
function pyPropertiesLiteral(descriptor: CustomNodeDescriptor, rawProperties: Record<string, unknown>, contextLabel: string): string {
  const fields = descriptor.properties ?? [];
  const entries = fields.map((f) => {
    const raw = f.name in rawProperties ? rawProperties[f.name] : f.default;
    const fieldLabel = `${contextLabel} property "${f.name}"`;
    let literal: string;
    switch (f.kind) {
      case "number":
        literal = pyNumberLiteral(raw, fieldLabel);
        break;
      case "boolean":
        literal = pyBoolLiteral(raw, fieldLabel);
        break;
      case "select":
        if (typeof raw !== "string" || !f.options!.some((o) => o.value === raw)) {
          throw new CompileError(`${fieldLabel} value ${JSON.stringify(raw)} is not one of the declared options`);
        }
        literal = pyStringLiteral(raw);
        break;
      case "text":
      default:
        literal = pyStringLiteral(String(raw));
        break;
    }
    return `${pyStringLiteral(f.name)}: ${literal}`;
  });
  return `{${entries.join(", ")}}`;
}

/** The number this custom source's poll loop sleeps between calls to
 * `emit()` -- see the "intervalMs" requirement in
 * validateCustomNodeDescriptor(). Read directly from the raw node
 * properties (not the Python literal above) since compile.ts's
 * SourceCodegenResult.repeatMs is a JS number, not generated code. */
function resolveIntervalMs(descriptor: CustomNodeDescriptor, rawProperties: Record<string, unknown>, contextLabel: string): number {
  const field = descriptor.properties!.find((p) => p.name === "intervalMs")!;
  const raw = "intervalMs" in rawProperties ? rawProperties.intervalMs : field.default;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CompileError(`${contextLabel} "intervalMs" must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function toPortDefinitions(ports: CustomNodePort[] | undefined): PortDefinition[] | undefined {
  return ports?.map((p) => ({ name: p.name, type: p.type }));
}

/**
 * Wraps `pythonSource` (one custom node type's `.node.py`, unmodified user
 * text -- never parsed or executed by this file, only spliced) in a
 * per-instance closure and produces an ordinary NodeDefinition, matching
 * the file header's contract. `entryPointName` is "emit" for source,
 * "run" for transform/sink -- the one top-level name `pythonSource` must
 * define; a typo or the wrong kind's function name surfaces as a NameError
 * at deploy time (the device raises it importing the generated flow, when
 * this node's setup code actually runs), not caught statically here --
 * this file has no Python parser. See docs/custom-nodes.md's own "if
 * something goes wrong" section for how that shows up and how to read it.
 */
export function buildCustomNodeDefinition(descriptor: CustomNodeDescriptor, pythonSource: string): NodeDefinition {
  const entryPointName = descriptor.kind === "source" ? "emit" : "run";
  const hint = identifierHint(descriptor.type);

  function emitSetup(node: GraphNode, ctx: CodegenContext): { entryVar: string; propsVar: string; statements: { key: string; code: string }[] } {
    const propsVar = ctx.uniqueName(`${hint}_props`);
    const setupFn = ctx.uniqueName(`${hint}_setup`);
    const entryVar = ctx.uniqueName(`${hint}_${entryPointName}`);
    const propsLiteral = pyPropertiesLiteral(descriptor, node.properties, `node ${node.id} (${descriptor.type})`);
    const indented = pythonSource
      .split("\n")
      .map((line) => (line.length ? "    " + line : line))
      .join("\n");
    const code = [`def ${setupFn}(properties):`, indented, `    return ${entryPointName}`, `${propsVar} = ${propsLiteral}`, `${entryVar} = ${setupFn}(${propsVar})`].join(
      "\n",
    );
    return { entryVar, propsVar, statements: [{ key: entryVar, code }] };
  }

  const def: NodeDefinition = {
    type: descriptor.type,
    kind: descriptor.kind,
    ports: { inputs: toPortDefinitions(descriptor.ports?.inputs), outputs: toPortDefinitions(descriptor.ports?.outputs) },
  };

  if (descriptor.kind === "source") {
    def.codegenSource = (node: GraphNode, ctx: CodegenContext): SourceCodegenResult => {
      const { entryVar, propsVar, statements } = emitSetup(node, ctx);
      const repeatMs = resolveIntervalMs(descriptor, node.properties, `node ${node.id} (${descriptor.type})`);
      return { statements, buildMsg: `msg = await ${entryVar}(${propsVar})`, repeatMs };
    };
  } else if (descriptor.kind === "transform") {
    def.codegenTransform = (node: GraphNode, ctx: CodegenContext): TransformCodegenResult => {
      const { entryVar, propsVar, statements } = emitSetup(node, ctx);
      return { statements, functionName: ctx.uniqueName(`${hint}_call`), functionBody: `return await ${entryVar}(msg, ${propsVar})` };
    };
  } else {
    def.codegenSink = (node: GraphNode, ctx: CodegenContext): SinkCodegenResult => {
      const { entryVar, propsVar, statements } = emitSetup(node, ctx);
      return { statements, functionName: ctx.uniqueName(`${hint}_call`), functionBody: `await ${entryVar}(msg, ${propsVar})` };
    };
  }

  return def;
}

/**
 * Merges loaded custom node definitions on top of the built-in registry
 * (registry.ts's buildRegistry()) for one compile -- returns a fresh Map,
 * never mutates `builtIn`. Throws on any type-id collision (against a
 * built-in type, or against another custom definition already merged in
 * this same call) rather than letting the later one silently win --
 * CLAUDE.md's fault-handling priority, same reasoning compile.ts's own
 * duplicate-node-id and duplicate-config-id checks already apply.
 * validateCustomNodeDescriptor()'s reserved-namespace check already rules
 * out colliding with a built-in type by construction, but two loaded
 * custom packages independently choosing the same type id is a real,
 * reachable case this still needs to catch.
 */
export function mergeCustomNodeRegistry(builtIn: Map<string, NodeDefinition>, custom: NodeDefinition[]): Map<string, NodeDefinition> {
  const merged = new Map(builtIn);
  for (const def of custom) {
    if (merged.has(def.type)) {
      throw new CustomNodeDescriptorError(`custom node type "${def.type}" collides with an already-registered node type -- pick a different type id`);
    }
    merged.set(def.type, def);
  }
  return merged;
}
