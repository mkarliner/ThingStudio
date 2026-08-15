<!-- Thingstudio poc-rete — mirrors pocs/poc-c's debug sidebar (Node-RED's
     debug tab, §8). Not one of the 4 checkpoints itself, but needed so the
     example flow (inject -> function -> debug/gpio_out/mqtt_out fan-out) is
     actually visible doing something when fired. -->
<template>
  <div class="debug-sidebar">
    <h3>debug</h3>
    <div v-if="debugLog.length === 0" class="hint">Fire inject to see values here.</div>
    <div v-for="entry in debugLog" :key="entry.id" class="entry">
      <span class="label">{{ entry.label }}</span>
      <span class="value">{{ format(entry.value) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { debugLog } from "./store";

function format(v: unknown): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
</script>

<style scoped>
.debug-sidebar {
  padding: 12px;
  color: #ddd;
  font: 12px/1.5 ui-monospace, monospace;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}
.debug-sidebar h3 {
  font-family: system-ui, sans-serif;
  margin: 0 0 10px;
  font-size: 13px;
  color: #fff;
}
.entry {
  border-bottom: 1px solid #2a2a2a;
  padding: 4px 0;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.label {
  color: #8bd0ff;
}
.value {
  color: #cfcfcf;
}
.hint {
  color: #777;
  font-family: system-ui, sans-serif;
}
</style>
