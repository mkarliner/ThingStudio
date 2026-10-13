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
3. **Real support (bigger).** STM32 pins are named (`X1`, `A13`), not numbered, and the pyboard's LEDs are
   `pyb.LED(n)`, not pins. The pin model (`checkPin`, definitions' integer `gpio`, `machine.Pin(<int>)` codegen,
   `runtime.shared('pin', <int>, ...)`) assumes integers throughout. Needs a decision on named pins in definitions
   and codegen before any STM32 processor definition is useful.
