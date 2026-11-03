// SPDX-License-Identifier: Apache-2.0
// editor/src/cli/check-flow.ts
//
// Headless compile and validate (2026-10-10; launch item "Headless compile/validate", needed for AI authoring: an
// agent can only check its own work if the compiler runs outside the browser). A pure function: the text of a flow
// file in, the problems and the generated MicroPython out. No file or process access, so a command line, an MCP
// server or a backend can all sit on top of it.
//
// It does what the editor does between "open a flow" and "show the source preview", in the same order:
//   1. parse the file (flow-file.ts)
//   2. build each node the way the loader does (a fresh node's defaults, then the file's properties over them), so a
//      flow that omits a property compiles with the default the editor would have used
//   3. resolve the wires by slot, as the loader does, and refuse the ones the canvas would refuse
//   4. compile (compiler/compile.ts), pin-checking against a board when one is given
// Every problem found is reported, not just the first: steps 1-3 collect, step 4 stops at the compiler's first error
// (compile.ts throws one CompileError).
//
// Not done here: credentials (WiFi and MQTT configs carry a credential name; the secrets live in the backend, so
// stand-in values are used and a note says so), reading custom node packages from disk, and the mpy-cross syntax
// check (the command line does both: the files and the WASM module are outside a pure function). Packages it read
// come in through `customNodes` and are built exactly as the editor builds them (2026-11-03: a user writing a custom
// node had no way to check it).

import { compile } from "../compiler/compile.js";
import type { GraphConfigNode, GraphData, GraphLink, GraphNode } from "../compiler/graph.js";
import { resolvePortType } from "../compiler/node-definition.js";
import { buildDefinitionSet, type DefinitionSet, type PinId } from "../definitions/definitions.js";
import { BUILTIN_DEFINITION_FILES } from "../definitions/builtin.js";
import { resolveTarget, type Target } from "../definitions/target.js";
import { parseFlowFile, FlowFileError, type FlowFile } from "../flow-file/flow-file.js";
import { buildRegistry } from "../node-library/registry.js";
import { buildCustomNodeDefinition, mergeCustomNodeRegistry, type CustomNodeDescriptor } from "../node-library/custom-node.js";
import type { NodeDefinition } from "../compiler/node-definition.js";
import type { CustomNodeProblem, LoadedCustomNode } from "../app/custom-node-loader.js";
import { runCompileHooksSync } from "../node-library/compile-hooks.js";
import { visibleConfigProperties } from "../app/rete/config-types.js";
import { runHookOnceSync } from "../compile-hook/run-hook.js";
import { readFileSync } from "node:fs";
import { CustomNode, NODE_FACTORIES, type DescriptorNode } from "../app/rete/nodes.js";
import { ClassicPreset } from "rete";
import { type ThingstudioSocket } from "../app/rete/sockets.js";
import { resolveOutputCount } from "../compiler/node-descriptor.js";
import { checkLayout, relayout, type LayoutNode } from "./layout.js";

export interface CheckOptions {
  /** Board menu value: "board:<id>" or "processor:<id>". Absent: no board, pins are checked against the widest range. */
  board?: string;
  /** Also check the layout (left to right, tight, nothing overlapping); problems come back as warnings. */
  layout?: boolean;
  /** Custom node packages, as custom-node-loader.ts loads them, and where they came from (for messages). */
  customNodes?: CustomNodes;
}

export interface CustomNodes {
  /** The folder searched, as the user would write it. */
  dir: string;
  loaded: LoadedCustomNode[];
  problems: CustomNodeProblem[];
}

/** The node types one check can see: the built-ins plus that check's custom packages. */
interface Library {
  registry: Map<string, NodeDefinition>;
  custom: Map<string, CustomNodeDescriptor>;
  customNodes?: CustomNodes;
}

export interface Problem {
  /** What is wrong, in the words the editor would use. */
  message: string;
  /** The node the problem is about, when it is about one. */
  node?: string;
}

export interface CheckResult {
  /** No errors. Warnings and notes do not make a flow not ok. */
  ok: boolean;
  errors: Problem[];
  warnings: string[];
  /** Things the check could not do, or assumed (credentials, board). */
  notes: string[];
  /** The generated MicroPython. Absent when there were errors. */
  source?: string;
  stats?: { nodes: number; wires: number; configs: number; bytes: number };
}

let definitions: DefinitionSet | null = null;
function builtinDefinitions(): DefinitionSet {
  if (!definitions) definitions = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);
  return definitions;
}

/** Board choices the check accepts, for --list-boards and for error messages. */
export function boardChoices(): string[] {
  const d = builtinDefinitions();
  return [...[...d.boards.keys()].map((id) => `board:${id}`), ...[...d.processors.keys()].map((id) => `processor:${id}`)].sort();
}

const builtinRegistry = buildRegistry();

function libraryFor(customNodes?: CustomNodes): Library {
  if (!customNodes) return { registry: builtinRegistry, custom: new Map() };
  const defs = customNodes.loaded.map((p) => {
    const def = buildCustomNodeDefinition(p.descriptor, p.pythonSource);
    if (p.compileHook !== undefined) def.compileHook = p.compileHook;
    return def;
  });
  return {
    registry: mergeCustomNodeRegistry(builtinRegistry, defs),
    custom: new Map(customNodes.loaded.map((p) => [p.descriptor.type, p.descriptor])),
    customNodes,
  };
}

/** Why a type isn't known: a custom package that failed to load names its file (as the editor's console does). */
function unknownTypeMessage(id: string, type: string, lib: Library): string {
  const failed = lib.customNodes?.problems.find((p) => p.type === type);
  if (failed) return `node ${id}: custom node type "${type}" didn't load -- ${failed.file}: ${failed.message}`;
  if (!type.startsWith("thingstudio/")) {
    const where = lib.customNodes ? lib.customNodes.dir : "~/.thingstudio/custom-nodes/ (or the folder given with --custom-nodes)";
    return `node ${id}: no custom node package defines type "${type}" -- its .node.json and .node.py go in ${where}`;
  }
  return `node ${id}: unknown node type "${type}"`;
}

let hookWasm: Uint8Array | null = null;
function hookWasmBytes(): Uint8Array {
  if (hookWasm) return hookWasm;
  // Source tree (src/cli) and bundled CLI (dist-cli) sit one and two levels below editor/; a packaged copy (the
  // AI-authoring skill) carries the file in vendor/ beside the CLI.
  for (const url of [
    new URL("./vendor/micropython-wasi/micropython-wasi.wasm", import.meta.url),
    new URL("../../public/vendor/micropython-wasi/micropython-wasi.wasm", import.meta.url),
    new URL("../public/vendor/micropython-wasi/micropython-wasi.wasm", import.meta.url),
  ]) {
    try {
      hookWasm = new Uint8Array(readFileSync(url));
      return hookWasm;
    } catch {
      // try the next layout
    }
  }
  throw new Error("could not find micropython-wasi.wasm (expected in editor/public/vendor/micropython-wasi/) -- needed for a package compile hook");
}
const syncHookRunner = {
  runSync: (hookSource: string, ctx: Parameters<typeof runHookOnceSync>[0]["context"], properties: Record<string, unknown>) =>
    runHookOnceSync({ wasmBytes: hookWasmBytes(), hookSource, context: ctx, properties }),
};

type ReteNode = ClassicPreset.Node & { properties: Record<string, unknown> };

/** A node as the loader builds it, or null for a type the canvas has no class for. */
function buildNode(type: string, fileProps: Record<string, unknown>, lib: Library): ReteNode | null {
  const custom = lib.custom.get(type);
  const kind = type.replace(/^thingstudio\//, "");
  const factory = custom
    ? () => new CustomNode(custom)
    : (NODE_FACTORIES as Record<string, (() => unknown) | undefined>)[kind];
  if (!factory) return null;
  const node = factory() as ReteNode;
  Object.assign(node.properties, fileProps);
  // As main.ts's loader: an output typed by a property (inject's payloadType) follows the saved value.
  (node as unknown as DescriptorNode).retypeOutputs();
  const dynamic = node as unknown as DescriptorNode;
  const dyn = dynamic.descriptor.dynamicOutputs;
  if (dyn) {
    const wanted = resolveOutputCount(dyn, node.properties);
    const current = Object.keys(node.outputs).length;
    for (let i = current; i < wanted; i++) dynamic.addDynamicOutputAt(i);
    for (let i = wanted; i < current; i++) dynamic.removeDynamicOutputAt(i);
    node.properties[dyn.property] = wanted;
    dynamic.setDynamicOutputHeight(wanted);
  }
  return node;
}

// Names and secrets the editor fetches from the backend at load. Here only a name is known.
function standIn(config: GraphConfigNode, notes: Set<string>): GraphConfigNode {
  const p = { ...config.properties };
  if (config.type === "thingstudio/config/wifi") {
    if (p.ssid === undefined) {
      p.ssid = "stand-in-ssid";
      p.password = "stand-in-password";
      notes.add("WiFi credentials were not resolved (they live in the backend): stand-in values were used, so the compile does not check them.");
    }
  } else if (config.type === "thingstudio/config/mqtt-broker") {
    if (p.broker === undefined) {
      p.broker = "stand-in.invalid";
      p.port = p.port ?? 1883;
      notes.add("MQTT broker credentials were not resolved (they live in the backend): stand-in values were used, so the compile does not check them.");
    }
  }
  return { ...config, properties: p };
}

export function checkFlowText(text: string, options: CheckOptions = {}): CheckResult {
  const lib = libraryFor(options.customNodes);
  const result = checkFlow(text, options, lib);
  if (options.layout) {
    // Independent of the compile: a flow that fails to compile can still be laid out badly, and the author fixes both.
    try {
      const file = parseFlowFile(text);
      result.warnings.push(...checkLayout(layoutNodes(file, lib), file.edges, positions(file)));
    } catch {
      // Not a flow file: the parse error is already reported.
    }
  }
  return result;
}

function checkFlow(text: string, options: CheckOptions, lib: Library): CheckResult {
  const registry = lib.registry;
  const errors: Problem[] = [];
  const notes = new Set<string>();

  let file: FlowFile;
  try {
    file = parseFlowFile(text);
  } catch (err) {
    const message = err instanceof FlowFileError || err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ message: `not a readable flow file: ${message}` }], warnings: [], notes: [] };
  }

  let target: Target | null = null;
  if (options.board) {
    const res = resolveTarget(builtinDefinitions(), options.board, null);
    target = res.target;
    if (!target) errors.push({ message: `unknown board "${options.board}". Choices: ${boardChoices().join(", ")}` });
  }

  const nodes: GraphNode[] = [];
  const built = new Map<string, ReteNode>();
  for (const n of file.nodes) {
    if (!registry.has(n.type)) {
      errors.push({ node: n.id, message: unknownTypeMessage(n.id, n.type, lib) });
      continue;
    }
    const node = buildNode(n.type, n.properties, lib);
    if (node) {
      built.set(n.id, node);
      nodes.push({ id: n.id, type: n.type, properties: node.properties });
    } else {
      // Compiles but the canvas has no class for it (a hidden type): use the file's properties as they are.
      nodes.push({ id: n.id, type: n.type, properties: n.properties });
    }
  }

  const links: GraphLink[] = [];
  file.edges.forEach(([from, slot, to, toSlot], i) => {
    const a = built.get(from);
    const b = built.get(to);
    const where = `wire from node ${from} output ${slot + 1} to node ${to} input ${toSlot + 1}`;
    if (!file.nodes.some((n) => n.id === from) || !file.nodes.some((n) => n.id === to)) {
      errors.push({ message: `${where}: a node it names is not in the flow` });
      return;
    }
    if (!a || !b) {
      // An endpoint without a canvas class: nothing to check slots against; pass it through for the compiler.
      links.push([i + 1, from, slot, to, toSlot, "any"]);
      return;
    }
    const outKey = Object.keys(a.outputs)[slot];
    const inKey = Object.keys(b.inputs)[toSlot];
    if (outKey === undefined) {
      errors.push({ node: from, message: `${where}: node ${from} has no output ${slot + 1} (it has ${Object.keys(a.outputs).length})` });
      return;
    }
    if (inKey === undefined) {
      errors.push({ node: to, message: `${where}: node ${to} has no input ${toSlot + 1} (it has ${Object.keys(b.inputs).length})` });
      return;
    }
    const out = a.outputs[outKey]!.socket as ThingstudioSocket;
    const inp = b.inputs[inKey]!.socket as ThingstudioSocket;
    if (!inp.isCompatibleWith(out)) {
      const outT = describePort(file, from, slot, "outputs", registry);
      const inT = describePort(file, to, toSlot, "inputs", registry);
      errors.push({ node: to, message: `${where}: the editor would refuse this wire (${outT} into ${inT})` });
      return;
    }
    links.push([i + 1, from, slot, to, toSlot, out.name]);
  });

  if (errors.length > 0) return { ok: false, errors, warnings: [], notes: [...notes] };

  const configs = file.configs.map((c) => standIn({ id: c.id, type: c.type, properties: c.properties }, notes));
  const graph: GraphData = { nodes, links, screens: file.screens };
  if (configs.length > 0) graph.configs = configs;

  try {
    const hooks = runCompileHooksSync(graph, registry, syncHookRunner, {
      target,
      redactConfig: (c) => visibleConfigProperties(c.type, c.properties),
    });
    const r = compile(graph, registry, { target, hookResults: hooks.results, hookWarnings: hooks.warnings });
    return {
      ok: true,
      errors: [],
      warnings: [...r.warnings],
      notes: [...notes],
      source: r.source,
      stats: { nodes: nodes.length, wires: links.length, configs: configs.length, bytes: r.source.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const m = /\bnode (\S+?)[ ,:)]/.exec(message);
    return { ok: false, errors: [{ message, node: m && nodes.some((n) => n.id === m[1]) ? m[1] : undefined }], warnings: [], notes: [...notes] };
  }
}

/** Each node with the size the editor draws it at (a node type the canvas has no class for: a custom node's size). */
function layoutNodes(file: FlowFile, lib: Library): LayoutNode[] {
  return file.nodes.map((n) => {
    const built = lib.registry.has(n.type) ? buildNode(n.type, n.properties, lib) : null;
    const b = built as unknown as { width?: number; height?: number } | null;
    return { id: n.id, width: b?.width ?? 128, height: b?.height ?? 34 };
  });
}

function positions(file: FlowFile): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [id, entry] of Object.entries(file.layout ?? {})) {
    const p = entry?.pos;
    if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") out[id] = [p[0], p[1]];
  }
  return out;
}

/**
 * The flow file's text with every node moved to the layout the rules give (layout.ts). Only positions change:
 * nodes, wires, configs, screens, panes and any other layout field (a saved size) are kept as they were. Throws a
 * FlowFileError for a file that is not a flow.
 */
export function relayoutFlowText(text: string, customNodes?: CustomNodes): string {
  const file = parseFlowFile(text);
  const raw = JSON.parse(text) as Record<string, unknown> & { layout?: Record<string, Record<string, unknown>> };
  const placed = relayout(layoutNodes(file, libraryFor(customNodes)), file.edges);
  const layout: Record<string, Record<string, unknown>> = {};
  for (const n of file.nodes) layout[n.id] = { ...(raw.layout?.[n.id] ?? {}), pos: placed[n.id]! };
  raw.layout = layout;
  return JSON.stringify(raw, null, 2) + "\n";
}

function describePort(file: FlowFile, nodeId: string, slot: number, side: "inputs" | "outputs", registry: Map<string, NodeDefinition>): string {
  const n = file.nodes.find((x) => x.id === nodeId)!;
  const def = registry.get(n.type)!;
  const ports = def.ports?.[side] ?? [];
  const port = ports[slot] ?? ports[0];
  return port ? `${resolvePortType(port, n.properties)} ${side === "outputs" ? "from" : "to"} ${n.type.replace("thingstudio/", "")}` : "?";
}

/** The mpy-cross -march a board or processor needs, from its processor definition. Null for an unknown choice. */
export function nativeArchFor(choice: string): string | null {
  return resolveTarget(builtinDefinitions(), choice, null).target?.processor.nativeArch ?? null;
}

/** What a pin check knows about a board or processor, for an author choosing pins. Null for an unknown choice. */
export function boardInfo(choice: string): {
  id: string;
  name: string;
  processor: string;
  notes: string;
  wifi: boolean | null;
  labelledPins: Record<string, PinId>;
  gpio: PinId[];
  inputOnly: PinId[];
  noPullUp: PinId[];
  reserved: Record<string, string>;
  avoid: Record<string, string>;
  /** Hardware features this target has (wifi, espnow, pio...); a node's `requires` is checked against these. */
  capabilities: string[];
} | null {
  const res = resolveTarget(builtinDefinitions(), choice, null);
  const target = res.target;
  if (!target) return null;
  const byPin = (a: PinId, b: PinId): number => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b);
  };
  const obj = (m: ReadonlyMap<PinId, string>) => Object.fromEntries([...m.entries()].sort((a, b) => byPin(a[0], b[0])).map(([k, v]) => [String(k), v]));
  const num = (s: ReadonlySet<PinId>) => [...s].sort(byPin);
  return {
    id: choice,
    name: target.label,
    processor: target.processor.id,
    notes: [target.processor.notes, target.board?.notes ?? ""].filter(Boolean).join(" "),
    wifi: target.board?.wifi ?? null,
    labelledPins: Object.fromEntries([...(target.board?.pins ?? [])].sort((a, b) => byPin(a[1], b[1]))),
    gpio: num(target.gpio),
    inputOnly: num(target.inputOnly),
    noPullUp: num(target.noPull),
    reserved: obj(target.reserved),
    avoid: obj(target.avoid),
    capabilities: [...target.capabilities].sort(),
  };
}
