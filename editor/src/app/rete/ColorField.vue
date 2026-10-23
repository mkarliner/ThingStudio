<!--
  SPDX-License-Identifier: Apache-2.0
  editor/src/app/rete/ColorField.vue

  One colour property (`kind: "colour"`, added 2026-10-23 for the GUI theme's roles): an
  `<input type="color">` beside a hex field, stored as a raw RGB565 number like display_spi's
  palette entries, so the compiler can hand the panel exactly the value it will draw.

  A picker speaks 24-bit hex and the panel shows RGB565, so a chosen colour is rounded to the
  nearest colour the panel can show (rgb565.ts) and shown back as that, not as what was typed.
-->
<template>
  <label class="prop-row">
    <span class="prop-name">{{ label }}</span>
    <span class="color-field">
      <input
        type="color"
        :value="rgb565ToHex(value)"
        :title="`${rgb565ToHex(value)} (0x${value.toString(16).padStart(4, '0')})`"
        @input="(e) => set((e.target as HTMLInputElement).value)"
      />
      <input
        class="hex"
        type="text"
        spellcheck="false"
        :value="rgb565ToHex(value)"
        @change="(e) => set((e.target as HTMLInputElement).value)"
      />
    </span>
  </label>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { hexToRgb565, rgb565ToHex } from "./rgb565";

const props = defineProps<{ label: string; modelValue: unknown }>();
const emit = defineEmits<{ (e: "update:modelValue", value: number): void }>();

const value = computed(() => {
  const raw = Number(props.modelValue);
  return Number.isFinite(raw) ? Math.min(0xffff, Math.max(0, Math.round(raw))) : 0;
});

function set(hex: string): void {
  try {
    emit("update:modelValue", hexToRgb565(hex));
  } catch {
    // A half-typed hex value: leave the stored colour alone rather than writing a wrong one.
  }
}
</script>

<style scoped>
.color-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-field .hex {
  width: 6.5em;
  font-family: monospace;
}
</style>
