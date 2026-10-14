// SPDX-License-Identifier: Apache-2.0
// editor/test/board-descriptor-schema.test.ts
//
// Runs the published board/processor JSON Schemas against the parser that
// actually enforces them (interfaces/board-descriptor/SPEC.md). Users write
// these files by hand, so the schema is a real contract; this test keeps it
// from drifting from editor/src/definitions/definitions.ts. The parser's own
// behaviour is covered by definitions.test.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOARD_KEYS, PROCESSOR_KEYS } from "../src/definitions/definitions.js";

function schema(name: string): { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> } {
  return JSON.parse(readFileSync(new URL(`../../interfaces/board-descriptor/${name}.schema.json`, import.meta.url), "utf8"));
}

describe("board/processor descriptor schema conformance", () => {
  it("processor schema lists exactly the parser's keys", () => {
    const s = schema("processor");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties).sort()).toEqual([...PROCESSOR_KEYS].sort());
    for (const key of s.required) expect(PROCESSOR_KEYS).toContain(key);
  });

  it("board schema lists exactly the parser's keys", () => {
    const s = schema("board");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties).sort()).toEqual([...BOARD_KEYS].sort());
    for (const key of s.required) expect(BOARD_KEYS).toContain(key);
  });
});
