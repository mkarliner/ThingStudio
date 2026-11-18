// SPDX-License-Identifier: Apache-2.0
// editor/test/board-leds.test.ts
import { describe, expect, it } from "vitest";
import { ledPinsLine } from "../src/app/board-leds.js";
import { BUILTIN_DEFINITION_FILES } from "../src/definitions/builtin.js";
import { buildDefinitionSet } from "../src/definitions/definitions.js";

const defs = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);
const board = (id: string) => {
  const b = defs.boards.get(id)!;
  return { board: b, processor: defs.processors.get(b.processor)! };
};

describe("LED pins line", () => {
  it("names a board's LEDs from its definition", () => {
    expect(ledPinsLine(board("cyd"))).toContain("LED_RED = GPIO 4, LED_GREEN = GPIO 16, LED_BLUE = GPIO 17");
    expect(ledPinsLine(board("pico"))).toContain("LED = GPIO 25");
    expect(ledPinsLine(board("pyboard-v10"))).toContain("LED_RED = pin A13");
  });

  it("says so when a board's definition names no LED", () => {
    expect(ledPinsLine(board("freenove-s3-4in"))).toContain("names no LED pin");
  });

  it("points at the Board menu when only the processor is known", () => {
    expect(ledPinsLine({ board: null, processor: defs.processors.get("esp32")! })).toContain("Pick your board");
  });

  it("says nothing with no target", () => {
    expect(ledPinsLine(null)).toBeNull();
  });

  it("finds an LED in every built-in board whose pins name one", () => {
    for (const b of defs.boards.values()) {
      const named = [...b.pins.keys()].some((k) => k.toUpperCase().includes("LED"));
      const line = ledPinsLine({ board: b, processor: defs.processors.get(b.processor)! })!;
      expect(line.includes("names no LED pin"), b.id).toBe(!named);
    }
  });
});
