// Tests for editor/src/app/native-arch.ts -- inferNativeArch()'s
// substring matching against real observed HELLO chipType strings
// (device-runtime/src/listener.py's _chip_type() comment, and
// protocol.roundtrip.test.ts's own "Raspberry Pi Pico W with RP2040"),
// not invented ones, same "use real string shapes" convention
// connect-error-help.test.ts already established for this kind of test.

import { describe, expect, it } from "vitest";
import { NATIVE_ARCH_OPTIONS, inferNativeArch } from "../src/app/native-arch.js";

describe("inferNativeArch", () => {
  it("maps a real ESP32-C3 chipType string to rv32imc (RISC-V), confirmed", () => {
    expect(inferNativeArch("LuatOS-Core-ESP32C3 with ESP32C3")).toEqual({ arch: "rv32imc", confirmed: true });
  });

  it("maps a hyphenated ESP32-C3 spelling to rv32imc too", () => {
    expect(inferNativeArch("some board with ESP32-C3")).toEqual({ arch: "rv32imc", confirmed: true });
  });

  it("maps ESP32-C6 to rv32imc as well (same RISC-V core family as C3)", () => {
    expect(inferNativeArch("board with ESP32C6")).toEqual({ arch: "rv32imc", confirmed: true });
  });

  it("maps plain ESP32 to xtensawin (Xtensa), confirmed", () => {
    expect(inferNativeArch("ESP32 module (spiram) with ESP32")).toEqual({ arch: "xtensawin", confirmed: true });
  });

  it("maps ESP32-S3 to xtensawin, confirmed -- and is not mistaken for the C3/C6 RISC-V case", () => {
    expect(inferNativeArch("board with ESP32S3")).toEqual({ arch: "xtensawin", confirmed: true });
  });

  it("maps a real RP2040 chipType string to armv6m, confirmed", () => {
    expect(inferNativeArch("Raspberry Pi Pico W with RP2040")).toEqual({ arch: "armv6m", confirmed: true });
  });

  it("maps RP2350 to armv7emsp, NOT confirmed -- community-sourced, no real-hardware verification yet", () => {
    expect(inferNativeArch("Raspberry Pi Pico 2 with RP2350")).toEqual({ arch: "armv7emsp", confirmed: false });
  });

  it("falls back to xtensawin, not confirmed, for an unrecognized board", () => {
    expect(inferNativeArch("some future board nobody has seen yet")).toEqual({ arch: "xtensawin", confirmed: false });
  });

  it("is case-insensitive", () => {
    expect(inferNativeArch("raspberry pi pico w with rp2040")).toEqual({ arch: "armv6m", confirmed: true });
  });
});

describe("NATIVE_ARCH_OPTIONS", () => {
  it("lists a unique, non-empty value for every option, for the manual-override dropdown", () => {
    expect(NATIVE_ARCH_OPTIONS.length).toBeGreaterThan(0);
    const values = NATIVE_ARCH_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const opt of NATIVE_ARCH_OPTIONS) {
      expect(opt.value.length).toBeGreaterThan(0);
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it("covers every arch value inferNativeArch can return", () => {
    const optionValues = new Set(NATIVE_ARCH_OPTIONS.map((o) => o.value));
    const inferred = [
      inferNativeArch("ESP32C3").arch,
      inferNativeArch("ESP32").arch,
      inferNativeArch("RP2040").arch,
      inferNativeArch("RP2350").arch,
    ];
    for (const arch of inferred) {
      expect(optionValues.has(arch)).toBe(true);
    }
  });
});
