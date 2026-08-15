// Thingstudio poc-rete — tiny shared reactive store bridging the Rete editor
// (framework-agnostic) and the surrounding Vue app shell (PropertyPanel,
// DebugSidebar). This is exactly the "sibling component reading the same
// selection state" architecture-review-briefing.md predicted checkpoint 4
// would fall out of for free, versus Litegraph's one-off code-modal.

import { ref } from "vue";
import type { AnyThingstudioNode } from "./nodes";

export const selectedNode = ref<AnyThingstudioNode | null>(null);
export const debugLog = ref<{ id: string; label: string; value: unknown; at: number }[]>([]);

export function logDebug(label: string, value: unknown): void {
  debugLog.value = [{ id: crypto.randomUUID(), label, value, at: Date.now() }, ...debugLog.value].slice(0, 50);
}

// Bumped whenever a node's `properties` object is mutated from outside Vue's
// reactivity (Rete nodes are plain classes, not reactive) so PropertyPanel's
// v-model bindings and the node's own re-render both know to refresh.
export const propertyVersion = ref(0);
export function bumpPropertyVersion(): void {
  propertyVersion.value++;
}
