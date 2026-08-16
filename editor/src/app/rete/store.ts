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
