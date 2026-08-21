// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/custom-nodes-store.ts
//
// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20) -- session-scoped store of loaded custom node
// packages, parallel to store.ts's `configs` store: a plain reactive Map
// plus a version counter bumped on every mutation (Rete nodes/this store
// aren't deeply Vue-reactive on their own, same reasoning store.ts's own
// header gives for `propertyVersion`/`configsVersion`).
//
// Deliberately NOT cleared by main.ts's "clear canvas" handler the way
// `configs` is -- configs are flow-scoped (config-node-and-palette-
// implementation-briefing.md), but a loaded custom node *type* is a
// session-scoped fact about what the palette currently offers, same
// lifetime as the running editor tab, independent of which flow happens
// to be open (scoping note, Decision 4: no persistence across a reload,
// but also no reason to forget a loaded type just because the canvas was
// cleared).

import { ref } from "vue";
import { buildCustomNodeDefinition, CustomNodeDescriptorError, type CustomNodeDescriptor } from "../../node-library/custom-node.js";
import type { NodeDefinition } from "../../compiler/node-definition.js";

export interface CustomNodePackage {
  descriptor: CustomNodeDescriptor;
  pythonSource: string;
}

export const customNodePackages = ref<Map<string, CustomNodePackage>>(new Map());
export const customNodesVersion = ref(0);
function bumpCustomNodesVersion(): void {
  customNodesVersion.value++;
}

/** Registers a validated descriptor + its `.node.py` source under the
 * descriptor's own `type`. Throws CustomNodeDescriptorError on a
 * collision with an already-loaded custom type -- re-loading the exact
 * same package (e.g. after editing it) is a deliberate replace, done via
 * replaceCustomNodePackage() below, not silently allowed here; a
 * different package claiming an already-used type id is far more likely
 * a mistake (two packages, same type by accident) than an intentional
 * replace, so this stays strict by default. */
export function registerCustomNodePackage(descriptor: CustomNodeDescriptor, pythonSource: string): void {
  if (customNodePackages.value.has(descriptor.type)) {
    throw new CustomNodeDescriptorError(`a custom node type "${descriptor.type}" is already loaded this session -- reload it via replaceCustomNodePackage if you meant to update it`);
  }
  customNodePackages.value.set(descriptor.type, { descriptor, pythonSource });
  bumpCustomNodesVersion();
}

/** Loads (first time) or replaces (already loaded -- e.g. re-picking the
 * same package after editing its .node.py) a custom node type in one
 * step. This is what the "Load custom node..." UI action actually calls
 * -- registerCustomNodePackage()'s stricter collision check exists for
 * callers that specifically want to guarantee they're not clobbering an
 * existing type. */
export function loadOrReplaceCustomNodePackage(descriptor: CustomNodeDescriptor, pythonSource: string): void {
  customNodePackages.value.set(descriptor.type, { descriptor, pythonSource });
  bumpCustomNodesVersion();
}

export function listCustomNodePackages(): CustomNodePackage[] {
  return [...customNodePackages.value.values()];
}

export function getCustomNodePackage(type: string): CustomNodePackage | undefined {
  return customNodePackages.value.get(type);
}

/** Every loaded custom package, compiled to an ordinary NodeDefinition
 * (custom-node.ts's buildCustomNodeDefinition) -- recomputed on each call
 * rather than cached, since it's cheap (string templating, no I/O) and
 * this way there's no separate cache to keep in sync with the store. What
 * main.ts's currentSource() merges into the built-in registry
 * (registry.ts's buildRegistry()) for every compile. */
export function listCustomNodeDefinitions(): NodeDefinition[] {
  return listCustomNodePackages().map((pkg) => buildCustomNodeDefinition(pkg.descriptor, pkg.pythonSource));
}
