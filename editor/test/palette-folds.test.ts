// Foldable palette groups (palette-folds.ts, 2026-10-17).
import { describe, expect, it } from "vitest";
import { isFolded, parseFolds, toggleFold } from "../src/app/rete/palette-folds.js";

describe("palette folds", () => {
  it("opens general and folds every other group by default", () => {
    expect(isFolded({}, "general")).toBe(false);
    for (const g of ["network", "hardware", "GUI", "examples"]) expect(isFolded({}, g)).toBe(true);
  });
  it("remembers what the user clicked", () => {
    let s = toggleFold({}, "network");
    expect(isFolded(s, "network")).toBe(false);
    s = toggleFold(s, "general");
    expect(isFolded(s, "general")).toBe(true);
    s = toggleFold(s, "network");
    expect(isFolded(s, "network")).toBe(true);
    expect(isFolded(s, "hardware")).toBe(true);
  });
  it("round-trips through storage, and ignores junk", () => {
    const s = toggleFold(toggleFold({}, "network"), "general");
    expect(parseFolds(JSON.stringify(s))).toEqual(s);
    expect(parseFolds(null)).toEqual({});
    expect(parseFolds("not json")).toEqual({});
    expect(parseFolds("[1,2]")).toEqual({});
    expect(parseFolds('{"network": false, "x": "yes"}')).toEqual({ network: false });
  });
});
