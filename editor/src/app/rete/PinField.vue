<!--
  editor/src/app/rete/PinField.vue

  One pin input, shared by every pin-taking node's property panel and by the I2C/touch config edit
  forms (config-types.ts's `pin` field kind). Before this, each of ~13 places hardcoded its own
  `<input type="number">` plus a call to a local `pinInfo()`; a named-pin board (STM32's "X1") needs a
  dropdown instead, so the logic lives once here.

  Three shapes, chosen from the resolved `activeTarget` (store.ts):
    - a target whose pins are named  -> a <select> of the target's own pins (labels/status shown);
    - a numeric target               -> a number input, its max following the target;
    - no target                      -> a plain text input (a number or a name), with the fallback hint.

  The compile-time checks in definitions/pin-check.ts are what actually enforce anything; this is only a
  guide while editing.
-->
<template>
  <label class="pin-field">
    <span class="pin-name">{{ label }}</span>
    <select v-if="mode === 'named'" :value="encodedValue" @change="onSelect">
      <option v-if="optional" value="">&mdash; not wired &mdash;</option>
      <option v-if="offListValue !== null" :value="offListValue">{{ offListText }}</option>
      <option v-for="p in targetPins" :key="pinKey(p)" :value="pinKey(p)">{{ optionText(p) }}</option>
    </select>
    <input
      v-else-if="mode === 'numeric'"
      type="number"
      :min="optional ? -1 : 0"
      :max="pinMax"
      :value="numberValue"
      @input="onNumber"
    />
    <input v-else type="text" :value="textValue" placeholder="5 or X1" @input="onText" />
    <span v-if="info" class="pin-hint" :class="{ bad: info.bad }" :title="info.title">{{ info.text }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { activeTarget } from "./store";
import { isNamedPinName, type PinId } from "../../definitions/definitions";
import { FALLBACK_MAX_PIN } from "../../definitions/pin-check";

const props = defineProps<{
  modelValue: unknown;
  label: string;
  /** Allow "not wired": a blank/-1 value (display_spi's cs/reset/backlight). */
  optional?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: PinId | null]; touch: [] }>();

function isPin(v: unknown): v is PinId {
  return typeof v === "number" ? Number.isInteger(v) : typeof v === "string" && v.trim() !== "";
}

const current = computed<PinId | null>(() => (isPin(props.modelValue) ? (typeof props.modelValue === "string" ? props.modelValue.trim() : props.modelValue) : null));

const targetPins = computed<PinId[]>(() => {
  const t = activeTarget.value;
  if (!t) return [];
  return [...t.gpio].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b);
  });
});

const mode = computed<"named" | "numeric" | "plain">(() => {
  if (!activeTarget.value) return "plain";
  return targetPins.value.some((p) => typeof p === "string") ? "named" : "numeric";
});

const pinMax = computed(() => {
  const t = activeTarget.value;
  if (!t) return FALLBACK_MAX_PIN;
  const nums = [...t.gpio].filter((p): p is number => typeof p === "number");
  return nums.length ? Math.max(...nums) : FALLBACK_MAX_PIN;
});

function pinKey(p: PinId): string {
  return JSON.stringify(p);
}

function decode(key: string): PinId | null {
  if (key === "") return null;
  try {
    const v: unknown = JSON.parse(key);
    return isPin(v) ? v : null;
  } catch {
    return null;
  }
}

const encodedValue = computed(() => (current.value === null ? "" : pinKey(current.value)));

// A stored pin that isn't in the target's own set (a stale numeric pin on a named board, say): keep it
// visible rather than silently dropping it, so the compile's "doesn't exist" error still names a value.
const offListValue = computed<string | null>(() => {
  const c = current.value;
  if (mode.value !== "named" || c === null) return null;
  return targetPins.value.some((p) => p === c) ? null : pinKey(c);
});
const offListText = computed(() => `${String(current.value)} (not on this board)`);

function optionText(p: PinId): string {
  const t = activeTarget.value!;
  const base = typeof p === "number" ? `GPIO ${p}` : p;
  const labels = t.pinLabels.get(p);
  return labels && labels.length ? `${base} · ${labels.join(", ")}` : base;
}

function infoFor(value: PinId | null): { text: string; title: string; bad: boolean } | null {
  const t = activeTarget.value;
  if (!t || value === null) return null;
  if (typeof value === "number" && value < 0) return null;
  if (!t.gpio.has(value)) return { text: "not on this board", title: `${t.label} has no ${typeof value === "number" ? `GPIO ${value}` : `pin ${value}`}`, bad: true };
  const reserved = t.reserved.get(value);
  if (reserved !== undefined) return { text: "reserved", title: reserved, bad: true };
  const labels = t.pinLabels.get(value)?.join(", ");
  const avoid = t.avoid.get(value);
  if (avoid !== undefined) return { text: labels ? `${labels} · avoid` : "avoid", title: avoid, bad: false };
  if (t.inputOnly.has(value)) return { text: labels ? `${labels} · input only` : "input only", title: `${typeof value === "number" ? `GPIO ${value}` : `pin ${value}`} is input-only on ${t.label}`, bad: false };
  return labels ? { text: labels, title: `${t.board?.name ?? t.label}: ${labels}`, bad: false } : null;
}

const info = computed(() => infoFor(current.value));

const numberValue = computed(() => (typeof current.value === "number" ? current.value : null));
const textValue = computed(() => (current.value === null ? "" : String(current.value)));

function commit(value: PinId | null): void {
  emit("update:modelValue", value);
  emit("touch");
}

function onSelect(event: Event): void {
  commit(decode((event.target as HTMLSelectElement).value));
}

function onNumber(event: Event): void {
  const raw = (event.target as HTMLInputElement).valueAsNumber;
  commit(Number.isFinite(raw) ? Math.round(raw) : null);
}

function onText(event: Event): void {
  const s = (event.target as HTMLInputElement).value.trim();
  if (s === "") {
    commit(props.optional ? null : s);
    return;
  }
  if (/^\d+$/.test(s)) commit(Number(s));
  else if (isNamedPinName(s)) commit(s);
  else commit(s);
}
</script>

<style scoped>
.pin-field {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  column-gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.pin-name {
  color: #bbb;
  overflow-wrap: anywhere;
}
.pin-field input,
.pin-field select {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 0;
  background: #1b1b1b;
  border: 1px solid #444;
  color: #eee;
  padding: 4px 6px;
  font-family: inherit;
}
.pin-hint {
  grid-column: 2;
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #888;
}
.pin-hint.bad {
  color: #e06c6c;
}
</style>
