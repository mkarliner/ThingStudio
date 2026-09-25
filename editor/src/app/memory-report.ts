// SPDX-License-Identifier: Apache-2.0
// editor/src/app/memory-report.ts
//
// The console's [memory] line, shown after each HELLO and DEPLOY_ACK (2026-09-25). HELLO's and DEPLOY_ACK's
// own echoes are verbose-only (console-filter.ts), so this is the one always-visible memory reading. On
// ESP32-family boards it adds ESP-IDF's heap, where the WiFi stack allocates: an ESP32-C3 failed to join WiFi
// from an MQTT flow with plenty of MicroPython RAM free (learnings/micropython-device-runtime.md).

export interface MemoryFigures {
  readonly freeRamBytes: number;
  readonly freeIdfHeapBytes: number | null;
  readonly largestIdfHeapBlockBytes: number | null;
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** "[memory] MicroPython 118 KB free · ESP-IDF heap 64 KB free, largest block 31 KB". The ESP-IDF part is
 * left out when the board doesn't report it (not ESP32, or a runtime older than 5.1.0). */
export function formatMemoryLine(m: MemoryFigures): string {
  let line = `[memory] MicroPython ${kb(m.freeRamBytes)} free`;
  if (m.freeIdfHeapBytes !== null) {
    line += ` · ESP-IDF heap ${kb(m.freeIdfHeapBytes)} free`;
    if (m.largestIdfHeapBlockBytes !== null) line += `, largest block ${kb(m.largestIdfHeapBlockBytes)}`;
  }
  return line;
}
