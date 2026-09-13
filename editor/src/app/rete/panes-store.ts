// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/panes-store.ts
//
// Multiple panes for one large flow, still one flow (2026-09-13,
// outstanding-items/multi-pane-canvas.md) -- reactive store mirroring
// store.ts's own established shape (a handful of module-level `ref`s plus
// plain mutator functions, PropertyPanel.vue/ThingstudioNode.vue/
// ThingstudioConnection.vue read from it directly). Given its own file
// rather than folded into store.ts, matching how custom-nodes-store.ts
// got its own file for a comparably-sized new concern rather than
// growing store.ts further.
//
// What this store is NOT: it does not hold node data, and it is not the
// compiler's source of truth. Every canvas node lives in the real Rete
// `editor`/`area` at all times regardless of which pane is currently
// displayed -- main.ts's currentSource() (toGraphData(reteEditor, ...))
// and extractCanvasSnapshot() (save) both always read the *whole* live
// graph, every pane's nodes included, because this is still one flow,
// one compile/deploy unit (multi-pane-canvas.md's central requirement).
// Only the *visual* rendering is pane-scoped: ThingstudioNode.vue/
// ThingstudioConnection.vue read `activePaneId`/`nodePane` below (via
// `isNodeInActivePane()`) to decide whether to actually render -- CSS
// `visibility:hidden` for a hidden node (ThingstudioNode.vue's own
// comment has the full story: confirmed hands-on reading rete-render-
// utils' source, a `display:none` node's `offsetParent` goes null, and
// that library's own socket-position code retries forever rather than
// failing when that happens, for every connection touching it) and a
// template `v-if` for a hidden connection. Cross-pane wires can't exist
// (multi-pane-canvas.md's resolved design: MVP wires stay within one
// pane, enforced structurally by there being no visible node in another
// pane to drag a wire to), so a connection's two endpoints are always
// both hidden or both visible together -- never split.
//
// `nodePane`/`nodePaneVersion` follow store.ts's own `configs`/
// `configsVersion` pattern exactly: `ref<Map<...>>()` is NOT deeply
// reactive in Vue 3 (mutating the Map in place, `.set()`/`.delete()`,
// triggers nothing), so every mutator here also bumps `nodePaneVersion`,
// and any computed that needs to react to a pane-membership change reads
// `nodePaneVersion.value` first to establish the real tracked dependency
// (same "off-Vue-reactivity signal" store.ts's own header describes for
// `propertyVersion`/`configsVersion`).
//
// Node-delete upkeep (this file's one piece with no library doing it for
// free, per multi-pane-canvas.md's own resolved-design writeup): a node's
// `nodePane` entry has to be actively removed when the node itself is
// deleted, unlike `layout`'s live counterpart (rete-area-plugin's
// AreaPlugin), which handles this automatically. editor-setup.ts calls
// `forgetNode()` below from every one of its own node-removal paths
// (deleteSelected(), clear(), deletePane()) -- see that file for the
// call sites.

import { ref } from "vue";
import { selectedNode, selectedConnection, clearNodeSelection } from "./store";
import { DEFAULT_PANE_ID, DEFAULT_PANE_NAME, type FlowFilePane } from "../../flow-file/flow-file";

export const panes = ref<FlowFilePane[]>([{ id: DEFAULT_PANE_ID, name: DEFAULT_PANE_NAME }]);
export const activePaneId = ref<string>(DEFAULT_PANE_ID);

// nodeId -> pane id. See this file's header for why this is a plain Map
// behind a version counter, not a deeply-reactive structure.
export const nodePane = ref<Map<string, string>>(new Map());
export const nodePaneVersion = ref(0);
function bumpNodePaneVersion(): void {
  nodePaneVersion.value++;
}

// Monotonic, never reused even across deletions -- same "Sheet1, Sheet2,
// Sheet3..." convention every spreadsheet/browser-tab UI already uses,
// and the same reasoning: reusing a freed number after a delete is more
// surprising than just not reusing it (a user who deleted "Flow 02" and
// then adds a new pane would find it confusing for the new one to also
// be called "Flow 02"). Starts at 2 -- pane 1 (DEFAULT_PANE_ID/NAME
// above) already claims "01".
let nextPaneNumber = 2;

/** "Flow nn" (Mike, 2026-09-13) -- zero-padded to 2 digits to match
 * DEFAULT_PANE_NAME's own "Flow 01"; a 3-digit-or-longer flow document
 * just gets a longer number, same as any zero-padded counter. */
function nextPaneName(): string {
  return `Flow ${String(nextPaneNumber++).padStart(2, "0")}`;
}

/** Creates a new pane, appended after every existing one (creation order
 * -- no reordering yet, multi-pane-canvas.md's MVP scope) and returns its
 * id. Does NOT switch the active pane -- callers that want "add and
 * switch to it" (PaneTabs.vue's "+" button) call setActivePane()
 * themselves right after, same two-step shape addPane()/setActivePane()
 * already needed independently (e.g. a future "add pane, stay where you
 * are" caller). */
export function addPane(): string {
  const id = crypto.randomUUID();
  panes.value = [...panes.value, { id, name: nextPaneName() }];
  return id;
}

/** Throws for an unknown id -- a caller passing a stale/unknown pane id
 * is a programmer error worth failing loudly on, same CLAUDE.md
 * fault-handling priority store.ts's updateConfig() already applies to
 * its own analogous "id not found" case. */
export function renamePane(id: string, name: string): void {
  const pane = panes.value.find((p) => p.id === id);
  if (!pane) throw new Error(`panes-store.ts: renamePane() called with unknown pane id "${id}"`);
  pane.name = name;
  panes.value = [...panes.value]; // reassign .value -- plain array mutation alone doesn't notify Vue
}

export function setActivePane(id: string): void {
  if (id === activePaneId.value) return;
  activePaneId.value = id;
  // A node selected in the pane just left is about to become invisible
  // (CSS-hidden, ThingstudioNode.vue) -- keeping it "selected" would leave
  // PropertyPanel.vue showing a node the user can no longer see on
  // screen, the same confusing state clicking empty canvas already
  // exists to avoid (editor-setup.ts's container pointerdown listener).
  selectedNode.value = null;
  selectedConnection.value = null;
  clearNodeSelection.value?.();
}

export function assignNodeToActivePane(nodeId: string): void {
  nodePane.value.set(nodeId, activePaneId.value);
  bumpNodePaneVersion();
}

/** Node-delete upkeep -- see this file's header. A no-op if the node has
 * no tracked pane (already forgotten, or never assigned -- harmless
 * either way). */
export function forgetNode(nodeId: string): void {
  if (nodePane.value.delete(nodeId)) bumpNodePaneVersion();
}

/** Which pane a node belongs to, falling back to the first pane for a
 * node with no tracked entry -- same missing-entry leniency flow-file.ts's
 * parseFlowFile()/FlowFile.paneOf doc comment already establishes for the
 * persisted form of this same map. */
export function paneOfNode(nodeId: string): string {
  return nodePane.value.get(nodeId) ?? panes.value[0]!.id;
}

export function isNodeInActivePane(nodeId: string): boolean {
  return paneOfNode(nodeId) === activePaneId.value;
}

/** Replaces the whole store -- used when a flow file loads (main.ts's
 * applyFlowFile()) and by resetPanes() below (clear canvas). Not a
 * merge: a freshly loaded flow's panes fully replace whatever was there
 * before, matching applyFlowFile()'s own clear-then-repopulate treatment
 * of the canvas itself and store.ts's replaceAllConfigs()'s identical
 * contract for configs. `nodeIds` is every node the caller is about to
 * place on the canvas (applyFlowFile()'s own node list) -- any id absent
 * from `paneOf` (a pre-panes flow file, flow-file.ts's own backward-
 * compatibility default) gets `newPanes[0]` here, the single point where
 * that missing-entry fallback actually happens (flow-file.ts's parser
 * deliberately leaves it to the caller -- see FlowFile.paneOf's doc
 * comment). `nextPaneNumber` is reset past every loaded pane's own "Flow
 * nn" suffix (where it parses as one) so a freshly added pane after a
 * load never collides with a loaded name -- best-effort only, a
 * hand-renamed pane not matching that pattern doesn't move the counter,
 * same as a user renaming "Flow 02" to something else today doesn't free
 * up "02" for reuse (this file's own "never reused" comment on
 * nextPaneNumber, one section up). */
export function replacePanesFromFlowFile(newPanes: FlowFilePane[], paneOf: Record<string, string>, nodeIds: string[]): void {
  panes.value = newPanes;
  activePaneId.value = newPanes[0]!.id;
  const map = new Map<string, string>();
  for (const id of nodeIds) map.set(id, paneOf[id] ?? newPanes[0]!.id);
  nodePane.value = map;
  bumpNodePaneVersion();
  let maxSeen = 1;
  for (const p of newPanes) {
    const m = /^Flow (\d+)$/.exec(p.name);
    if (m) maxSeen = Math.max(maxSeen, Number(m[1]));
  }
  nextPaneNumber = maxSeen + 1;
}

/** Clear canvas (main.ts's "Clear canvas" button) -- back to the single
 * starting pane, same as a brand new flow. */
export function resetPanes(): void {
  panes.value = [{ id: DEFAULT_PANE_ID, name: DEFAULT_PANE_NAME }];
  activePaneId.value = DEFAULT_PANE_ID;
  nodePane.value = new Map();
  bumpNodePaneVersion();
  nextPaneNumber = 2;
}

/** Every node id currently assigned to `paneId` -- deletePane()
 * (editor-setup.ts) uses this to know which live Rete nodes to remove. */
export function nodeIdsInPane(paneId: string): string[] {
  return [...nodePane.value.entries()].filter(([, p]) => p === paneId).map(([id]) => id);
}

/** Removes a pane from the store (NOT its nodes -- editor-setup.ts's
 * deletePane() removes those from the real Rete editor first, then calls
 * forgetNode() for each, then this). Refuses to remove the last
 * remaining pane -- there must always be at least one (flow-file.ts's
 * parseFlowFile() enforces the same invariant on load: `"panes" must
 * have at least one entry`) -- returns false rather than throwing, since
 * this is a reachable UI state (PaneTabs.vue should simply not offer "X"
 * on the only remaining tab), not a programmer error. Switches the
 * active pane to whatever's first afterward if the removed pane was the
 * active one. */
export function removePane(id: string): boolean {
  if (panes.value.length <= 1) return false;
  const idx = panes.value.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  panes.value = panes.value.filter((p) => p.id !== id);
  if (activePaneId.value === id) setActivePane(panes.value[0]!.id);
  return true;
}
