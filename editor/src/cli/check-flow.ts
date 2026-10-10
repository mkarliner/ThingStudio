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
// stand-in values are used and a note says so), custom node packages, and the mpy-cross syntax check (the command
// line adds that, since it needs a WASM module).

import { compile } from "../compiler/compile.js";
import type { GraphConfigNode, GraphData, GraphLink, GraphNode } from "../compiler/graph.js";
import { resolvePortType } from "../compiler/node-definition.js";
import { buildDefinitionSet, type DefinitionSet } from "../definitions/definitions.js";
import { BUILTIN_DEFINITION_FILES } from "../definitions/builtin.js";
import { resolveTarget, type Target } from "../definitions/target.js";
import { parseFlowFile, FlowFileError, type FlowFile } from "../flow-file/flow-file.js";
import { functionNode as functionNodeDefinition } from "../node-library/function-node.js";
import { buildRegistry } from "../node-library/registry.js";
import { NODE_FACTORIES, functionOutputKey } from "../app/rete/nodes.js";
import { ClassicPreset } from "rete";
import { socketForPayloadType, type ThingstudioSocket } from "../app/rete/sockets.js";

export interface CheckOptions {
  /** Board menu value: "board:<id>" or "processor:<id>". Absent: no board, pins are checked against the widest range. */
  board?: string;
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

const registry = buildRegistry();

type ReteNode = ClassicPreset.Node & { properties: Record<string, unknown> };

/** A node as the loader builds it, or null for a type the canvas has no class for. */
function buildNode(type: string, fileProps: Record<string, unknown>): ReteNode | null {
  const kind = type.replace(/^thingstudio\//, "");
  const factory = (NODE_FACTORIES as Record<string, (() => unknown) | undefined>)[kind];
  if (!factory) return null;
  const node = factory() as ReteNode;
  Object.assign(node.properties, fileProps);
  if (kind === "function") {
    const wanted = functionNodeDefinition.outputCount!(node.properties as never);
    const current = Object.keys(node.outputs).length;
    for (let i = current; i < wanted; i++) {
      node.addOutput(functionOutputKey(i), new ClassicPreset.Output(socketForPayloadType("any"), String(i + 1)));
    }
    for (let i = wanted; i < current; i++) node.removeOutput(functionOutputKey(i));
    node.properties.outputCount = wanted;
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
      errors.push({ node: n.id, message: `node ${n.id}: unknown node type "${n.type}"` });
      continue;
    }
    const node = buildNode(n.type, n.properties);
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
      const outT = describePort(file, from, slot, "outputs");
      const inT = describePort(file, to, toSlot, "inputs");
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
    const r = compile(graph, registry, { target });
    return {
      ok: true,
      errors: [],
      warnings: r.warnings,
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

function describePort(file: FlowFile, nodeId: string, slot: number, side: "inputs" | "outputs"): string {
  const n = file.nodes.find((x) => x.id === nodeId)!;
  const def = registry.get(n.type)!;
  const ports = def.ports?.[side] ?? [];
  const port = ports[slot] ?? ports[0];
  return port ? `${resolvePortType(port, n.properties)} ${side === "outputs" ? "from" : "to"} ${n.type.replace("thingstudio/", "")}` : "?";
}

/** What a pin check knows about a board or processor, for an author choosing pins. Null for an unknown choice. */
export function boardInfo(choice: string): {
  id: string;
  name: string;
  processor: string;
  notes: string;
  wifi: boolean | null;
  labelledPins: Record<string, number>;
  gpio: number[];
  inputOnly: number[];
  noPullUp: number[];
  reserved: Record<string, string>;
  avoid: Record<string, string>;
} | null {
  const res = resolveTarget(builtinDefinitions(), choice, null);
  const target = res.target;
  if (!target) return null;
  const obj = (m: ReadonlyMap<number, string>) => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]));
  const num = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);
  return {
    id: choice,
    name: target.label,
    processor: target.processor.id,
    notes: [target.processor.notes, target.board?.notes ?? ""].filter(Boolean).join(" "),
    wifi: target.board?.wifi ?? null,
    labelledPins: Object.fromEntries([...(target.board?.pins ?? [])].sort((a, b) => a[1] - b[1])),
    gpio: num(target.gpio),
    inputOnly: num(target.inputOnly),
    noPullUp: num(target.noPull),
    reserved: obj(target.reserved),
    avoid: obj(target.avoid),
  };
}
