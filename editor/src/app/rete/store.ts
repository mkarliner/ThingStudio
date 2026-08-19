// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/store.ts
//
// Phase 3 item 13: tiny shared reactive store bridging the Rete editor
// (framework-agnostic, plain classes) and PropertyPanel.vue -- ported from
// pocs/poc-rete/src/store.ts, trimmed to what this app actually needs.
// Deliberately does NOT port that file's `debugLog`/`logDebug`: those
// existed to feed poc-rete's DebugSidebar.vue, which stood in for a device
// this spike didn't have. The real editor already has a device console
// (main.ts's `logLine`/`#console`) for exactly that purpose, and canvas-side
// live-value propagation is explicitly out of scope for this migration
// (rete-migration-decision.md, "Not in scope") -- there is nothing here for
// a debug log to observe.
//
// Config nodes (config-node-and-palette-implementation-briefing.md): a
// second, genuinely new store below -- `configs`. Deliberately NOT folded
// into anything Rete-graph-walking: configs aren't Rete nodes at all (no
// ports, never wired, never appear on the canvas as boxes -- see
// compiler/graph.ts's GraphConfigNode header), so `editor.getNodes()` never
// sees them and there is no existing "walk the live graph" code path this
// could piggyback on. graph-adapter.ts's toGraphData() and main.ts's
// buildFlowFile() call site both read this store directly (as an explicit
// array param, not by importing it themselves, keeping both of those
// modules unit-testable without a live Vue app -- see their own headers).

import { ref } from "vue";
import type { AnyThingstudioNode } from "./nodes";

export const selectedNode = ref<AnyThingstudioNode | null>(null);

// Bumped whenever a node's `properties` object is mutated from outside
// Vue's reactivity (Rete nodes are plain classes, not reactive) so
// PropertyPanel.vue's v-model bindings know to refresh -- same mechanism
// poc-rete's store.ts used this for.
export const propertyVersion = ref(0);
export function bumpPropertyVersion(): void {
  propertyVersion.value++;
}

// --- Config nodes ---------------------------------------------------------

export interface ConfigEntry {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

// Keyed by id -- a plain Map, not deeply Vue-reactive (mutating an entry's
// `.properties` in place doesn't trigger a re-render on its own), so every
// mutator below also bumps `configsVersion`, the same off-Vue-reactivity
// signal `propertyVersion` already establishes for node properties.
// ConfigRefField.vue reads `configsVersion.value` to establish a reactive
// dependency the same way PropertyPanel.vue's `node` computed does.
export const configs = ref<Map<string, ConfigEntry>>(new Map());
export const configsVersion = ref(0);
function bumpConfigsVersion(): void {
  configsVersion.value++;
}

export function listConfigsOfType(type: string): ConfigEntry[] {
  return [...configs.value.values()].filter((c) => c.type === type);
}

export function getConfig(id: string): ConfigEntry | undefined {
  return configs.value.get(id);
}

/** Creates a new config of the given type with the given initial
 * properties and returns its freshly-generated id. `crypto.randomUUID()`,
 * matching Rete's own node-ID scheme (ClassicPreset.Node's constructor) --
 * any unique string works here since configs live in their own ID space
 * (graph.ts's GraphConfigNode header), this just reuses an already-proven
 * generator rather than inventing a second one. */
export function createConfig(type: string, properties: Record<string, unknown>): string {
  const id = crypto.randomUUID();
  configs.value.set(id, { id, type, properties });
  bumpConfigsVersion();
  return id;
}

/** Merges `properties` into the existing config's own properties (partial
 * update, matching PropertyPanel.vue's per-field `touch()` pattern for
 * ordinary node properties). Throws if `id` doesn't name a real config --
 * a caller passing a stale/unknown id is a programmer error worth failing
 * loudly on (CLAUDE.md's fault-handling priority), same reasoning
 * nodes.ts's portSocket() and graph-adapter.ts's socketIndex() already
 * apply to their own analogous "key not found" cases. */
export function updateConfig(id: string, properties: Record<string, unknown>): void {
  const existing = configs.value.get(id);
  if (!existing) throw new Error(`store.ts: updateConfig() called with unknown config id "${id}"`);
  existing.properties = { ...existing.properties, ...properties };
  bumpConfigsVersion();
}

/** Replaces the entire config store's contents -- used when a flow file
 * loads (main.ts's applyFlowFile()) and by clearConfigs() below (an empty
 * replacement). Not a merge: a freshly loaded flow's configs fully replace
 * whatever was there before, matching applyFlowFile()'s own
 * clear-then-repopulate treatment of the canvas itself. */
export function replaceAllConfigs(entries: ConfigEntry[]): void {
  configs.value = new Map(entries.map((c) => [c.id, c]));
  bumpConfigsVersion();
}

export function clearConfigs(): void {
  replaceAllConfigs([]);
}
