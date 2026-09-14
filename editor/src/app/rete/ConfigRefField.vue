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

  Credential storage (2026-09-13, credential-storage-design.md): the edit
  panel's per-field loop above gains a `f.kind === 'credential'` branch,
  rendering `CredentialRefField.vue` instead of a plain input for the
  WiFi/MQTT-broker config types' own `credentialName` field -- one more
  case in the same per-kind dispatch `select` vs. plain `input` already
  used, not a parallel mechanism.

  Auto-save, no outer Save button (2026-09-13, same day, Mike's own
  hands-on report): with a credential field in the mix, the original
  Save/Close pair here stacked on top of CredentialRefField's own
  Save/Close for the nested credential-create form -- two Saves doing two
  different things (this panel's own persisting `credentialName`/
  `security` onto the config; the nested one persisting the credential's
  actual values to the backend) right next to each other reads as one
  confusing double-save, not two distinct steps. Fixed by auto-committing
  `draft` to the config on every change (a `watch(draft, ..., {deep:
  true})`) and dropping this panel down to a single "Close" -- the only
  explicit Save left anywhere in the whole widget is CredentialRefField's
  own, which is unavoidably a real, separate, backend-persisted action.

  "+" creates one named thing, not an anonymous config plus a second,
  nested "+" (2026-09-13, same day, Mike's own direct ask: "I'd expect to
  be able to give it a name, and then ssid and passwd"). The original "+"
  called `createConfig()` immediately with empty defaults, then opened
  this same edit panel on that brand-new, still-nameless config --
  correct as to *state* (a config with an empty `credentialName` really
  does need a credential) but wrong as *UX*: the dropdown showing
  "(unnamed WiFi #...)" the instant you'd clicked "+" reads as broken, and
  actually finishing the job took a second "+" (CredentialRefField's own,
  nested inside this now-open panel) just to give the thing a name at
  all. Fixed by giving `addNew()` its own combined form (`creatingNew`
  below) for any config type with a `credential` field -- one name input,
  the credential type's own fields (`ssid`/`password`, etc.), and any
  other config-level fields (`security`) in a single panel, one Save,
  creating the credential AND the config together. A config type with NO
  credential field (none exist today, but the branch stays correct for
  one) falls back to the original create-then-edit behavior -- the same
  fallback the field-loop above already carries for non-credential kinds.

  Top-level dropdown also lists saved-but-not-yet-used credentials
  (2026-09-14, Mike's own report: a brand-new flow's WiFi dropdown showed
  empty even though he already had several saved WiFi credentials from
  editing other flows -- correct as to *state*, since a fresh flow really
  has zero `configs` of its own, but useless as UX when the whole point of
  a named credential store is picking one you already saved). `options`
  now merges this flow's own configs (as before) with every backend
  credential name of this type NOT already referenced by one of them --
  picking one of those auto-creates a matching config on the spot (or
  reuses one if some other node in this flow already made it), same
  one-click outcome as if it had existed here all along. `credentialNames`
  is fetched once on mount and again after this widget's own `saveNew()`
  creates one; it does not react to a credential created elsewhere (a
  different node's own ConfigRefField, or CredentialRefField's nested
  "+") -- acceptable for now (a page reload picks it up), revisit only if
  that gap actually bites someone.
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
      <template v-for="f in descriptor.fields" :key="f.name">
        <!-- CredentialRefField renders its own label (it needs to, for its
             standalone use inside PropertyPanel.vue in principle, even
             though today it's only ever used here) -- wrapping it in this
             loop's own `<label>{{f.label}}</label>` too, the way every
             other field kind below needs, stacked two labels on top of
             each other ("credential" then "WiFi credential"). Skip that
             outer label for this one kind and pass this field's own label
             down instead, so there's exactly one. -->
        <CredentialRefField
          v-if="f.kind === 'credential'"
          :credential-type="f.credentialType!"
          :model-value="(draft[f.name] as string) || undefined"
          :label="f.label"
          @update:model-value="(name) => { draft[f.name] = name; }"
        />
        <label v-else class="field-row">
          <span class="field-label">{{ f.label }}</span>
          <select v-if="f.kind === 'select'" v-model="draft[f.name] as any">
            <option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <input v-else :type="f.kind === 'password' ? 'password' : f.kind === 'number' ? 'number' : 'text'" v-model="draft[f.name] as any" />
        </label>
      </template>
      <div class="config-edit-actions">
        <button type="button" @click="closeEdit">Close</button>
      </div>
    </div>

    <div v-if="creatingNew" class="config-edit-panel">
      <div class="config-edit-header">new {{ descriptor.label }}</div>
      <label class="field-row">
        <span class="field-label">name</span>
        <input v-model="newName" placeholder="e.g. home-wifi" />
      </label>
      <label v-for="cf in credentialDescriptor?.fields ?? []" :key="cf.name" class="field-row">
        <span class="field-label">{{ cf.label }}</span>
        <input
          :type="cf.kind === 'password' ? 'password' : cf.kind === 'number' ? 'number' : 'text'"
          v-model="newCredentialDraft[cf.name] as any"
        />
      </label>
      <label v-for="f in otherFields" :key="f.name" class="field-row">
        <span class="field-label">{{ f.label }}</span>
        <select v-if="f.kind === 'select'" v-model="newConfigDraft[f.name] as any">
          <option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <input
          v-else
          :type="f.kind === 'password' ? 'password' : f.kind === 'number' ? 'number' : 'text'"
          v-model="newConfigDraft[f.name] as any"
        />
      </label>
      <p v-if="createError" class="field-error">{{ createError }}</p>
      <div class="config-edit-actions">
        <button type="button" :disabled="creating" @click="saveNew">{{ creating ? "saving..." : "Save" }}</button>
        <button type="button" @click="cancelNew">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { backendWsUrl, configs, configsVersion, createConfig, getConfig, listConfigsOfType, updateConfig } from "./store";
import { CONFIG_TYPES } from "./config-types";
import { CREDENTIAL_TYPES } from "./credential-types";
import { AdminApiError, listCredentials, putCredential } from "../../flow-file/admin-api-client";
import CredentialRefField from "./CredentialRefField.vue";

// Prefixes a not-yet-used saved credential's name in the merged dropdown's
// `<option value>` -- lets onSelect() tell "pick this existing config" (a
// real id, from store.ts's crypto.randomUUID()) apart from "provision a
// config for this saved-but-unreferenced credential" without a parallel
// data shape for the dropdown's own options.
const CREDENTIAL_OPTION_PREFIX = "credential:";

// Sentinel `<option value>` for "unmanaged, no credential at all" --
// distinct from CREDENTIAL_OPTION_PREFIX's namespaced-by-name values,
// since there's nothing to name (2026-09-14, Mike's own report: no way to
// pick this at all once "+" started requiring a name/credential to create
// anything -- see UNMANAGED_SECURITY_VALUE's own header comment below).
const UNMANAGED_OPTION_ID = "__unmanaged__";
// The one config-level select value this generic widget knows by name,
// not just by kind -- config-types.ts's WiFi `security` field is the only
// place it's declared today. `security: "unmanaged"` means "this config
// intentionally has no credential; the referencing node brings the
// interface up without connecting" (wifi-status.ts's wifiSetupStatement
// returns before ever looking at ssid/password for this value) -- so
// unlike every other config, an unmanaged one needs no named credential
// to exist at all. Before this fix the only way to reach it was: create
// any other config first, then flip its security select via the pencil --
// reachable, but not from a blank canvas, and not obviously so.
const UNMANAGED_SECURITY_VALUE = "unmanaged";

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

const credentialNames = ref<string[]>([]);

async function refreshCredentialNames(): Promise<void> {
  const credField = credentialField.value;
  if (!credField?.credentialType) {
    credentialNames.value = [];
    return;
  }
  try {
    credentialNames.value = await listCredentials(backendWsUrl.value, credField.credentialType);
  } catch {
    // Same posture as CredentialRefField.vue's own refresh(): a failed
    // fetch here just means the merged list falls back to "this flow's
    // own configs only" -- not worth its own error UI on top of that
    // widget's, which the pencil/+ panel already surfaces.
    credentialNames.value = [];
  }
}
onMounted(refreshCredentialNames);

// The "security"-kind field (if any) that declares an "unmanaged" choice
// -- only WiFi has one today, but this derives it from config-types.ts's
// own field/option data rather than hardcoding "security"/"unmanaged" to
// a specific configType, matching this component's existing generic-not-
// WiFi-specific stance (see file header).
const unmanagedField = computed(() =>
  otherFields.value.find((f) => f.kind === "select" && f.options?.some((o) => o.value === UNMANAGED_SECURITY_VALUE)),
);

const options = computed(() => {
  configsVersion.value; // reactive dependency -- see header comment
  const credField = credentialField.value;
  const existing = listConfigsOfType(props.configType);
  const configOptions = existing.map((c) => ({
    id: c.id,
    summary: descriptor.value.summarize(c.properties) || `(unnamed ${descriptor.value.label} #${c.id.slice(0, 6)})`,
  }));
  if (!credField) return configOptions;
  const alreadyUsed = new Set(
    existing.map((c) => c.properties[credField.name]).filter((v): v is string => typeof v === "string" && v !== ""),
  );
  const credentialOnlyOptions = credentialNames.value
    .filter((name) => !alreadyUsed.has(name))
    .map((name) => ({ id: `${CREDENTIAL_OPTION_PREFIX}${name}`, summary: name }));
  const uField = unmanagedField.value;
  const unmanagedAlreadyExists =
    uField && existing.some((c) => !c.properties[credField.name] && c.properties[uField.name] === UNMANAGED_SECURITY_VALUE);
  const unmanagedOption =
    uField && !unmanagedAlreadyExists
      ? [{ id: UNMANAGED_OPTION_ID, summary: uField.options!.find((o) => o.value === UNMANAGED_SECURITY_VALUE)!.label }]
      : [];
  return [...configOptions, ...credentialOnlyOptions, ...unmanagedOption];
});

const selected = computed(() => {
  configsVersion.value;
  return props.modelValue ? (configs.value.get(props.modelValue) ?? null) : null;
});

function onSelect(id: string): void {
  if (!id) return;
  if (id === UNMANAGED_OPTION_ID) {
    const credField = credentialField.value;
    const uField = unmanagedField.value;
    if (!credField || !uField) return; // unreachable -- this option only exists when both are set, see `options` above
    const existing = listConfigsOfType(props.configType).find(
      (c) => !c.properties[credField.name] && c.properties[uField.name] === UNMANAGED_SECURITY_VALUE,
    );
    const newId =
      existing?.id ??
      createConfig(props.configType, { ...descriptor.value.defaults, [credField.name]: "", [uField.name]: UNMANAGED_SECURITY_VALUE });
    emit("update:modelValue", newId);
    return;
  }
  if (id.startsWith(CREDENTIAL_OPTION_PREFIX)) {
    const name = id.slice(CREDENTIAL_OPTION_PREFIX.length);
    const credField = credentialField.value;
    if (!credField) return; // unreachable -- these options only exist when credField is set, see `options` above
    // Reuse a config some other node in this flow already made for this
    // same credential, rather than creating a second one that resolves to
    // an identical value -- `options` already excludes an in-use name, but
    // a stale render (double-click, e.g.) could still race this.
    const existing = listConfigsOfType(props.configType).find((c) => c.properties[credField.name] === name);
    const newId = existing ? existing.id : createConfig(props.configType, { ...descriptor.value.defaults, [credField.name]: name });
    emit("update:modelValue", newId);
    return;
  }
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

// The one field of kind "credential" this config type declares, if any --
// drives which "+" behavior applies (see header comment). Every config
// type today has exactly one; the code doesn't assume that, just that
// there's at most one credential-shaped field per config type.
const credentialField = computed(() => descriptor.value.fields.find((f) => f.kind === "credential"));
const otherFields = computed(() => descriptor.value.fields.filter((f) => f.kind !== "credential"));
const credentialDescriptor = computed(() => {
  const f = credentialField.value;
  return f?.credentialType ? (CREDENTIAL_TYPES[f.credentialType] ?? null) : null;
});

const creatingNew = ref(false);
const newName = ref("");
const newCredentialDraft = reactive<Record<string, unknown>>({});
const newConfigDraft = reactive<Record<string, unknown>>({});
const createError = ref<string | null>(null);
const creating = ref(false);

function addNew(): void {
  const credField = credentialField.value;
  if (!credField) {
    // No credential field on this config type -- nothing to combine into
    // one form; fall back to the original create-then-edit behavior.
    const id = createConfig(props.configType, { ...descriptor.value.defaults });
    emit("update:modelValue", id);
    openEdit(id);
    return;
  }
  createError.value = null;
  newName.value = "";
  for (const key of Object.keys(newCredentialDraft)) delete newCredentialDraft[key];
  Object.assign(newCredentialDraft, credentialDescriptor.value?.defaults ?? {});
  for (const key of Object.keys(newConfigDraft)) delete newConfigDraft[key];
  for (const f of otherFields.value) newConfigDraft[f.name] = descriptor.value.defaults[f.name];
  creatingNew.value = true;
}

async function saveNew(): Promise<void> {
  const credField = credentialField.value;
  if (!credField?.credentialType) return;
  const name = newName.value.trim();
  if (!name) {
    createError.value = "name is required";
    return;
  }
  creating.value = true;
  createError.value = null;
  try {
    await putCredential(backendWsUrl.value, credField.credentialType, name, { ...newCredentialDraft });
    const id = createConfig(props.configType, { ...descriptor.value.defaults, ...newConfigDraft, [credField.name]: name });
    emit("update:modelValue", id);
    creatingNew.value = false;
    void refreshCredentialNames();
  } catch (err) {
    createError.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  } finally {
    creating.value = false;
  }
}

function cancelNew(): void {
  creatingNew.value = false;
}

// Auto-save: every change to `draft` (a field's own input, or
// CredentialRefField reporting a newly picked/created credential name)
// commits straight to the config -- see header comment. `deep: true`
// since `draft` is a plain reactive record, not individual refs.
watch(
  draft,
  () => {
    if (editingId.value) updateConfig(editingId.value, { ...draft });
  },
  { deep: true },
);

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
/* Field name and its own input/select on one row, next field wrapping to
   the row below -- Mike's own explicit ask, 2026-09-14, over the plain
   `<label>text<input></label>` default (an inline label around an inline-
   flowing input just runs every field together as one paragraph, wrapping
   wherever the browser finds room rather than one row per field). */
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
.field-row input,
.field-row select {
  flex: 1 1 auto;
  min-width: 0;
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
.config-edit-actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
.field-error {
  color: #e08080;
  font-size: 11px;
  margin: 4px 0 0;
}
</style>
