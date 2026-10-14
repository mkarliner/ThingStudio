# STM32 / pyboard support

Status: mostly done, 2026-10-14; **not yet verified on real hardware**. Found connecting a pyboard v1.0
(`PYBv1.0 with STM32F405RG`) and deploying the blink flow: `DEPLOY_ERROR OSError [Errno 19] ENODEV`, and
`LISTENER_BOOT_ERR could not write boot counter: OSError(19,)`. The runtime itself installed and ran.

## Done

- 2026-10-13: `-march` for STM32F4 is `armv7emsp` (native-arch.ts), and the console says "a guess" instead of
  "auto-detected" when no definition or known chip matches.
- 2026-10-14: **named pins** (`decisions/chip-board-definitions.md`) -- a pin id is a number or a name, so the
  pyboard's `X1`/`Y1` are expressible through definitions, checks, codegen and the property panel.
- 2026-10-14: **filesystem root** -- `board_fs.py` takes the root once from `os.getcwd()` (`/` on ESP32/RP2,
  `/flash` on stm32); listener.py, deps.py, wifi_provision.py and board_settings.py build every persisted path
  from it. Runtime 10.1.0 (minor, no codegen change). `board_fs.py` added to `CORE_FILES`.
- 2026-10-14: built-in `stm32f405` processor and `pyboard-v10` board (named pins, SPI/I2C pin mappings, no WiFi).

## Still open

1. **Real-hardware verification.** The filesystem fix and the definition are untested on a pyboard -- the suite
   here is the unix port. Confirm a real Deploy/RESUME, and that `machine.I2C(bus, scl=..., sda=...)` and
   `machine.SPI(bus, ..., sck=...)` accept the pyboard's integer bus id with explicit named pins (the codegen
   shape the display/I2C nodes emit). If they don't, the I2C/SPI nodes need a stm32-specific codegen path.
2. **A clear "not supported" message.** On HELLO from a processor with no definition, say pin nodes won't work
   and link the docs' "Adding a processor", instead of compiling with guessed numeric pins (AGENTS.md, "make the
   failure legible"). The Board menu note names the unknown chip but doesn't spell out that pin nodes can't be
   trusted.
3. **Onboard LEDs / switch -- exposed as pins.** The pyboard's four LEDs are on A13/A14/A15/B4 and the user
   switch SW is on X17 (PB3); the `pyboard-v10` board labels them (`LED_RED`/`LED_GREEN`/`LED_YELLOW`/`LED_BLUE`,
   `SW`) and the processor's `gpio` includes them, so a `gpio_out` can drive them via `machine.Pin("A13")`. They
   are also `pyb.LED(1-4)` / `pyb.Switch()`; a dedicated node for those isn't built.
