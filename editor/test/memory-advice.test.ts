// SPDX-License-Identifier: Apache-2.0
// editor/test/memory-advice.test.ts -- when the console suggests restarting the board (2026-10-07).

import { describe, expect, it } from "vitest";
import { LOW_IDF_HEAP_BYTES, looksLikeOutOfMemory, lowMemoryWarningBeforeDeploy } from "../src/app/memory-advice.js";

describe("lowMemoryWarningBeforeDeploy", () => {
  it("warns for a networking flow on an ESP32 with little ESP-IDF memory (the CYD's 1 KB case)", () => {
    const w = lowMemoryWarningBeforeDeploy({ freeIdfHeapBytes: 1368 }, true)!;
    expect(w).toContain("only 1 KB of ESP-IDF memory");
    expect(w).toContain("Restart board (soft)");
    expect(w).toContain("Reset board (hard)");
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
