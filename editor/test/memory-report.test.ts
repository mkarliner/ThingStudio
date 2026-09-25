import { describe, expect, it } from "vitest";
import { formatMemoryLine } from "../src/app/memory-report.js";

describe("formatMemoryLine", () => {
  it("shows MicroPython RAM only when the board sends no ESP-IDF figures", () => {
    expect(formatMemoryLine({ freeRamBytes: 120_000, freeIdfHeapBytes: null, largestIdfHeapBlockBytes: null })).toBe(
      "[memory] MicroPython 117 KB free",
    );
  });

  it("adds the ESP-IDF heap and its largest block on ESP32-family boards", () => {
    expect(formatMemoryLine({ freeRamBytes: 120_000, freeIdfHeapBytes: 65_536, largestIdfHeapBlockBytes: 31_744 })).toBe(
      "[memory] MicroPython 117 KB free · ESP-IDF heap 64 KB free, largest block 31 KB",
    );
  });
});
