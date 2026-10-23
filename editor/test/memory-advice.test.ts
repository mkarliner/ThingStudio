// SPDX-License-Identifier: Apache-2.0
// editor/test/memory-advice.test.ts -- when the console suggests restarting the board (2026-10-07).

import { describe, expect, it } from "vitest";
import { DEPLOY_MEMORY_DOC, DEPLOY_MEMORY_HINT, LOW_IDF_HEAP_BYTES, deployMemoryAdvice, looksLikeOutOfMemory, lowFlowMemoryWarning, lowMemoryWarningBeforeDeploy } from "../src/app/memory-advice.js";

describe("lowMemoryWarningBeforeDeploy", () => {
  it("warns for a networking flow on an ESP32 with little ESP-IDF memory (the CYD's 1 KB case)", () => {
    const w = lowMemoryWarningBeforeDeploy({ freeIdfHeapBytes: 1368 }, true)!;
    expect(w).toContain("only 1 KB ESP-IDF memory");
    // A soft reset doesn't return ESP-IDF memory (CYD, 2026-10-07), so only the hard reset is offered.
    expect(w).toContain("Reset board (hard)");
    expect(w).not.toContain("Restart board (soft)");
  });
  it("stays quiet with enough memory, without networking, off ESP32, or with no HELLO", () => {
    expect(lowMemoryWarningBeforeDeploy({ freeIdfHeapBytes: LOW_IDF_HEAP_BYTES }, true)).toBeNull();
    expect(lowMemoryWarningBeforeDeploy({ freeIdfHeapBytes: 1368 }, false)).toBeNull();
    expect(lowMemoryWarningBeforeDeploy({ freeIdfHeapBytes: null }, true)).toBeNull();
    expect(lowMemoryWarningBeforeDeploy(null, true)).toBeNull();
  });
});

describe("looksLikeOutOfMemory", () => {
  it("recognises MicroPython's out-of-memory wording", () => {
    expect(looksLikeOutOfMemory("MemoryError: memory allocation failed, allocating 11368 bytes")).toBe(true);
    expect(looksLikeOutOfMemory("mqtt_as arrived incomplete -- the board couldn't read part of it: memory allocation failed")).toBe(true);
    expect(looksLikeOutOfMemory("ImportError: no module named 'socket'")).toBe(false);
    expect(looksLikeOutOfMemory(null)).toBe(false);
  });
});

describe("deployMemoryAdvice", () => {
  it("gives the ladder: remove the flow, power cycle, and if it still fails the flow may be too big", () => {
    const a = deployMemoryAdvice("MemoryError", "no room to receive the flow (4120 bytes free); the running flow is using the memory")!;
    expect(a).toContain("Remove flow");
    expect(a).toContain("power cycle");
    // Mike, 2026-10-23: after the power cycle, say the plain thing -- the flow may not fit this board.
    expect(a).toContain("the flow may be too big for this board");
    // A soft restart keeps the same heap regions and gives no chip memory back, so it is not offered.
    expect(a).not.toContain("Restart board (soft)");
  });
  it("gives the same recipe for a flow that arrived but couldn't start, nothing otherwise", () => {
    const a = deployMemoryAdvice("MemoryError", "memory allocation failed, allocating 376 bytes (16904 bytes free after stopping the previous flow)")!;
    expect(a).toContain("power cycle");
    expect(deployMemoryAdvice("ImportError", "no module named 'foo'")).toBeNull();
  });
  it("carries one docs link, to the page that explains what is left (Mike, 2026-10-23)", () => {
    expect(DEPLOY_MEMORY_DOC.path).toBe("debugging/#memoryerror-or-a-library-that-wont-load");
    // The console names no firmware image: more images will exist, and the page is where that choice lives.
    expect(DEPLOY_MEMORY_HINT).not.toMatch(/classic-ESP32|custom firmware/i);
  });
});

describe("lowFlowMemoryWarning", () => {
  it("warns when the board's free memory is small next to the flow, and says it deploys anyway", () => {
    const w = lowFlowMemoryWarning({ freeRamBytes: 20000 }, 9537)!;
    expect(w).toContain("only 19 KB free");
    expect(w).toContain("10 KB");
    expect(w).toContain("Deploying anyway");
  });
  it("stays quiet with room, or with no figures", () => {
    expect(lowFlowMemoryWarning({ freeRamBytes: 149408 }, 9537)).toBeNull();
    expect(lowFlowMemoryWarning(null, 9537)).toBeNull();
  });
});
