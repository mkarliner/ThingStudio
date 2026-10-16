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
// Output-port cardinality: a custom `transform` may declare more than one
// output port (2026-10-15, format-parity work) -- compile.ts's multi-output
// routing (node-definition.ts's TransformCodegenResult doc) already routes
// a returned list across N outputs, so this is now a package-format
// capability, not a codegen ceiling. A `source` still declares exactly one
// output and a `sink` none (the compiler has no multi-output-source
// contract). validateCustomNodeDescriptor() below enforces it.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type {
  CodegenContext,
  EventSourceCodegenResult,
  FieldPredicate,
  NodeDefinition,
  NodeDescriptor,
  NodeKind,
  PayloadType,
  PortDefinition,
  PropertyFieldDescriptor,
  SinkCodegenResult,
  SourceCodegenResult,
  TransformCodegenResult,
} from "../compiler/node-definition.js";
import { pyStringLiteral } from "./py-literals.js";
import { checkOptionalPin, checkPin } from "../definitions/pin-check.js";
import { pinLabel } from "../definitions/definitions.js";
import { claimResource, pullText, pyPinLiteral } from "./hardware-shared.js";

// Exported (2026-10-14) so editor/test/node-descriptor-schema.test.ts can
// assert the published schema in interfaces/node-descriptor/ lists the same
// values -- the format users write .node.json against must not drift from
// this validator.
export const PAYLOAD_TYPES: readonly PayloadType[] = ["int", "number", "bool", "string", "bytes", "any"];
export const NODE_KINDS: readonly NodeKind[] = ["source", "transform", "sink"];
export const PROPERTY_KINDS = ["text", "textarea", "number", "boolean", "select", "configRef", "pin", "target", "nodeId"] as const;
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
  /** Must match `kind` (number/pin -> number, boolean -> boolean, text/textarea/select/configRef -> string). */
  default: unknown;
  /** Required, non-empty, when kind is "select"; ignored otherwise. */
  options?: CustomNodePropertyOption[];
  /** Required when kind is "configRef": the config type the picker offers (e.g.
   * "thingstudio/config/i2c-bus"). At compile time the picked config's own properties are resolved and
   * passed to the node's Python as a dict (see pyPropertiesLiteral); an empty id passes None. */
  configType?: string;
  /** On a `configRef` field: resolve the flow's single config of `configType` at compile time instead of
   * the stored id (the singleton WiFi/I2C-bus route a built-in uses). Zero or many is a compile error; the
   * stored value is ignored. Added 2026-10-15 (context parity, phase 2a). */
  singleton?: boolean;
  /** On a `pin` field: "input" (default) or "output" -- checked against the board and claimed as a
   * resource at compile time. Added 2026-10-15 (context parity, phase 2a). */
  pinUse?: "input" | "output";
  /** On an input `pin` field: "none" (default), "up" or "down" -- the pull the node configures, for the
   * resource claim's text and the no-pull warning. Added 2026-10-15 (context parity, phase 2a). */
  pinPull?: "none" | "up" | "down";
  // -- optional field attributes (the generic panel renders each where it applies), matching the canonical
  // PropertyFieldDescriptor so a custom node can express what a built-in's panel does --
  /** Short plain-text note rendered under the field. */
  help?: string;
  /** Hint text shown in an empty text/number input. */
  placeholder?: string;
  /** Rows for a `textarea` field (default 4 when absent). Added 2026-10-15 (parity with the function
   * node's code editor). */
  rows?: number;
  /** Number-field bounds/step, forwarded to the <input type="number">; `step` may be "any". */
  min?: number;
  max?: number;
  step?: number | "any";
  /** A pin field where -1/blank means "not wired". */
  optional?: boolean;
  /** Show this field only when this predicate holds (e.g. a field only in one mode). Serializable data,
   * matching PropertyFieldDescriptor's `visibleWhen`. Added 2026-10-15 (parity). */
  visibleWhen?: FieldPredicate;
}

export interface CustomNodeDescriptor {
  /** e.g. "custom/dht22" -- must NOT start with "thingstudio/" (reserved
   * for first-party node types; see validateCustomNodeDescriptor). */
  type: string;
  kind: NodeKind;
  label: string;
  /** Canvas title, when it differs from the palette `label`. Defaults to `label`. */
  title?: string;
  /** Hide from the palette (still usable in a flow file). */
  hidden?: boolean;
  /** Preset type: when set, the panel shows a save/load-preset control (see PropertyPanel.vue). */
  presetType?: string;
  /** Show the ScreenOutline widget in the panel (a gui_screen's widget layout). */
  screenOutline?: boolean;
  /** Short self-documenting blurb shown in the editor (PropertyPanel.vue's generic branch), like a
   * built-in descriptor's `description`. Added 2026-10-15 (format parity). */
  description?: string;
  color?: string;
  bgcolor?: string;
  /** Single-glyph icon, matching palette.ts's own convention for built-in kinds. */
  icon?: string;
  /** Palette section (PaletteSidebar.vue) this node sorts into -- any
   * non-empty string, not restricted to palette.ts's DEFAULT_NODE_GROUPS.
   * Omitted -> "general" (defaulted where the palette renders custom
   * rows, not here -- see this field's own validation below). */
  group?: string;
  /** Display order within `group`, lower first -- palette.ts's
   * KindStyle.priority (built-in nodes) shares this same field name/
   * meaning. Added 2026-09-13 (outstanding-items/palette-node-family-
   * ordering.md). Omitted -> sorts after every built-in entry (defaulted
   * where the palette renders custom rows, not here -- same pattern as
   * `group` above). */
  priority?: number;
  ports?: {
    inputs?: CustomNodePort[];
    outputs?: CustomNodePort[];
  };
  properties?: CustomNodePropertyField[];
  /** Hardware this node needs (e.g. `{capabilities: ["pio"]}`); checked centrally against the target
   * (definitions/capability-check.ts), same as a built-in node's `requires`. */
  requires?: { capabilities?: string[] };
  /** A `source` that waits on an external event rather than polling: its `.node.py` must also define
   * `async def wait(properties)` (awaited each loop iteration), then the usual `async def emit(properties)`
   * builds the message. No `intervalMs` needed. Added 2026-10-15 (format parity). */
  eventSource?: boolean;
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const TYPE_ID_RE = /^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/;

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

function validatePredicate(raw: unknown, where: string): FieldPredicate {
  if (typeof raw !== "object" || raw === null) fail(`${where} must be an object`);
  const rec = raw as Record<string, unknown>;
  const field = requireString(rec, "field");
  const ops = ["equals", "notEquals", "in", "gt", "gte", "lt", "lte"] as const;
  const present = ops.filter((op) => rec[op] !== undefined);
  if (present.length !== 1) fail(`${where} must have exactly one of ${ops.join(", ")}`);
  const op = present[0]!;
  const value = rec[op];
  if (op === "in") {
    if (!Array.isArray(value) || value.length === 0 || value.some((v) => !["string", "number", "boolean"].includes(typeof v))) {
      fail(`${where}.in must be a non-empty array of strings, numbers or booleans`);
    }
    return { field, in: value as (string | number | boolean)[] };
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(`${where}.${op} must be a finite number`);
    return { field, [op]: value } as FieldPredicate;
  }
  if (!["string", "number", "boolean"].includes(typeof value)) fail(`${where}.${op} must be a string, number or boolean`);
  return { field, [op]: value } as FieldPredicate;
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
  if (kind === "configRef") {
    const configType = rec.configType;
    if (typeof configType !== "string" || configType.length === 0) {
      fail(`${where}.configType must be a non-empty string when kind is "configRef"`);
    }
    field.configType = configType;
  }
  // -- singletons, pin direction/pull (context parity, phase 2a) --
  if (rec.singleton !== undefined) {
    if (kind !== "configRef") fail(`${where}.singleton is only valid on a "configRef" field`);
    if (typeof rec.singleton !== "boolean") fail(`${where}.singleton must be a boolean when present`);
    field.singleton = rec.singleton;
  }
  if (rec.pinUse !== undefined) {
    if (kind !== "pin") fail(`${where}.pinUse is only valid on a "pin" field`);
    if (rec.pinUse !== "input" && rec.pinUse !== "output") fail(`${where}.pinUse must be "input" or "output"`);
    field.pinUse = rec.pinUse;
  }
  if (rec.pinPull !== undefined) {
    if (kind !== "pin") fail(`${where}.pinPull is only valid on a "pin" field`);
    if (rec.pinPull !== "none" && rec.pinPull !== "up" && rec.pinPull !== "down") fail(`${where}.pinPull must be "none", "up" or "down"`);
    field.pinPull = rec.pinPull;
  }
  // -- optional attributes (any kind; validated only when present), matching PropertyFieldDescriptor --
  if (rec.help !== undefined) {
    if (typeof rec.help !== "string" || rec.help.length === 0) fail(`${where}.help must be a non-empty string when present`);
    field.help = rec.help;
  }
  if (rec.placeholder !== undefined) {
    if (typeof rec.placeholder !== "string" || rec.placeholder.length === 0) fail(`${where}.placeholder must be a non-empty string when present`);
    field.placeholder = rec.placeholder;
  }
  if (rec.rows !== undefined) {
    if (typeof rec.rows !== "number" || !Number.isInteger(rec.rows) || rec.rows < 1) fail(`${where}.rows must be a positive whole number when present`);
    field.rows = rec.rows;
  }
  if (rec.min !== undefined) {
    if (typeof rec.min !== "number" || !Number.isFinite(rec.min)) fail(`${where}.min must be a finite number when present`);
    field.min = rec.min;
  }
  if (rec.max !== undefined) {
    if (typeof rec.max !== "number" || !Number.isFinite(rec.max)) fail(`${where}.max must be a finite number when present`);
    field.max = rec.max;
  }
  if (rec.step !== undefined) {
    if (rec.step !== "any" && (typeof rec.step !== "number" || !Number.isFinite(rec.step))) fail(`${where}.step must be a finite number or "any" when present`);
    field.step = rec.step as number | "any";
  }
  if (rec.optional !== undefined) {
    if (typeof rec.optional !== "boolean") fail(`${where}.optional must be a boolean when present`);
    field.optional = rec.optional;
  }
  if (rec.visibleWhen !== undefined) {
    field.visibleWhen = validatePredicate(rec.visibleWhen, `${where}.visibleWhen`);
  }
  // default's shape must already match kind -- a mismatched default would
  // otherwise only surface the first time some node instance's property
  // panel field gets left untouched, at compile time, far from the actual
  // mistake (CLAUDE.md's fault-handling priority: fail at the boundary,
  // not downstream).
  if ((kind === "number" || kind === "pin") && typeof field.default !== "number") fail(`${where}.default must be a number when kind is "${kind}"`);
  if (kind === "boolean" && typeof field.default !== "boolean") fail(`${where}.default must be a boolean when kind is "boolean"`);
  if ((kind === "text" || kind === "textarea" || kind === "select" || kind === "configRef" || kind === "target" || kind === "nodeId") && typeof field.default !== "string") fail(`${where}.default must be a string when kind is "${kind}"`);
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
  if (obj.description !== undefined && (typeof obj.description !== "string" || obj.description.length === 0)) {
    fail('"description" must be a non-empty string when present');
  }
  for (const k of ["title", "presetType"] as const) {
    if (obj[k] !== undefined && (typeof obj[k] !== "string" || obj[k].length === 0)) fail(`"${k}" must be a non-empty string when present`);
  }
  for (const k of ["hidden", "screenOutline"] as const) {
    if (obj[k] !== undefined && typeof obj[k] !== "boolean") fail(`"${k}" must be a boolean when present`);
  }

  const portsRaw = (obj.ports ?? {}) as Record<string, unknown>;
  if (typeof portsRaw !== "object" || portsRaw === null) fail('"ports" must be an object');
  const inputsRaw = portsRaw.inputs ?? [];
  const outputsRaw = portsRaw.outputs ?? [];
  if (!Array.isArray(inputsRaw)) fail('"ports.inputs" must be an array');
  if (!Array.isArray(outputsRaw)) fail('"ports.outputs" must be an array');
  const inputs = inputsRaw.map((p, i) => validatePort(p, `ports.inputs[${i}]`));
  const outputs = outputsRaw.map((p, i) => validatePort(p, `ports.outputs[${i}]`));

  const expectedInputs = kind === "source" ? 0 : 1;
  if (inputs.length !== expectedInputs) {
    fail(`kind "${kind}" must declare exactly ${expectedInputs} input port${expectedInputs === 1 ? "" : "s"}, got ${inputs.length}`);
  }
  // A transform may declare several outputs (return a list to route across them, Node-RED style); a
  // source and a sink are fixed (there is no multi-output-source contract in the compiler).
  if (kind === "source" && outputs.length !== 1) {
    fail(`kind "source" must declare exactly 1 output port, got ${outputs.length}`);
  }
  if (kind === "sink" && outputs.length !== 0) {
    fail(`kind "sink" must declare exactly 0 output ports, got ${outputs.length}`);
  }
  if (kind === "transform" && outputs.length < 1) {
    fail(`kind "transform" must declare at least 1 output port, got ${outputs.length}`);
  }

  const propertiesRaw = obj.properties ?? [];
  if (!Array.isArray(propertiesRaw)) fail('"properties" must be an array');
  const properties = propertiesRaw.map((p, i) => validatePropertyField(p, `properties[${i}]`));
  const names = new Set<string>();
  for (const p of properties) {
    if (names.has(p.name)) fail(`duplicate property name "${p.name}"`);
    names.add(p.name);
  }

  const isEventSource = obj.eventSource === true;
  if (obj.eventSource !== undefined && typeof obj.eventSource !== "boolean") {
    fail('"eventSource" must be a boolean when present');
  }
  if (isEventSource && kind !== "source") fail('"eventSource" is only valid on a "source" node');

  // A polled source drives its own loop via a declared numeric `intervalMs` property (scoping note,
  // Decision 3). An event source (2026-10-15) waits on `wait(properties)` instead, so it needs no
  // interval.
  if (kind === "source" && !isEventSource) {
    const interval = properties.find((p) => p.name === "intervalMs");
    if (!interval || interval.kind !== "number") {
      fail('a "source" custom node must declare a "properties" entry named "intervalMs" with kind "number" (drives the poll interval; see docs/custom-nodes.md) -- or set "eventSource": true and define wait()');
    }
  }

  const descriptor: CustomNodeDescriptor = { type, kind: kind as NodeKind, label, ports: { inputs, outputs }, properties };
  if (isEventSource) descriptor.eventSource = true;
  if (obj.description !== undefined) descriptor.description = obj.description as string;
  if (obj.title !== undefined) descriptor.title = obj.title as string;
  if (obj.hidden !== undefined) descriptor.hidden = obj.hidden as boolean;
  if (obj.presetType !== undefined) descriptor.presetType = obj.presetType as string;
  if (obj.screenOutline !== undefined) descriptor.screenOutline = obj.screenOutline as boolean;
  if (typeof obj.color === "string") descriptor.color = obj.color;
  if (typeof obj.bgcolor === "string") descriptor.bgcolor = obj.bgcolor;
  if (typeof obj.icon === "string") descriptor.icon = obj.icon;
  if (obj.requires !== undefined) {
    if (typeof obj.requires !== "object" || obj.requires === null) fail('"requires" must be an object like {"capabilities": ["pio"]}');
    const req = obj.requires as Record<string, unknown>;
    for (const key of Object.keys(req)) if (key !== "capabilities") fail(`"requires.${key}" is not recognised (only "capabilities")`);
    if (req.capabilities !== undefined) {
      if (!Array.isArray(req.capabilities) || req.capabilities.some((c) => typeof c !== "string" || c.trim() === "")) {
        fail('"requires.capabilities" must be a list of non-empty strings');
      }
      descriptor.requires = { capabilities: req.capabilities as string[] };
    } else {
      descriptor.requires = {};
    }
  }
  if (obj.group !== undefined) {
    if (typeof obj.group !== "string" || obj.group.length === 0) fail('"group" must be a non-empty string when present');
    descriptor.group = obj.group;
  }
  if (obj.priority !== undefined) {
    if (typeof obj.priority !== "number" || !Number.isFinite(obj.priority)) fail('"priority" must be a finite number when present');
    descriptor.priority = obj.priority;
  }
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

/** Renders an arbitrary config property value as a Python literal (str/int/float/bool/None/list/dict).
 * Used to inline a resolved config's properties for a custom node's `configRef` field. */
function pyValueLiteral(value: unknown, contextLabel: string): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CompileError(`${contextLabel} is not a finite number: ${JSON.stringify(value)}`);
    return String(value);
  }
  if (typeof value === "string") return pyStringLiteral(value);
  if (Array.isArray(value)) return `[${value.map((v) => pyValueLiteral(v, contextLabel)).join(", ")}]`;
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const entries = Object.keys(rec)
      .sort()
      .map((k) => `${pyStringLiteral(k)}: ${pyValueLiteral(rec[k], `${contextLabel}[${k}]`)}`);
    return `{${entries.join(", ")}}`;
  }
  throw new CompileError(`${contextLabel} has a value this cannot render: ${JSON.stringify(value)}`);
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
 *
 * A `configRef` field's value is a config id; `ctx.resolveConfig` is called
 * to inline the referenced config's own properties as a nested dict (an
 * empty id becomes None). This is the same compile-time resolution a
 * built-in config-referencing node does -- the custom node's Python gets the
 * bus/pins/etc. it needs to `runtime.shared(...)`.
 */
function pyPropertiesLiteral(descriptor: { properties?: PropertyFieldDescriptor[] }, node: GraphNode, rawProperties: Record<string, unknown>, contextLabel: string, ctx: CodegenContext): string {
  const fields = (descriptor.properties ?? []).filter((f): f is PropertyFieldDescriptor & { name: string } => f.name !== undefined);
  const entries = fields.map((f) => {
    const raw = f.name in rawProperties ? rawProperties[f.name] : f.default;
    const fieldLabel = `${contextLabel} property "${f.name}"`;
    let literal: string;
    switch (f.kind) {
      case "number":
        literal = pyNumberLiteral(raw, fieldLabel);
        break;
      case "pin":
        literal = pinFieldLiteral(node, f, raw, fieldLabel, ctx);
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
      case "configRef": {
        if (f.singleton) {
          literal = singletonConfigLiteral(f, fieldLabel, ctx);
        } else {
          const id = raw === undefined || raw === null ? "" : String(raw);
          literal = id === "" ? "None" : pyValueLiteral(ctx.resolveConfig(id), fieldLabel);
        }
        break;
      }
      case "target":
        literal = targetLiteral(ctx);
        break;
      case "nodeId":
        // The instance's own id, so a package can call runtime.report_status(properties[...]) and otherwise
        // speak about itself. Added 2026-10-15 (context parity; NODE_STATUS was the gap).
        literal = pyStringLiteral(node.id);
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

/** A `pin` field's Python literal: checked against the target board and claimed as a hardware resource
 * (context parity, phase 2a), then rendered as a bare number or a quoted named pin. An `optional` pin
 * that is blank/-1 becomes None. */
function pinFieldLiteral(node: GraphNode, f: PropertyFieldDescriptor, raw: unknown, fieldLabel: string, ctx: CodegenContext): string {
  const use = f.pinUse ?? "input";
  const pull = f.pinPull ?? "none";
  const pin = f.optional ? checkOptionalPin(ctx, fieldLabel, raw, use) : checkPin(ctx, fieldLabel, raw, use, { pull: use === "input" && pull !== "none" });
  if (pin === null) return "None";
  // Same use text a built-in's sharedPin/sharedAdc claims, so a custom and a built-in node on the same
  // pin with the same mode share it, and a genuinely different mode conflicts (hardware-shared.ts).
  claimResource(ctx, pinLabel(pin), use === "output" ? "output" : `input, ${pullText(pull)}`, node);
  return pyPinLiteral(pin);
}

/** A singleton `configRef` field's Python literal: the flow's one config of `configType`, resolved at
 * compile time (context parity, phase 2a). Zero or many is a CompileError naming the node and field. */
function singletonConfigLiteral(f: PropertyFieldDescriptor, fieldLabel: string, ctx: CodegenContext): string {
  const configType = f.configType!;
  const finder = ctx.findConfigsOfType;
  if (!finder) {
    throw new CompileError(`${fieldLabel}: this compiler context can't look up the flow's config (findConfigsOfType missing) -- internal error, not a flow-authoring mistake`);
  }
  const found = finder(configType);
  if (found.length === 0) throw new CompileError(`${fieldLabel}: needs a "${configType}" config -- add one to the flow`);
  if (found.length > 1) throw new CompileError(`${fieldLabel}: the flow has ${found.length} "${configType}" configs, but a singleton reference needs exactly one -- reopen the flow to merge them`);
  return pyValueLiteral(found[0]!.properties, fieldLabel);
}

/** A `target` field's Python literal: the board/processor this flow is compiled for, as a dict the node's
 * Python can branch on -- `None` when no board is known (a flow checked with no board picked), so a
 * board-specific package must guard for it (context parity, workstream e). */
function targetLiteral(ctx: CodegenContext): string {
  const t = ctx.target;
  if (!t) return "None";
  const entries = [
    `"boardId": ${t.board ? pyStringLiteral(t.board.id) : "None"}`,
    `"boardName": ${t.board ? pyStringLiteral(t.board.name) : "None"}`,
    `"processorId": ${pyStringLiteral(t.processor.id)}`,
    `"processorName": ${pyStringLiteral(t.processor.name)}`,
    `"label": ${pyStringLiteral(t.label)}`,
    `"capabilities": [${[...t.capabilities].sort().map(pyStringLiteral).join(", ")}]`,
  ];
  return `{${entries.join(", ")}}`;
}

/** The number this custom source's poll loop sleeps between calls to
 * `emit()` -- see the "intervalMs" requirement in
 * validateCustomNodeDescriptor(). Read directly from the raw node
 * properties (not the Python literal above) since compile.ts's
 * SourceCodegenResult.repeatMs is a JS number, not generated code. */
function resolveIntervalMs(descriptor: { properties?: PropertyFieldDescriptor[] }, rawProperties: Record<string, unknown>, contextLabel: string): number {
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

/** The descriptor shape the shared package-codegen wrapper needs. A custom `.node.json` descriptor and a
 * built-in `NodeDescriptor` both satisfy it (a custom one only narrows the field kinds). */
type PackageDescriptor = {
  type: string;
  kind: NodeKind;
  properties?: PropertyFieldDescriptor[];
  eventSource?: boolean;
};

/**
 * The codegen hooks shared by every package: a custom `.node.py` (buildCustomNodeDefinition) and a built-in's
 * generated core package (buildCoreNodeDefinition). Wraps `pythonSource` (unmodified text -- never parsed or
 * executed by this file, only spliced) in a per-instance closure and returns the hook for the descriptor's kind.
 * `entryPointName` is "emit" for source, "run" for transform/sink -- the one top-level name `pythonSource` must
 * define; a typo or the wrong kind's function name surfaces as a NameError at deploy time, not caught statically
 * here (no Python parser). See docs/user-guide/custom-nodes.md's "if something goes wrong" section.
 */
function packageCodegen(descriptor: PackageDescriptor, pythonSource: string): Pick<NodeDefinition, "codegenSource" | "codegenEventSource" | "codegenTransform" | "codegenSink"> {
  const entryPointName = descriptor.kind === "source" ? "emit" : "run";
  const hint = identifierHint(descriptor.type);

  function emitSetup(
    node: GraphNode,
    ctx: CodegenContext,
    entries: string[],
  ): { vars: string[]; propsVar: string; statements: { key: string; code: string }[] } {
    const propsVar = ctx.uniqueName(`${hint}_props`);
    const setupFn = ctx.uniqueName(`${hint}_setup`);
    const vars = entries.map((name) => ctx.uniqueName(`${hint}_${name}`));
    const propsLiteral = pyPropertiesLiteral(descriptor, node, node.properties, `node ${node.id} (${descriptor.type})`, ctx);
    const indented = pythonSource
      .split("\n")
      .map((line) => (line.length ? "    " + line : line))
      .join("\n");
    const code = [
      `def ${setupFn}(properties):`,
      indented,
      `    return ${entries.join(", ")}`,
      `${propsVar} = ${propsLiteral}`,
      `${vars.join(", ")} = ${setupFn}(${propsVar})`,
    ].join("\n");
    return { vars, propsVar, statements: [{ key: setupFn, code }] };
  }

  const hooks: Pick<NodeDefinition, "codegenSource" | "codegenEventSource" | "codegenTransform" | "codegenSink"> = {};
  if (descriptor.kind === "source" && descriptor.eventSource) {
    // Event source: `wait(properties)` is awaited each loop iteration, then `emit(properties)` builds the
    // message -- mirroring a built-in event source (e.g. interrupt.ts). Both come from the one per-instance
    // closure, so they share the author's `nonlocal` state.
    hooks.codegenEventSource = (node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult => {
      const { vars, propsVar, statements } = emitSetup(node, ctx, ["wait", "emit"]);
      return { statements, waitStatement: `await ${vars[0]!}(${propsVar})`, buildMsg: `msg = await ${vars[1]!}(${propsVar})` };
    };
  } else if (descriptor.kind === "source") {
    hooks.codegenSource = (node: GraphNode, ctx: CodegenContext): SourceCodegenResult => {
      const { vars, propsVar, statements } = emitSetup(node, ctx, [entryPointName]);
      const repeatMs = resolveIntervalMs(descriptor, node.properties, `node ${node.id} (${descriptor.type})`);
      return { statements, buildMsg: `msg = await ${vars[0]!}(${propsVar})`, repeatMs };
    };
  } else if (descriptor.kind === "transform") {
    hooks.codegenTransform = (node: GraphNode, ctx: CodegenContext): TransformCodegenResult => {
      const { vars, propsVar, statements } = emitSetup(node, ctx, [entryPointName]);
      return { statements, functionName: ctx.uniqueName(`${hint}_call`), functionBody: `return await ${vars[0]!}(msg, ${propsVar})` };
    };
  } else {
    hooks.codegenSink = (node: GraphNode, ctx: CodegenContext): SinkCodegenResult => {
      const { vars, propsVar, statements } = emitSetup(node, ctx, [entryPointName]);
      return { statements, functionName: ctx.uniqueName(`${hint}_call`), functionBody: `await ${vars[0]!}(msg, ${propsVar})` };
    };
  }
  return hooks;
}

/**
 * A custom `.node.json` package: the descriptor's declared subset (type/kind/ports/description/requires), plus
 * the codegen hooks its `.node.py` produces.
 */
export function buildCustomNodeDefinition(descriptor: CustomNodeDescriptor, pythonSource: string): NodeDefinition {
  const def: NodeDefinition = {
    type: descriptor.type,
    kind: descriptor.kind,
    ports: { inputs: toPortDefinitions(descriptor.ports?.inputs), outputs: toPortDefinitions(descriptor.ports?.outputs) },
  };
  if (descriptor.description !== undefined) def.description = descriptor.description;
  if (descriptor.requires !== undefined) def.requires = descriptor.requires;
  return { ...def, ...packageCodegen(descriptor, pythonSource) };
}

/**
 * A built-in expressed as a package (node-format-parity phase 4, option A): the *full* descriptor -- palette and
 * catalog metadata included -- plus the codegen hooks its generated `.node.py` produces. Unlike
 * buildCustomNodeDefinition, every descriptor field is kept. A core package uses the reserved `thingstudio/`
 * namespace, so it is built directly (never through validateCustomNodeDescriptor).
 */
export function buildCoreNodeDefinition(descriptor: NodeDescriptor, pythonSource: string): NodeDefinition {
  return { ...descriptor, ...packageCodegen(descriptor, pythonSource) };
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
