// SPDX-License-Identifier: Apache-2.0
// editor/src/app/native-arch.ts
//
// Board-aware mpy-cross -march selection. Pulled out of main.ts (which
// hardcoded a single `MPY_CROSS_MARCH = "xtensawin"` constant from
// 2026-09-18 until this change) so it's independently testable, same
// "small focused file, pure function" shape as connect-error-help.ts.
//
// Background (mpy-cross's native-code emitter -- what actually compiles a
// `@micropython.viper`/`@micropython.native`-decorated function to real
// machine code, as opposed to portable bytecode -- needs an explicit
// `-march=<arch>` target): plain bytecode compilation is
// architecture-independent (display-spi-framebuffer-format-decision.md's
// 2026-09-18 verification: a non-viper snippet produces byte-identical
// output regardless of which valid -march is passed), so a wrong guess
// here is invisible until a flow that actually uses viper/native code is
// compiled for that board -- today that's only `display_spi`'s
// `frameFormat: "gs4"/"gs2"/"mono"`, but nothing stops another node from
// using either decorator later.
//
// mpy-cross's supported -march values, read directly out of the vendored
// `editor/public/vendor/mpy-cross/mpy-cross.wasm` binary via `strings`
// (display-spi-framebuffer-format-decision.md, 2026-09-18): x86, x64,
// armv6, armv6m, armv7m, armv7em, armv7emsp, armv7emdp, xtensa, xtensawin,
// rv32imc, rv64imc, host, debug. Cross-checked against MicroPython's own
// docs (docs.micropython.org/en/latest/develop/natmod.html's arch table)
// for which chip each one actually targets.
//
// **Real correction found while building this, not just filling in
// RP2040/RP2350:** this project's existing single-constant default,
// "xtensawin", was WRONG for ESP32-C3 specifically, despite ESP32-C3
// boards (the LuatOS CORE-ESP32-C3 hardware this project's rig already
// uses for ebutton/eswitch/interrupt work) sharing the "ESP32" family
// name with the original ESP32/ESP32-S3 -- those two are Xtensa cores,
// but ESP32-C3 (and C6, C2, C5, C61 -- not MVP targets, listed only for
// context) is a RISC-V core, confirmed both by MicroPython's own arch
// table ("rv32imc -- eg ESP32C3, ESP32C6") and independently by
// Espressif's own chip documentation. This had not yet bitten in practice
// only because no viper-using flow had been deployed to a real C3 board
// -- this project's C3 hardware so far was used for other node types,
// display_spi's viper-using formats were only ever tested on a CYD
// (ESP32-WROOM, a true Xtensa chip).
//
// RP2040/RP2350 mapping: RP2040 is Cortex-M0+ (ARMv6-M, Thumb-1 only, no
// FPU) -- "armv6m" per MicroPython's own docs table ("eg Cortex-M0"),
// unambiguous, confirmed by public hardware documentation, not a guess.
// RP2350 (Arm mode -- this project doesn't target its RISC-V/Hazard3
// mode) is Cortex-M33, not explicitly in MicroPython's own docs table;
// "armv7emsp" (single-precision FPU) is what a MicroPython maintainer
// reported `sys.implementation._mpy` actually resolves to for RP2350 in
// a project discussion (github.com/orgs/micropython/discussions/16538),
// with "armv7m" (no FPU) offered in the same thread as a simpler
// fallback "verified to work in testing" by a different participant.
// Flagged `confirmed: false` below -- community-sourced, not verified
// against real RP2350 hardware by this project. Use the manual override
// (main.ts's nativeArchSelect) if a real board shows this guess is wrong.

/** One selectable entry for the manual-override dropdown. */
export interface NativeArchOption {
  readonly value: string;
  readonly label: string;
}

/** Ordered for the dropdown -- MVP target chips (mvp-kickoff-brief.md's
 * fixed decision list: ESP32, ESP32-C3, ESP32-S3, RP2040, RP2350) first,
 * in the same order the brief lists them. */
export const NATIVE_ARCH_OPTIONS: readonly NativeArchOption[] = [
  { value: "xtensawin", label: "xtensawin — ESP32 / ESP32-S3 (Xtensa)" },
  { value: "rv32imc", label: "rv32imc — ESP32-C3 (RISC-V)" },
  { value: "armv6m", label: "armv6m — RP2040 (Cortex-M0+)" },
  { value: "armv7emsp", label: "armv7emsp — RP2350 (Cortex-M33, FPU) — community-sourced, not hardware-verified" },
  { value: "armv7m", label: "armv7m — RP2350, no-FPU fallback" },
];

export interface NativeArchGuess {
  readonly arch: string;
  /** false = best-effort guess this project hasn't verified against real
   * hardware (today: only the RP2350 case, and the unrecognized-board
   * fallback) -- true covers both a confidently-known mapping and an
   * explicit manual override (the user's own choice is never "guessed"). */
  readonly confirmed: boolean;
}

/** Infers the mpy-cross -march value from a HELLO's free-form `chipType`
 * string (device-runtime/src/listener.py's `_chip_type()`: MicroPython's
 * own `sys.implementation._machine`, e.g. "LuatOS-Core-ESP32C3 with
 * ESP32C3" or "Raspberry Pi Pico W with RP2040" -- not a clean enum, so
 * this matches case-insensitive substrings, not exact values. */
export function inferNativeArch(chipType: string): NativeArchGuess {
  const s = chipType.toLowerCase();
  // Checked before the plain "esp32" fallback below -- see this file's
  // header for why C3/C6 can't share the Xtensa family's default.
  if (s.includes("esp32c3") || s.includes("esp32-c3") || s.includes("esp32c6") || s.includes("esp32-c6")) {
    return { arch: "rv32imc", confirmed: true };
  }
  if (s.includes("esp32")) {
    return { arch: "xtensawin", confirmed: true };
  }
  if (s.includes("rp2040")) {
    return { arch: "armv6m", confirmed: true };
  }
  if (s.includes("rp2350")) {
    return { arch: "armv7emsp", confirmed: false };
  }
  // Unrecognized board -- "xtensawin" was this project's unconditional
  // default before board-awareness existed, proven harmless for every
  // non-viper flow (byte-identical output regardless of -march). Stays
  // the fallback here for the same reason; only wrong if this
  // unrecognized board's flow *also* uses viper, in which case the
  // manual override is the way out, same as the RP2350 guess above.
  return { arch: "xtensawin", confirmed: false };
}
