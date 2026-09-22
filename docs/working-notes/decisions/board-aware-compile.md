# Decisions — Board-aware compile (-march)

Status: detail file for `decisions.md`'s "Board-aware compile (-march)" index entry.

- **2026-09-22 — MVP item 3 (`mvp-kickoff-brief.md`) built, both halves together: auto-detect and a
  manual override.** `mvp-kickoff-brief.md`'s item 3 asked for one thing ("replace the hardcoded
  Xtensa `-march` so viper code works on RP2040/RP2350"); Mike's own follow-up in this session added
  the second requirement explicitly ("also allow setting processor type manually from editor") —
  built together rather than the auto-detect half shipping first and the override following later,
  since the override is what actually covers the one case auto-detect can't (see RP2350 below, and
  the no-board-connected-yet case generally).
- **What was there before:** `outstanding-items/display-spi-framebuffer-memory.md`'s 2026-09-18
  entry — `compileToMpy()` had no `-march` at all until a real viper-using flow (`display_spi`'s
  `gs4` format) failed to Deploy with `SyntaxError: invalid arch`. Fixed that day with one hardcoded
  `MPY_CROSS_MARCH = "xtensawin"` constant, flagged in its own comment as a landmine for any
  non-Xtensa board: "fine today because nothing ARM-family... uses viper/native code yet."
- **A second bug found while closing that gap, not just the RP2040/RP2350 half the flag already
  named:** the hardcoded constant's own justification — "ESP32/ESP32-C3/ESP32-S3 are all Xtensa" —
  was itself wrong. ESP32-C3 (and ESP32-C6, not an MVP target but the same core family) is a RISC-V
  chip, not Xtensa, despite sharing the "ESP32" product family name with the original ESP32/ESP32-S3.
  Confirmed two ways before writing this into the codebase, not assumed: MicroPython's own
  architecture table (`docs.micropython.org/en/latest/develop/natmod.html`: `rv32imc — eg ESP32C3,
  ESP32C6`) and independently via web search on Espressif's own chip documentation (the C3 is
  publicly documented and well-known as this project's first RISC-V-based ESP32 variant). This bug
  had not yet bitten in practice — this project's real ESP32-C3 hardware (the LuatOS CORE-ESP32-C3
  boards used for `ebutton`/`eswitch`/interrupt work) never had a viper-using flow deployed to it;
  `gs4`'s own real-hardware proof (`display-spi-framebuffer-memory.md`) used a CYD, which is a true
  Xtensa ESP32-WROOM module, not a C3.
- **The RP2040/RP2350 half, resolved with different confidence levels, checked against real sources
  rather than reasoned from CPU-family analogy alone:**
  - **RP2040 → `armv6m`.** High confidence — RP2040 is a well-documented Cortex-M0+ (ARMv6-M, no
    FPU, Thumb-1 only), and MicroPython's own docs table names `armv6m` as "eg Cortex-M0" directly.
  - **RP2350 → `armv7emsp`.** NOT confirmed — MicroPython's own docs table doesn't list RP2350 at
    all (it predates the chip). Sourced from a MicroPython maintainer discussion thread
    (`github.com/orgs/micropython/discussions/16538`): one participant reported
    `sys.implementation._mpy` resolves to `armv7emsp` (uses the RP2350's hardware single-precision
    FPU) on real RP2350 hardware; another offered `armv7m` (no FPU) as a simpler alternative
    "verified to work in testing" in the same thread. This project has not independently verified
    either value against its own hardware — no RP2350 board was available this session. Both values
    are in the manual-override dropdown so this can be corrected without a code change once someone
    tests it for real.
  - Scope note: RP2350 can run MicroPython in either Arm (Cortex-M33) or RISC-V (Hazard3) mode: only
    the Arm-mode mapping above is covered, matching this project's board list which names "RP2350"
    plainly with no RISC-V-mode variant called out.
- **Design of the auto/manual split** (`editor/src/app/native-arch.ts` + `nativeArchSelect` in
  `index.html`): `inferNativeArch(chipType)` pattern-matches HELLO's free-form `chipType` string
  (MicroPython's own `sys.implementation._machine`, e.g. `"LuatOS-Core-ESP32C3 with ESP32C3"` or
  `"Raspberry Pi Pico W with RP2040"` — not a clean enum) and returns both the arch and whether it's
  confirmed or a best-effort guess. The Deploy handler (`main.ts`) always logs which arch it used and
  why (auto-detected from a named chip, auto with no chip known yet, or manual override); it escalates
  to a loud warning only when the compiled flow actually contains `@micropython.viper`/`@micropython.
  native` AND the arch wasn't confirmed — an unconfirmed arch is harmless for plain bytecode (proven
  byte-identical regardless of `-march`, `display-spi-framebuffer-format-decision.md`'s 2026-09-18
  verification), so a blanket warning on every unconfirmed-board Deploy would just be noise.
- **Verified:** `editor/test/native-arch.test.ts`, 11 cases, against real observed `chipType` strings
  (including `protocol.roundtrip.test.ts`'s own `"Raspberry Pi Pico W with RP2040"` test data) rather
  than invented ones. Isolated `tsc --noEmit` (clean, same pre-existing unrelated
  `node-startup.test.ts` gap) and `vitest run` (full suite, 558/561 passing — the 3 failures are the
  same pre-existing/environmental ones already tracked elsewhere: `node-startup.test.ts`'s
  unregistered node type, and a real-subprocess timing test in `node-eswitch.test.ts` that's flaky
  under sandbox load, neither touched by this change).
- **Not done — real hardware.** No board was available this session. Before trusting the RP2350 value
  specifically: deploy a viper-using flow (`display_spi` with a non-`rgb565` `frameFormat`) to a real
  RP2350 board and confirm it actually runs, not just that mpy-cross accepts the arch string without
  erroring — MicroPython's `.mpy` loader checks a native module's required arch against the running
  device's own at import time, so a subtly-wrong-but-valid arch string could still fail (or behave
  incorrectly) only once it reaches real hardware, not during compilation.
