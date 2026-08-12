import type { NodeDefinition } from "../compiler/node-definition.js";
import { functionNode } from "./function-node.js";
import { gpioOutNode } from "./gpio-out.js";
import { injectNode } from "./inject.js";

/** The full v1 node type registry. Only 3 entries so far -- the POC-D set, ported to the real compiler contract. Tier 1 (docs/working-notes/mvp-feature-priorities.md) adds the rest. */
export function buildRegistry(): Map<string, NodeDefinition> {
  const registry = new Map<string, NodeDefinition>();
  for (const def of [injectNode, functionNode, gpioOutNode]) {
    registry.set(def.type, def);
  }
  return registry;
}
