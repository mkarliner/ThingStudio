// SPDX-License-Identifier: Apache-2.0
// editor/src/app/memory-advice.ts
//
// When to suggest Tools → Restart board (soft) / Reset board (hard) / a power cycle (Mike, 2026-10-07: manual reset
// buttons, with messages that suggest them). Found on a CYD (classic ESP32, no PSRAM): after a display
// flow, the board's memory was fragmented (an 11 KB message couldn't be decoded) and MicroPython had
// taken ESP-IDF memory WiFi needs (1 KB left), so the next WiFi flow crashed the board as it started.
// A soft reset keeps USB connected and gives MicroPython a clean interpreter, which fixes a flow's own
// leftovers. It does NOT give ESP-IDF back the memory MicroPython took, and it does not give back a
// bigger heap region: the interpreter is re-initialised over the same regions (2026-10-22, see
// DEPLOY_MEMORY_HINT). So a deploy that cannot fit gets a power cycle, not a soft restart.

import type { HelloMessage } from "../protocol/messages.js";

/** Below this, an ESP32's WiFi may fail to start (it allocates from the ESP-IDF heap). A healthy
 * board with WiFi up still has ~35-40 KB here (CYD and ESP32-C3, 2026-09-25 and 2026-10-07). */
export const LOW_IDF_HEAP_BYTES = 30_000;

/** The one way out of a board that cannot fit the next flow (Mike, 2026-10-22: document "power cycle the
 * board" or equivalent). Freeing the running flow does not return a usable block, and a soft restart restarts
 * the interpreter over the same heap regions without giving ESP-IDF memory back — so the recipe is: drop the
 * saved flow, then cut power to the chip, then deploy. On most boards the USB cable is the power switch;
 * Tools → Reset board (hard) is the same reset without unplugging. */
export const DEPLOY_MEMORY_HINT =
  "Tools → Remove flow…, then power cycle the board (unplug its USB cable and plug it back in, or Tools → Reset board (hard)), then deploy.";

/** For low ESP-IDF memory: only a full chip reset returns it. */
export const HARD_RESET_HINT = "Try Tools → Reset board (hard), then deploy.";

/** A warning before deploying a networking flow to a board short of ESP-IDF memory, or null. */
export function lowMemoryWarningBeforeDeploy(
  hello: Pick<HelloMessage, "freeIdfHeapBytes"> | null,
  usesNetworking: boolean,
): string | null {
  if (!hello || hello.freeIdfHeapBytes === null || !usesNetworking) return null;
  if (hello.freeIdfHeapBytes >= LOW_IDF_HEAP_BYTES) return null;
  return (
    `only ${Math.floor(hello.freeIdfHeapBytes / 1024)} KB ESP-IDF memory free, WiFi may not start. ${HARD_RESET_HINT}`
  );
}

/** True when an error text says the board ran out of memory. */
export function looksLikeOutOfMemory(text: string | null | undefined): boolean {
  return !!text && /MemoryError|memory allocation failed/i.test(text);
}

/** A warning when the board's reported free memory is small next to the flow about to be sent, or null.
 *
 * A warning, never a refusal (Mike, 2026-10-22: "you can warn about limited memory, but the user may know
 * better"). The figure is MicroPython's total free bytes, which on a split-heap ESP32 says nothing about the
 * largest contiguous block -- so this predicts badly in both directions and is a nudge, not a gate. The
 * deploy goes ahead exactly as asked, and a board that cannot take it answers with its own figures. */
export function lowFlowMemoryWarning(
  hello: Pick<HelloMessage, "freeRamBytes"> | null,
  bytecodeBytes: number,
): string | null {
  if (!hello || hello.freeRamBytes === null) return null;
  // Room for the flow plus the module it turns into, and a little for the run.
  const needed = bytecodeBytes * 2 + 16_384;
  if (hello.freeRamBytes >= needed) return null;
  return (
    `only ${Math.floor(hello.freeRamBytes / 1024)} KB free on the board, this flow is ` +
    `${Math.ceil(bytecodeBytes / 1024)} KB -- it may not fit. Deploying anyway.`
  );
}

/** The advice line after a failed deploy's DEPLOY_ERROR, or null when it isn't about memory.
 *
 * Both cases have the same answer now (Mike, 2026-10-22): dropping the saved flow alone doesn't help (the
 * running flow keeps its memory until the chip restarts), freeing it for a retry didn't either, and a soft
 * restart keeps the same heap regions -- so remove the flow and power cycle. Nothing here is done
 * automatically: the line says what happened and what the user can do, and the editor stops there. */
export function deployMemoryAdvice(code: string, message: string): string | null {
  if (!looksLikeOutOfMemory(`${code} ${message}`)) return null;
  return `board out of memory. ${DEPLOY_MEMORY_HINT}`;
}
