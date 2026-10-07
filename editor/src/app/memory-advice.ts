// SPDX-License-Identifier: Apache-2.0
// editor/src/app/memory-advice.ts
//
// When to suggest Tools → Restart board (soft) / Reset board (hard) (Mike, 2026-10-07: manual reset
// buttons, with messages that suggest them). Found on a CYD (classic ESP32, no PSRAM): after a display
// flow, the board's memory was fragmented (an 11 KB message couldn't be decoded) and MicroPython had
// taken ESP-IDF memory WiFi needs (1 KB left), so the next WiFi flow crashed the board as it started.
// A restart gives the next flow a clean heap. A soft reset keeps USB connected; a hard reset also gives
// ESP-IDF back the memory MicroPython took, but native-USB boards disconnect. Pure functions; main.ts
// shows the results.

import type { HelloMessage } from "../protocol/messages.js";

/** Below this, an ESP32's WiFi may fail to start (it allocates from the ESP-IDF heap). A healthy
 * board with WiFi up still has ~35-40 KB here (CYD and ESP32-C3, 2026-09-25 and 2026-10-07). */
export const LOW_IDF_HEAP_BYTES = 30_000;

export const RESTART_HINT =
  "Use Tools → Restart board (soft) and deploy again. If that doesn't help, Tools → Reset board (hard) " +
  "frees all memory, but a board with native USB disconnects and needs Connect again.";

/** A warning before deploying a networking flow to a board short of ESP-IDF memory, or null. */
export function lowMemoryWarningBeforeDeploy(
  hello: Pick<HelloMessage, "freeIdfHeapBytes"> | null,
  usesNetworking: boolean,
): string | null {
  if (!hello || hello.freeIdfHeapBytes === null || !usesNetworking) return null;
  if (hello.freeIdfHeapBytes >= LOW_IDF_HEAP_BYTES) return null;
  return (
    `the board has only ${Math.floor(hello.freeIdfHeapBytes / 1024)} KB of ESP-IDF memory free, and WiFi needs ` +
    `more to start, so this flow may fail or crash the board. ${RESTART_HINT}`
  );
}

/** True when an error text says the board ran out of memory. */
export function looksLikeOutOfMemory(text: string | null | undefined): boolean {
  return !!text && /MemoryError|memory allocation failed/i.test(text);
}
