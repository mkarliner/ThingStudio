<!--
  editor/src/app/rete/PresetRefField.vue

  Per-node presets (docs/working-notes/outstanding-items/presets-design.md,
  design confirmed with Mike 2026-09-22) -- MVP item 4 / road-to-mvp.md's
  "spi setup should be saveable with a name to be selected later." A
  structural cousin of CredentialRefField.vue (same dropdown/save-panel
  shape, same backend-fetch-backed async widget, same inline-error
  treatment), but genuinely simpler in one way and different in another:

  Simpler: there is no descriptor table the way CredentialRefField.vue's
  CREDENTIAL_TYPES gives it one, because a preset holds no fixed field set
  of its own -- it's just a snapshot of whatever's already in the node's
  own `properties` object right now. The node's existing PropertyPanel.vue
  fields already ARE the editing UI; this widget only needs to know how to
  serialize/apply that whole object, never which keys it has. That's why
  this component takes a live `properties` object directly (mutated in
  place on apply) rather than a `credentialType` key into a lookup table.

  Different: copy-on-apply, not a live reference. Selecting a preset here
  copies its saved JSON's keys onto `properties` once, right now, via
  `Object.assign` -- there is no persisted "which preset is this node using"
  link the way a config node's `credentialName` is a standing reference
  (CredentialRefField.vue's own header). A preset holds no secret, so
  nothing here needs the indirection credentials use to keep real values
  out of a shareable flow file; the whole point (Mike's own framing) is a
  flow file that stays self-contained and human-editable after applying
  one. `selectedName` below is therefore purely cosmetic -- which name
  currently populates the dropdown -- not a value written anywhere.

  Invalid presets (a hand-edited file that fails to parse -- presets are
  explicitly meant to be hand-edited outside the app) are listed but
  disabled, with a visible warning naming which ones and where to fix them:
  the "very obvious syntax error flagged" requirement Mike added when
  confirming the copy-on-apply design.

  Used inside PropertyPanel.vue's own per-kind template blocks (currently
  display_spi/display_i2c), one instance per kind, `:key="node.id"`'d by
  the caller so switching the selected node on canvas remounts this widget
  fresh rather than carrying over a stale `selectedName` from a different
  node instance of the same kind.
-->
<template>
  <div class="preset-ref-field">
    <label>{{ label }}
      <div class="preset-ref-row">
        <select :value="selectedName" @change="onSelect(($event.target as HTMLSelectElement).value)" :disabled="loading">
          <option value="" disabled>{{ loading ? "loading..." : "load preset..." }}</option>
          <option v-for="p in presets" :key="p.name" :value="p.name" :disabled="!p.valid">
            {{ p.name }}{{ p.valid ? "" : " (invalid)" }}
          </option>
        </select>
        <button type="button" class="icon-btn" title="save current values as a preset" @click="openSave">&#128190;</button>
        <button type="button" class="icon-btn" title="refresh" :disabled="loading" @click="refresh">&#8635;</button>
      </div>
    </label>
    <p v-if="error" class="preset-error">{{ error }}</p>
    <p v-if="invalidWarning" class="preset-error">{{ invalidWarning }}</p>

    <div v-if="showSavePanel" class="preset-save-panel">
      <label class="field-row">
        <span class="field-label">name</span>
        <input v-model="saveName" placeholder="e.g. cyd" />
      </label>
      <p v-if="saveError" class="preset-error">{{ saveError }}</p>
      <div class="preset-save-actions">
        <button type="button" :disabled="savingInFlight" @click="confirmSave">{{ savingInFlight ? "saving..." : "Save" }}</button>
        <button type="button" @click="showSavePanel = false">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { backendWsUrl } from "./store";
import { AdminApiError, listPresets, getPreset, putPreset, type PresetInfo } from "../../flow-file/admin-api-client";

const props = defineProps<{
  /** Node kind this widget saves/loads presets for, e.g. "display_spi" --
   * the `{type}` path segment in the admin API's `/api/presets/{type}`
   * routes. */
  presetType: string;
  /** The live node.properties object -- mutated in place on apply (see
   * this file's header on why copy-on-apply needs no v-model here). */
  properties: Record<string, unknown>;
  label?: string;
}>();

// Fires after a preset is applied onto `properties`, so the caller
// (PropertyPanel.vue) can call its own touch() -- same "mutation happens
// off-Vue, a separate signal drives the re-render" pattern
// setWifiConfigId()/setBrokerConfigId() already use there, just routed
// through an emit instead of a dedicated handler since this widget owns
// the mutation itself.
const emit = defineEmits<{ applied: [] }>();

const label = computed(() => props.label ?? "preset");

const presets = ref<PresetInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedName = ref("");

const invalidWarning = computed(() => {
  const broken = presets.value.filter((p) => !p.valid);
  if (broken.length === 0) return null;
  const names = broken.map((p) => p.name).join(", ");
  // Deliberately names the on-disk location, not just "something's wrong"
  // -- presets are meant to be hand-edited there, so the fix is "open that
  // file and look," and this message should get someone there without a
  // second question. Per-file reasons are in `error` on each PresetInfo,
  // shown as this widget's disabled option labels; not repeated here to
  // keep this one line scannable with several broken files at once.
  return `${broken.length === 1 ? "1 saved preset is" : `${broken.length} saved presets are`} invalid and can't be loaded: ${names} ` +
    `-- fix the JSON by hand in ~/.thingstudio/presets/${props.presetType}/`;
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    presets.value = await listPresets(backendWsUrl.value, props.presetType);
  } catch (err) {
    error.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
void refresh();
// A preset can be added/edited from a different node's field bound to the
// same presetType elsewhere on the canvas -- re-fetch on type change, same
// reasoning CredentialRefField.vue's own analogous watch gives.
watch(() => props.presetType, refresh);

async function onSelect(name: string): Promise<void> {
  if (!name) return;
  error.value = null;
  try {
    const data = await getPreset(backendWsUrl.value, props.presetType, name);
    // Copy-on-apply: every key the saved preset carries is written onto
    // this node's own properties object once, right now. Keys the node
    // doesn't have yet are added; keys the preset doesn't mention are left
    // untouched (a preset saved from a narrower/older version of this node
    // kind doesn't blow away fields it never knew about).
    Object.assign(props.properties, data);
    selectedName.value = name;
    emit("applied");
  } catch (err) {
    error.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  }
}

const showSavePanel = ref(false);
const saveName = ref("");
const saveError = ref<string | null>(null);
const savingInFlight = ref(false);

function openSave(): void {
  saveError.value = null;
  saveName.value = selectedName.value; // convenient default: overwrite the currently-loaded preset, if any
  showSavePanel.value = true;
}

async function confirmSave(): Promise<void> {
  const name = saveName.value.trim();
  if (!name) {
    saveError.value = "name is required";
    return;
  }
  savingInFlight.value = true;
  saveError.value = null;
  try {
    // A full snapshot of node.properties, as it stands right now -- not a
    // curated subset. See this file's header on why there's no field
    // descriptor deciding what belongs in a preset of this type.
    await putPreset(backendWsUrl.value, props.presetType, name, { ...props.properties });
    await refresh();
    selectedName.value = name;
    showSavePanel.value = false;
  } catch (err) {
    saveError.value = err instanceof AdminApiError || err instanceof Error ? err.message : String(err);
  } finally {
    savingInFlight.value = false;
  }
}
</script>

<style scoped>
.preset-ref-field {
  margin-bottom: 8px;
}
.preset-ref-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.preset-ref-row select {
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
.preset-error {
  color: #e08080;
  font-size: 11px;
  margin: 4px 0 0;
}
.preset-save-panel {
  margin-top: 6px;
  padding: 8px;
  background: #17171a;
  border: 1px solid #333;
  border-radius: 4px;
}
/* Same field-name-and-input-on-one-row treatment as CredentialRefField.
   vue/ConfigRefField.vue's own `.field-row` -- see those files' headers
   for why the plain `<label>text<input></label>` default doesn't already
   do this. */
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
.preset-save-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.preset-save-actions button {
  flex: 1 1 auto;
  background: #2a2a30;
  border: 1px solid #444;
  color: #eee;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
.preset-save-actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
