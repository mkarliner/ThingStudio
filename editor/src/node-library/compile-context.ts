// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/compile-context.ts
//
// Builds the JSON-shaped context a package's optional <name>.compile.py hook receives
// (interfaces/node-compile-context/SPEC.md, v1 draft). Pure: no I/O, no interpreter. The async hook
// pre-pass owns running the hook; this file only assembles what it sees.
//
// Secrets: flow.nodes and flow.configs carry non-secret properties. The caller passes a redactConfig
// function (main.ts knows the config types; node-library must not import app/rete/config-types.ts --
// module-boundaries.test.ts). referencedConfigs still carries the resolved values for the configs this
// node itself references, which is what the node already receives on the board via configRef.

import type { GraphConfigNode, GraphData, GraphNode } from "../compiler/graph.js";
import type { NodeDescriptor } from "../compiler/node-descriptor.js";
import type { Target } from "../definitions/target.js";

export const COMPILE_CONTEXT_VERSION = 1;

export interface CompileContextWiring {
  readonly inputs: boolean[];
  readonly outputs: boolean[];
}

export interface CompileContextNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
  readonly wired: CompileContextWiring;
}

export interface CompileContextConfig {
  readonly id: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

/** A node as the hook sees it in `flow.nodes`: no wiring (that is `node.wired` for its own instance). */
export interface CompileFlowNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

export interface CompileContextTarget {
  readonly boardId: string | null;
  readonly boardName: string | null;
  readonly processorId: string;
  readonly processorName: string;
  readonly label: string;
  readonly capabilities: string[];
}

export interface CompileContext {
  readonly version: number;
  readonly node: CompileContextNode;
  readonly flow: { readonly nodes: CompileFlowNode[]; readonly configs: CompileContextConfig[] };
  readonly referencedConfigs: Record<string, Record<string, unknown>>;
  readonly target: CompileContextTarget | null;
}

export interface BuildCompileContextOptions {
  readonly graphData: GraphData;
  readonly node: GraphNode;
  readonly descriptor: NodeDescriptor;
  readonly target?: Target | null;
  /** Strips secrets from a config's properties for flow.configs. Defaults to identity (tests). */
  readonly redactConfig?: (config: GraphConfigNode) => Record<string, unknown>;
}

/** Port counts from the descriptor; a registry-only built-in with no `ports` sees empty arrays. */
function wiringFor(node: GraphNode, descriptor: NodeDescriptor, graphData: GraphData): CompileContextWiring {
  const inputs = new Array<boolean>(descriptor.ports?.inputs?.length ?? 0).fill(false);
  const outputs = new Array<boolean>(descriptor.ports?.outputs?.length ?? 0).fill(false);
  for (const [, originId, originSlot, targetId, targetSlot] of graphData.links) {
    if (originId === node.id && originSlot >= 0 && originSlot < outputs.length) outputs[originSlot] = true;
    if (targetId === node.id && targetSlot >= 0 && targetSlot < inputs.length) inputs[targetSlot] = true;
  }
  return { inputs, outputs };
}

function targetFor(target: Target | null | undefined): CompileContextTarget | null {
  if (!target) return null;
  return {
    boardId: target.board ? target.board.id : null,
    boardName: target.board ? target.board.name : null,
    processorId: target.processor.id,
    processorName: target.processor.name,
    label: target.label,
    capabilities: [...target.capabilities].sort(),
  };
}

/** The configs this node's `configRef` fields point at, with their resolved properties. A singleton field
 * picks the flow's one config of that type (zero or many is left out here; the compile's own field
 * resolution reports it as a CompileError). */
function referencedConfigs(descriptor: NodeDescriptor, node: GraphNode, configs: readonly GraphConfigNode[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const field of descriptor.properties ?? []) {
    if (field.kind !== "configRef" || !field.name) continue;
    const configType = field.configType;
    let found: GraphConfigNode | undefined;
    if (field.singleton && configType) {
      const matches = configs.filter((c) => c.type === configType);
      if (matches.length === 1) found = matches[0];
    } else {
      const id = node.properties[field.name];
      if (typeof id === "string" && id !== "") found = configs.find((c) => c.id === id);
    }
    if (found) out[found.id] = { ...found.properties };
  }
  return out;
}

export function buildCompileContext(options: BuildCompileContextOptions): CompileContext {
  const { graphData, node, descriptor, target, redactConfig } = options;
  const configs = graphData.configs ?? [];
  const redact = redactConfig ?? ((c: GraphConfigNode) => c.properties);
  return {
    version: COMPILE_CONTEXT_VERSION,
    node: {
      id: node.id,
      type: node.type,
      properties: { ...node.properties },
      wired: wiringFor(node, descriptor, graphData),
    },
    flow: {
      nodes: graphData.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        properties: { ...n.properties },
      })),
      configs: configs.map((c) => ({ id: c.id, type: c.type, properties: redact(c) })),
    },
    referencedConfigs: referencedConfigs(descriptor, node, configs),
    target: targetFor(target),
  };
}
