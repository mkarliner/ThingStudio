<!--
  SPDX-License-Identifier: Apache-2.0
  editor/src/app/rete/PaletteField.vue

  display_spi's `palette` property: 16 raw RGB565 values, of which an
  indexed frame format reads only the first 2 (mono), 4 (gs2) or all 16
  (gs4) -- display-spi.ts's PALETTE_ENTRIES_USED. Shows just the entries the
  current format reads; the rest stay in the flow file untouched, so
  switching format back doesn't lose them. Hidden for rgb565, which has no
  palette.

  Writes a fresh 16-entry array on every change (never mutates in place),
  and materializes the default first if the node has no `palette` yet (a
  hand-edited flow file may omit it; codegen then falls back to the same
  DEFAULT_PALETTE_GS4, so nothing changes until the user edits a swatch).
-->
<template>
  <div v-if="used > 0" class="palette-field">
    <div class="palette-head">
      <span>palette ({{ used }} of 16 used)</span>
      <button type="button" class="reset" title="Restore the built-in 16-color palette" @click="reset">reset</button>
    </div>
    <div class="swatches">
      <label v-for="i in used" :key="i" class="swatch" :title="`index ${i - 1}: ${formatRgb565(current[i - 1]!)}`">
        <span class="idx">{{ i - 1 }}</span>
        <input type="color" :value="rgb565ToHex(current[i - 1]!)" @input="(e) => setEntry(i - 1, (e.target as HTMLInputElement).value)" />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { DEFAULT_PALETTE_GS4, PALETTE_ENTRIES_USED } from "../../node-library/display-spi";
import { formatRgb565, hexToRgb565, rgb565ToHex } from "./rgb565";

const props = defineProps<{ properties: Record<string, unknown> }>();
const emit = defineEmits<{ (e: "changed"): void }>();

const used = computed(() => {
  const format = props.properties.frameFormat as string | undefined;
  return format === "gs4" || format === "gs2" || format === "mono" ? PALETTE_ENTRIES_USED[format] : 0;
});

// A malformed stored palette (wrong length, from a hand edit) is shown as
// the default rather than half-rendered; compile still reports the real
// error (requirePalette), so nothing is hidden from the user at deploy.
const current = computed<number[]>(() => {
  const p = props.properties.palette;
  return Array.isArray(p) && p.length === 16 ? p.map((n) => Number(n)) : [...DEFAULT_PALETTE_GS4];
});

function setEntry(index: number, hex: string): void {
  const next = [...current.value];
  next[index] = hexToRgb565(hex);
  props.properties.palette = next;
  emit("changed");
}

function reset(): void {
  props.properties.palette = [...DEFAULT_PALETTE_GS4];
  emit("changed");
}
</script>

<style scoped>
.palette-field { margin: 6px 0; }
.palette-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.reset { font-size: 11px; padding: 1px 6px; }
.swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; margin-top: 4px; }
.swatch { display: flex; flex-direction: column; align-items: center; font-size: 10px; margin: 0; }
.swatch input[type="color"] { width: 100%; height: 22px; padding: 0; border: 1px solid #555; background: none; cursor: pointer; }
.idx { opacity: 0.7; }
</style>
