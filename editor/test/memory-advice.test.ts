// SPDX-License-Identifier: Apache-2.0
// editor/test/memory-advice.test.ts -- when the console suggests restarting the board (2026-10-07).

import { describe, expect, it } from "vitest";
import { LOW_IDF_HEAP_BYTES, deployMemoryAdvice, looksLikeOutOfMemory, lowMemoryWarningBeforeDeploy } from "../src/app/memory-advice.js";

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
  it("says to remove the flow when the board had no room to receive it (runtime 9.2.0, CYD)", () => {
    const a = deployMemoryAdvice("MemoryError", "no room to receive the flow; the running flow is using the memory")!;
    expect(a).toContain("Remove flow");
    expect(a).toContain("Reset board (hard)");
  });
  it("gives the restart advice for other memory errors, nothing otherwise", () => {
    expect(deployMemoryAdvice("MemoryError", "memory allocation failed, allocating 38400 bytes")).toContain("Restart board (soft)");
    expect(deployMemoryAdvice("ImportError", "no module named 'foo'")).toBeNull();
  });
});
