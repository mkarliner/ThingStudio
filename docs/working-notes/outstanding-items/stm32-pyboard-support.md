# STM32 / pyboard support

Status: open, 2026-10-13. Found connecting a pyboard v1.0 (`PYBv1.0 with STM32F405RG`) and deploying the blink
flow: `DEPLOY_ERROR OSError [Errno 19] ENODEV`, and `LISTENER_BOOT_ERR could not write boot counter: OSError(19,)`.
The runtime itself installed and ran.

Done 2026-10-13: `-march` for STM32F4 is `armv7emsp` (native-arch.ts; it was the unconfirmed `xtensawin`
fallback), and the console says "a guess" instead of "auto-detected" when no definition or known chip matches.

## Open

1. **Filesystem root (runtime, cheap).** Every path the runtime writes is absolute under `/`: `_FLOW_PATH`,
   `_STATIC_DATA_PATH`, `_FLOW_META_PATH`, `_WIFI_PROVISION_MARKER_PATH`, `_BOOT_COUNT_PATH` (listener.py), flow
   libraries in `/lib` (deps.py), and the free-space report's `os.statvfs("/")`. ESP32 and RP2 mount their
   filesystem at `/`; the stm32 port mounts it at `/flash` (or `/sd` when booted from a card) and `/` holds only
   the mount points, so every write fails with ENODEV. The runtime installer works because it writes relative paths
   (cwd is `/flash`). Fix: take the root once at startup from `os.getcwd()` and build every path from it; check
   `sys.path` covers `<root>/lib`. Minor runtime bump (no codegen change); run the real MicroPython suite.
2. **A clear "not supported" message.** On HELLO from a processor with no definition, say pin nodes won't work and
   link the docs' "Adding a processor", instead of compiling with guessed numeric pins (AGENTS.md, "make the
   failure legible").
3. **Named pins -- done 2026-10-14.** A pin id is now a number or a name (`PinId`): definitions, `checkPin`, the
   SPI/I2C checks, codegen (`machine.Pin("X1", ...)`) and the shared `PinField.vue` all take named pins, and a
   pyboard processor/board (`gpio: ["X1", ...]`) is describable. See
   `decisions/chip-board-definitions.md` (2026-10-14). What's left for real support is item 1 (the `/flash`
   filesystem root), a built-in `stm32f405`/pyboard definition, and the pyboard's onboard LEDs (`pyb.LED(n)`,
   not pins) if a node should drive those.
