<!--
  editor/src/app/rete/PaneTabs.vue

  Pane tab bar (2026-09-13, outstanding-items/multi-pane-canvas.md's
  resolved design): a "+" to add a pane, one tab per pane (click to
  switch, double-click the label to rename inline, "X" to remove), no
  reordering (MVP scope, deferred to post-MVP alongside the cross-pane
  wire affordance -- that same doc's own writeup). Mounted standalone via
  main.ts's createApp(...).mount(...), same two-small-Vue-apps pattern
  PaletteSidebar.vue/PropertyPanel.vue already established (that file's
  own header explains why this migration didn't fold the whole app shell
  into one Vue tree) -- positioned as an overlay bar pinned to the top of
  #canvas-wrap (index.html), not a flex sibling of #rete-canvas, so it
  doesn't touch that element's existing absolute-fill sizing (main.ts's
  own canvas-construction section, and rete-area-plugin's viewport math,
  both assume #rete-canvas fills its container exactly).

  Renaming/adding a pane are pure panes-store.ts mutations (no live Rete
  access needed) and happen directly in this component. Removing a pane
  is NOT -- it also has to delete the pane's nodes from the real Rete
  editor (multi-pane-canvas.md's resolved design: "removing a pane
  deletes its nodes"), which only main.ts's `reteHandle` can do
  (editor-setup.ts's deletePane()) -- so this component only confirms the
  destructive action and emits `deletePane`, mirroring PaletteSidebar.
  vue's own onAdd/onAddCustom emit-out-to-main.ts pattern for anything
  that isn't a pure store concern (camelCase event name, not kebab-case --
  matching that file's own `addCustom`/`customNodeLoaded` precedent
  exactly, rather than relying on Vue's kebab-to-camel `onXxx` prop
  auto-conversion working the way this codebase has never actually
  exercised before).
-->
<template>
  <div id="pane-tabs">
    <div
      v-for="pane in panes"
      :key="pane.id"
      class="pane-tab"
      :class="{ active: pane.id === activePaneId }"
      @click="select(pane.id)"
      @dblclick="beginRename(pane)"
    >
      <input
        v-if="renamingId === pane.id"
        ref="renameInputRef"
        v-model="renameDraft"
        class="pane-rename-input"
        @click.stop
        @dblclick.stop
        @keydown.enter="commitRename(pane.id)"
        @keydown.escape="renamingId = null"
        @blur="commitRename(pane.id)"
      />
      <span v-else class="pane-label" :title="'Double-click to rename'">{{ pane.name }}</span>
      <button class="pane-close" title="Remove this pane (and its nodes)" @click.stop="removeTab(pane)">×</button>
    </div>
    <button id="pane-add" title="Add a new pane" @click="addTab">+</button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { panes, activePaneId, setActivePane, addPane, renamePane, nodeIdsInPane, type FlowFilePane } from "./panes-store";

// Only "deletePane" crosses out to main.ts -- see this file's header for
// why add/rename stay local but remove doesn't.
const emit = defineEmits<{ deletePane: [id: string] }>();

function select(id: string): void {
  setActivePane(id);
}

function addTab(): void {
  setActivePane(addPane());
}

const renamingId = ref<string | null>(null);
const renameDraft = ref("");
const renameInputRef = ref<HTMLInputElement[] | HTMLInputElement | null>(null);

async function beginRename(pane: FlowFilePane): Promise<void> {
  renamingId.value = pane.id;
  renameDraft.value = pane.name;
  await nextTick();
  // v-for + ref gives an array (Vue's own documented behavior for a ref
  // inside v-for) even though only one instance is ever actually rendered
  // at a time here (v-if gates it to the one pane being renamed) --
  // normalized to a single element either way rather than assuming which
  // shape shows up.
  const el = Array.isArray(renameInputRef.value) ? renameInputRef.value[0] : renameInputRef.value;
  el?.focus();
  el?.select();
}

function commitRename(id: string): void {
  if (renamingId.value !== id) return; // already committed/cancelled (blur firing after Enter's own commit already ran)
  const trimmed = renameDraft.value.trim();
  if (trimmed !== "") renamePane(id, trimmed);
  renamingId.value = null;
}

function removeTab(pane: FlowFilePane): void {
  if (panes.value.length <= 1) return; // panes-store.ts's removePane() would refuse this anyway -- no dialog for a no-op
  const count = nodeIdsInPane(pane.id).length;
  const nodeWord = count === 1 ? "node" : "nodes";
  const question =
    count > 0
      ? `Delete pane "${pane.name}" and its ${count} ${nodeWord}? This cannot be undone.`
      : `Delete pane "${pane.name}"?`;
  // eslint-disable-next-line no-alert -- first destructive-confirmation
  // UI in this app (no existing precedent to match, grep-confirmed
  // 2026-09-13); the native dialog is the simplest correct choice for a
  // one-off "are you sure", not a placeholder for something fancier.
  if (!window.confirm(question)) return;
  emit("deletePane", pane.id);
}
</script>

<style scoped>
#pane-tabs {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px 4px 0;
  background: #161a21;
  border-bottom: 1px solid #2a3140;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  user-select: none;
}
.pane-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px 5px 10px;
  border-radius: 6px 6px 0 0;
  background: #10131a;
  color: #7c8698;
  cursor: pointer;
  border: 1px solid #2a3140;
  border-bottom: none;
  max-width: 160px;
}
.pane-tab:hover {
  color: #d8dee9;
}
.pane-tab.active {
  background: #16161a;
  color: #d8dee9;
  border-color: #4f9eff;
}
.pane-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane-rename-input {
  width: 90px;
  background: #0a0c10;
  color: #d8dee9;
  border: 1px solid #4f9eff;
  border-radius: 3px;
  font: inherit;
  padding: 1px 4px;
}
.pane-close {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  opacity: 0.6;
}
.pane-close:hover {
  opacity: 1;
  color: #e05555;
}
#pane-add {
  align-self: center;
  background: transparent;
  border: 1px solid #2a3140;
  border-radius: 4px;
  color: #7c8698;
  width: 20px;
  height: 20px;
  line-height: 1;
  cursor: pointer;
  font-size: 13px;
}
#pane-add:hover {
  color: #4f9eff;
  border-color: #4f9eff;
}
</style>
