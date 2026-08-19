<!--
  editor/src/app/rete/ConfigRefField.vue

  Config nodes (config-node-and-palette-implementation-briefing.md): the
  generic dropdown/pencil/+ widget Mike's Node-RED screenshot names --
  "Server" field pattern. One reusable component, parameterized by a
  `configType` key into config-types.ts's descriptor table, not a
  WiFi-specific one-off -- a second config type costs a config-types.ts
  entry plus a PropertyPanel.vue field, not a new component (briefing's
  own explicit ask).

  Bound via v-model to a node property holding a config id (e.g.
  `node.properties.wifiConfigId`) -- `modelValue`/`update:modelValue`,
  ordinary Vue v-model convention. The "edit one config's properties"
  surface is a simple inline expand (text inputs, Save/Close), not a modal
  -- CLAUDE.md's "cheapest implementation that's actually correct"
  applies directly here per the briefing; don't over-build the editing
  chrome for a first version of this widget.

  Reactivity note: `configs`/`configsVersion` (store.ts) are read directly
  here (not passed as props) -- same pattern PropertyPanel.vue's own
  `node`/`propertyVersion` computed already establishes for the
  off-Vue-reactivity mutation problem (Rete nodes and this store's plain
  Map aren't deeply Vue-reactive on their own).
-->
<template>
  <div class="config-ref-field">
    <label>{{ fieldLabel }}
      <div class="config-ref-row">
        <select :value="modelValue ?? ''" @change="onSelect(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>select {{ descriptor.label }}...</option>
          <option v-for="opt in options" :key="opt.id" :value="opt.id">{{ opt.summary }}</option>
        </select>
        <button
          type="button"
          class="icon-btn"
          title="edit"
          :disabled="!selected"
          @click="openEdit(selected!.id)"
        >&#9998;</button>
        <button type="button" class="icon-btn" title="add new" @click="addNew">+</button>
      </div>
    </label>

    <div v-if="editingId" class="config-edit-panel">
      <div class="config-edit-header">editing {{ descriptor.label }} <span class="config-edit-id">#{{ editingId.slice(0, 6) }}</span></div>
      <label v-for="f in descriptor.fields" :key="f.name">
        {{ f.label }}
        <input :type="f.kind === 'password' ? 'password' : f.kind === 'number' ? 'number' : 'text'" v-model="draft[f.name] as any" />
      </label>
      <div class="config-edit-actions">
        <button type="button" @click="saveEdit">Save</button>
        <button type="button" @click="closeEdit">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { configs, configsVersion, createConfig, getConfig, listConfigsOfType, updateConfig } from "./store";
import { CONFIG_TYPES } from "./config-types";

const props = defineProps<{
  configType: string;
  modelValue: string | undefined;
  /** Overrides config-types.ts's own label, e.g. "wifi network" instead of
   * the type's generic "WiFi" -- optional, most callers don't need it. */
  label?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [id: string] }>();

const descriptor = computed(() => {
  const d = CONFIG_TYPES[props.configType];
  if (!d) throw new Error(`ConfigRefField: no config-types.ts entry for "${props.configType}"`);
  return d;
});
const fieldLabel = computed(() => props.label ?? descriptor.value.label);

const options = computed(() => {
  configsVersion.value; // reactive dependency -- see header comment
  return listConfigsOfType(props.configType).map((c) => ({
    id: c.id,
    summary: descriptor.value.summarize(c.properties) || `(unnamed ${descriptor.value.label} #${c.id.slice(0, 6)})`,
  }));
});

const selected = computed(() => {
  configsVersion.value;
  return props.modelValue ? (configs.value.get(props.modelValue) ?? null) : null;
});

function onSelect(id: string): void {
  if (!id) return;
  emit("update:modelValue", id);
}

const editingId = ref<string | null>(null);
const draft = reactive<Record<string, unknown>>({});

function openEdit(id: string): void {
  const cfg = getConfig(id);
  if (!cfg) return;
  editingId.value = id;
  for (const key of Object.keys(draft)) delete draft[key];
  Object.assign(draft, descriptor.value.defaults, cfg.properties);
}

function addNew(): void {
  const id = createConfig(props.configType, { ...descriptor.value.defaults });
  emit("update:modelValue", id);
  openEdit(id);
}

function saveEdit(): void {
  if (!editingId.value) return;
  updateConfig(editingId.value, { ...draft });
}

function closeEdit(): void {
  editingId.value = null;
}

// If the bound property points at a config that gets deleted elsewhere
// (no delete UI exists yet, so unreachable today, but cheap insurance --
// same "don't trust a stale reference blindly" instinct as store.ts's
// updateConfig() guard) or the field is reused for a different node whose
// modelValue changes out from under an open edit panel, close the stale
// panel rather than silently keep editing the wrong thing.
watch(
  () => props.modelValue,
  (next) => {
    if (editingId.value && next !== editingId.value) editingId.value = null;
  },
);
</script>

<style scoped>
.config-ref-field {
  margin-bottom: 8px;
}
.config-ref-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.config-ref-row select {
  flex: 1 1 auto;
  min-width: 0;
}
.icon-btn {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  background: #232328;
  border: 1px solid #444;
  color: #eee;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.config-edit-panel {
  margin-top: 6px;
  padding: 8px;
  background: #17171a;
  border: 1px solid #333;
  border-radius: 4px;
}
.config-edit-header {
  font-size: 11px;
  color: #999;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.config-edit-id {
  color: #666;
  text-transform: none;
  letter-spacing: normal;
}
.config-edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.config-edit-actions button {
  flex: 1 1 auto;
  background: #2a2a30;
  border: 1px solid #444;
  color: #eee;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
</style>
