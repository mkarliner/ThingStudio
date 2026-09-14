<!--
  editor/src/app/rete/CredentialRefField.vue

  Credential storage (docs/working-notes/outstanding-items/
  credential-storage-design.md, confirmed with Mike 2026-09-13): the
  dropdown/pencil/+ widget for a WiFi or MQTT-broker credential, one level
  down from ConfigRefField.vue's own "Server"-dropdown pattern -- Mike's
  own words for the ask: "drop down of existing, saved credentials, form
  for new (or editing) credentials." Structurally a close cousin of
  ConfigRefField.vue, but genuinely different in one way that file's own
  header calls out as the reason this isn't just a second `configType`
  entry there: this widget is backend-fetch-backed (async, can fail --
  network down, backend unreachable) rather than reading a synchronous
  in-memory Map, and its options come from `listCredentials()`
  (admin-api-client.ts) rather than store.ts's `configs`.

  Bound via v-model to a config's own `properties.credentialName` (a
  plain string, the credential's name/identity -- not an id the way
  ConfigRefField's `modelValue` is), from inside ConfigRefField.vue's own
  edit panel (that file's `f.kind === 'credential'` branch) -- this widget
  never appears directly in PropertyPanel.vue.

  Renaming an existing credential is out of scope (credential-storage-
  design.md's decisions, item 2) -- the pencil edit only lets you change
  an existing credential's *values*, never its name; only "+" lets you
  type a new name, for a brand new credential.

  Errors (backend unreachable, a rejected save) are shown inline in this
  widget rather than routed to the device console the way PaletteSidebar.
  vue's custom-node-load failures are -- there's no simple emit path from
  here up through ConfigRefField.vue's own edit panel to main.ts today,
  and a fetch failure here is tied to a specific field the user is looking
  right at, so showing it right there is at least as good a spot for it.
-->
<template>
  <div class="credential-ref-field">
    <label>{{ fieldLabel }}
      <div class="credential-ref-row">
        <select :value="modelValue ?? ''" @change="onSelect(($event.target as HTMLSelectElement).value)" :disabled="loading">
          <option value="" disabled>{{ loading ? "loading..." : `select ${descriptor.label}...` }}</option>
          <option v-for="name in names" :key="name" :value="name">{{ name }}</option>
        </select>
        <button type="button" class="icon-btn" title="edit" :disabled="!modelValue" @click="openEdit(modelValue!)">&#9998;</button>
        <button type="button" class="icon-btn" title="add new" @click="addNew">+</button>
      </div>
    </label>
    <p v-if="error" class="credential-error">{{ error }}</p>

    <div v-if="editing" class="credential-edit-panel">
      <div class="credential-edit-header">{{ isNew ? `new ${descriptor.label}` : `editing "${editingOriginalName}"` }}</div>
      <label v-if="isNew" class="field-row">
        <span class="field-label">name</span>
        <input v-model="draftName" placeholder="e.g. home-wifi" />
      </label>
      <label v-for="f in descriptor.fields" :key="f.name" class="field-row">
        <span class="field-label">{{ f.label }}</span>
        <input :type="f.kind === 'password' ? 'password' : f.kind === 'number' ? 'number' : 'text'" v-model="draft[f.name] as any" />
      </label>
      <p v-if="editError" class="credential-error">{{ editError }}</p>
      <div class="credential-edit-actions">
        <button type="button" :disabled="saving" @click="saveEdit">{{ saving ? "saving..." : "Save" }}</button>
        <button type="button" @click="closeEdit">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { backendWsUrl } from "./store";
import { CREDENTIAL_TYPES, type CredentialType } from "./credential-types";
import { AdminApiError, listCredentials, getCredential, putCredential } from "../../flow-file/admin-api-client";

const props = defineProps<{
  credentialType: CredentialType;
  modelValue: string | undefined;
  label?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [name: string] }>();

const descriptor = computed(() => {
  const d = CREDENTIAL_TYPES[props.credentialType];
  if (!d) throw new Error(`CredentialRefField: no credential-types.ts entry for "${props.credentialType}"`);
  return d;
});
const fieldLabel = computed(() => props.label ?? descriptor.value.label);

const names = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    names.value = await listCredentials(backendWsUrl.value, props.credentialType);
  } catch (err) {
    error.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
void refresh();
// A saved credential can be added/edited from a different node's field
// bound to the same credentialType elsewhere on the canvas -- re-fetch
// whenever this instance's own type changes, and whenever its modelValue
// changes out from under it (e.g. a flow load resolving a new selection),
// so a stale list from an earlier mount doesn't linger.
watch(() => props.credentialType, refresh);

function onSelect(name: string): void {
  if (!name) return;
  emit("update:modelValue", name);
}

const editing = ref(false);
const isNew = ref(false);
const editingOriginalName = ref("");
const draftName = ref("");
const draft = reactive<Record<string, unknown>>({});
const editError = ref<string | null>(null);
const saving = ref(false);

async function openEdit(name: string): Promise<void> {
  if (!name) return;
  editError.value = null;
  isNew.value = false;
  editingOriginalName.value = name;
  editing.value = true;
  for (const key of Object.keys(draft)) delete draft[key];
  Object.assign(draft, descriptor.value.defaults);
  try {
    const data = await getCredential(backendWsUrl.value, props.credentialType, name);
    Object.assign(draft, data);
  } catch (err) {
    editError.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  }
}

function addNew(): void {
  editError.value = null;
  isNew.value = true;
  editingOriginalName.value = "";
  draftName.value = "";
  for (const key of Object.keys(draft)) delete draft[key];
  Object.assign(draft, descriptor.value.defaults);
  editing.value = true;
}

async function saveEdit(): Promise<void> {
  const name = isNew.value ? draftName.value.trim() : editingOriginalName.value;
  if (!name) {
    editError.value = "name is required";
    return;
  }
  saving.value = true;
  editError.value = null;
  try {
    await putCredential(backendWsUrl.value, props.credentialType, name, { ...draft });
    await refresh();
    emit("update:modelValue", name);
    editing.value = false;
  } catch (err) {
    editError.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

function closeEdit(): void {
  editing.value = false;
}

// Same stale-panel guard ConfigRefField.vue's own header explains for its
// analogous watch -- if the bound credentialName changes out from under
// an open edit panel (a different node's field, or a flow load
// resolving), close it rather than keep editing the wrong thing.
watch(
  () => props.modelValue,
  (next) => {
    if (editing.value && !isNew.value && next !== editingOriginalName.value) editing.value = false;
  },
);
</script>

<style scoped>
.credential-ref-field {
  margin-bottom: 8px;
}
.credential-ref-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.credential-ref-row select {
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
.credential-error {
  color: #e08080;
  font-size: 11px;
  margin: 4px 0 0;
}
.credential-edit-panel {
  margin-top: 6px;
  padding: 8px;
  background: #17171a;
  border: 1px solid #333;
  border-radius: 4px;
}
.credential-edit-header {
  font-size: 11px;
  color: #999;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* Same field-name-and-input-on-one-row treatment as ConfigRefField.vue's
   own `.field-row` -- see that file's header/style comment for why the
   plain `<label>text<input></label>` default doesn't already do this. */
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.field-row .field-label {
  flex: 0 0 auto;
  min-width: 70px;
  color: #999;
}
.field-row input {
  flex: 1 1 auto;
  min-width: 0;
}
.credential-edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.credential-edit-actions button {
  flex: 1 1 auto;
  background: #2a2a30;
  border: 1px solid #444;
  color: #eee;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
.credential-edit-actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
