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

import { ref, shallowRef } from "vue";
import type { ClassicPreset } from "rete";
import type { AnyThingstudioNode, InjectNode } from "./nodes";
import { DEFAULT_BACKEND_WS_URL } from "../../flow-file/admin-api-client";
import type { Target } from "../../definitions/target";
import { CONFIG_TYPES } from "./config-types";

export const selectedNode = ref<AnyThingstudioNode | null>(null);

// Delete-node/delete-wire (2026-09-08, outstanding-items.md "UI / editor"
// section): a wire (Rete connection) needs to be selectable before it can
// be deleted -- node selection already existed (selectedNode above), wire
// selection did not. Set by ThingstudioConnection.vue on click; read by
// editor-setup.ts's deleteSelected() and by ThingstudioConnection.vue
// itself to draw the selected-wire highlight.
export const selectedConnection = ref<ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> | null>(null);

// Rete's own visual multi-select (the `node.selected` flags AreaExtensions.
// selectableNodes' Selector instance manages, driving ThingstudioNode.vue's
// orange border) lives inside editor-setup.ts's closure -- out of reach for
// ThingstudioConnection.vue, which (unlike ThingstudioNode.vue) gets no
// `emit` prop to pipe a request back through (rete-vue-plugin's classic
// preset only threads `emit` to node/socket/control render props, not
// connection -- confirmed reading its render(), 'connection' branch).
// createThingstudioEditor() fills this in once it builds the Selector;
// ThingstudioConnection.vue calls it on wire-click so "select a wire" and
// "multi-select nodes" stay mutually exclusive, matching how a plain node
// click already replaces any earlier node selection.
export const clearNodeSelection = ref<(() => void) | null>(null);

// Backend URL (2026-09-08, admin-API wiring): main.ts owns the actual
// `backendUrlInput` DOM element (this file's own established convention --
// see this module's header, "framework-agnostic... bridging" -- never
// reads the DOM itself) and mirrors its value in here on every edit.
// The credential and preset fields (once also PaletteSidebar.vue's custom node picker) talk to the backend's
// admin API directly and need this editor's current backend location to
// do it, without reaching into main.ts's DOM to get it.
export const backendWsUrl = ref<string>(DEFAULT_BACKEND_WS_URL);

// Bumped whenever a node's `properties` object is mutated from outside
// Vue's reactivity (Rete nodes are plain classes, not reactive) so
// PropertyPanel.vue's v-model bindings know to refresh -- same mechanism
// poc-rete's store.ts used this for.
export const propertyVersion = ref(0);
export function bumpPropertyVersion(): void {
  propertyVersion.value++;
}

// Function-node output-count resize (multi-output-port support,
// outstanding-items/connection-state-gate-router-nodes.md, 2026-09-12) --
// same threading-through-a-ref pattern as clearNodeSelection above, and
// for the same reason: PropertyPanel.vue has no import of the live Rete
// editor/area instances (deliberately -- it only ever touches
// node.properties plus this store), but resizing a node's real output
// ports needs both (removing connections on a port that disappears,
// re-rendering the new port count) -- createThingstudioEditor()
// (editor-setup.ts) is where `editor`/`area` already live in scope, so it
// fills this in the same way it fills in clearNodeSelection. `null` until
// the editor's actually been constructed -- PropertyPanel.vue guards the
// same way it would have to for any store function that might not be
// wired up yet.
export const setFunctionNodeOutputCount = ref<((node: AnyThingstudioNode, count: number) => void) | null>(null);

// Inject click-only live-fire (2026-09-02), reworked 2026-09-13 (Mike:
// "Inject should have two clickables, the arrow which triggers an inject
// message and the body which opens the property sheet" -- the previous
// design made the whole node body either fire or select depending on
// connection state, with no way to open a live inject node's property
// panel short of disconnecting first). The fire action now lives on the
// node's own "▶" icon specifically (ThingstudioNode.vue), which is a
// plain DOM click main.ts can't reach without going through this store --
// same threading-through-a-ref pattern as setFunctionNodeOutputCount
// above, and for the same reason (main.ts owns `transport`, ThingstudioNode.vue
// deliberately doesn't reach into it directly). `null` until main.ts's own
// transport exists (this app's top-level-await ordering, main.ts's own
// header comment on why the old onInjectNodeClicked slot needed the same
// treatment) -- ThingstudioNode.vue guards the same way PropertyPanel.vue
// already does for setFunctionNodeOutputCount.
export const fireInjectNode = ref<((node: InjectNode) => void) | null>(null);

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
  // Singleton config types (config-types.ts's `singleton`, e.g. WiFi): "create" means "make the one
  // instance look like this" -- same id back, so every node referencing it sees the change.
  if (CONFIG_TYPES[type]?.singleton) {
    const existing = listConfigsOfType(type)[0];
    if (existing) {
      // Same credential: keep the values main.ts already fetched for it (it only refetches when the
      // name changes). A different one: start clean, and main.ts fetches the new values.
      const same = existing.properties.credentialName === properties.credentialName;
      existing.properties = same ? { ...existing.properties, ...properties } : { ...properties };
      bumpConfigsVersion();
      return existing.id;
    }
  }
  // Keyed singleton (config-types.ts's `keyField`, e.g. I2C bus): one config per key value.
  const keyField = CONFIG_TYPES[type]?.keyField;
  if (keyField !== undefined) {
    const existing = listConfigsOfType(type).find((c) => Number(c.properties[keyField]) === Number(properties[keyField]));
    if (existing) {
      existing.properties = { ...existing.properties, ...properties };
      bumpConfigsVersion();
      return existing.id;
    }
  }
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
/** Lowest whole number not yet used as `keyField` by a config of this type -- the key a new keyed-singleton
 * config starts on (ConfigRefField's "+"). */
export function nextFreeKey(type: string, keyField: string): number {
  const used = new Set(listConfigsOfType(type).map((c) => Number(c.properties[keyField])));
  let k = 0;
  while (used.has(k)) k++;
  return k;
}

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

// The processor/board the next compile targets (definitions/target.ts),
// or null when none is known -- main.ts owns resolving it (Board menu +
// the connected board's HELLO) and writes it here; PropertyPanel.vue reads
// it for pin-field limits and hints. shallowRef: a Target is replaced
// whole, never mutated, and its Sets/Maps don't need deep reactivity.
export const activeTarget = shallowRef<Target | null>(null);
