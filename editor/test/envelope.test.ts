// Exhaustive wire-connect-time type check, per the validation plan's Tier 0
// spec (docs/working-notes/validation/mvp-validation-plan.md): "editor-side:
// wire-connect-time type check accepts every valid pairing across the full
// payload type set... and rejects every invalid one -- exhaustive over the
// type matrix, not spot-checked." This tests the full 6x6 = 36-pair matrix,
// not a handful of examples.

import { describe, it, expect } from "vitest";
import { isPayloadTypeCompatible, PAYLOAD_TYPES, type PayloadType } from "../src/protocol/envelope.js";

// The exact set of (from, to) pairs §6 says should be allowed:
// - exact match (X -> X) for every type
// - `any` is compatible with everything, in both directions
// - `int` widens to `number` (but not the reverse -- number doesn't
//   narrow to int)
function expectedCompatible(from: PayloadType, to: PayloadType): boolean {
  if (from === to) return true;
  if (from === "any" || to === "any") return true;
  if (from === "int" && to === "number") return true;
  return false;
}

describe("isPayloadTypeCompatible", () => {
  it("matches §6's rule across the full type matrix", () => {
    const mismatches: string[] = [];
    for (const from of PAYLOAD_TYPES) {
      for (const to of PAYLOAD_TYPES) {
        const got = isPayloadTypeCompatible(from, to);
        const want = expectedCompatible(from, to);
        if (got !== want) {
          mismatches.push(`${from} -> ${to}: got ${got}, want ${want}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("covers the full 6x6 matrix (36 pairs) -- guards against silently shrinking PAYLOAD_TYPES", () => {
    expect(PAYLOAD_TYPES.length).toBe(6);
    expect(PAYLOAD_TYPES.length * PAYLOAD_TYPES.length).toBe(36);
  });

  it("int widens to number but number does not narrow to int", () => {
    expect(isPayloadTypeCompatible("int", "number")).toBe(true);
    expect(isPayloadTypeCompatible("number", "int")).toBe(false);
  });

  it("does not allow bytes <-> string without an explicit conversion node (§6)", () => {
    expect(isPayloadTypeCompatible("bytes", "string")).toBe(false);
    expect(isPayloadTypeCompatible("string", "bytes")).toBe(false);
  });

  it("does not allow bool <-> int", () => {
    expect(isPayloadTypeCompatible("bool", "int")).toBe(false);
    expect(isPayloadTypeCompatible("int", "bool")).toBe(false);
  });

  it("any is compatible with every type in both directions", () => {
    for (const t of PAYLOAD_TYPES) {
      expect(isPayloadTypeCompatible("any", t)).toBe(true);
      expect(isPayloadTypeCompatible(t, "any")).toBe(true);
    }
  });
});
