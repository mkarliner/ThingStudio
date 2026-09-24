import { describe, expect, it } from "vitest";
import { formatRgb565, hexToRgb565, rgb565ToHex } from "../src/app/rete/rgb565.js";
import { DEFAULT_PALETTE_GS4 } from "../src/node-library/display-spi.js";

describe("rgb565 helpers", () => {
  it("maps the extremes and primaries exactly", () => {
    expect(rgb565ToHex(0x0000)).toBe("#000000");
    expect(rgb565ToHex(0xffff)).toBe("#ffffff");
    expect(rgb565ToHex(0xf800)).toBe("#ff0000");
    expect(rgb565ToHex(0x07e0)).toBe("#00ff00");
    expect(rgb565ToHex(0x001f)).toBe("#0000ff");
  });

  it("round-trips every default palette entry and every value 0-65535", () => {
    for (const v of DEFAULT_PALETTE_GS4) expect(hexToRgb565(rgb565ToHex(v))).toBe(v);
    for (let v = 0; v <= 0xffff; v++) {
      if (hexToRgb565(rgb565ToHex(v)) !== v) throw new Error(`round-trip failed at ${v}`);
    }
  });

  it("truncates a 24-bit color to the nearest lower 565 value", () => {
    expect(hexToRgb565("#ff8000")).toBe((31 << 11) | (32 << 5) | 0);
    expect(hexToRgb565("0a0b0c")).toBe(((0x0a >> 3) << 11) | ((0x0b >> 2) << 5) | (0x0c >> 3));
  });

  it("rejects malformed hex", () => {
    expect(() => hexToRgb565("red")).toThrow();
    expect(() => hexToRgb565("#fff")).toThrow();
  });

  it("clamps out-of-range input when displaying", () => {
    expect(rgb565ToHex(-5)).toBe("#000000");
    expect(rgb565ToHex(70000)).toBe("#ffffff");
  });

  it("formats as 0x-prefixed 4-digit hex", () => {
    expect(formatRgb565(0xf800)).toBe("0xf800");
    expect(formatRgb565(31)).toBe("0x001f");
  });
});
