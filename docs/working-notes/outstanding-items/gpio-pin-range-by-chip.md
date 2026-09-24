# GPIO pin range is hardcoded to 0–39

Found 2026-09-23 while writing the Blink an LED page. `gpio_out` (and `PropertyPanel.vue`'s pin input,
`max="39"`) reject any pin above 39 — the classic ESP32's range. ESP32-S2 goes to GPIO 46 and ESP32-S3 to
GPIO 48, both MVP-relevant (S3 is an MVP chip), and some S3 boards put their LED or other hardware up there.
RP2040/RP2350 top out lower (29 / 47 on the larger RP2350B), so 0–39 is also too permissive for RP2040.

Fits MVP item 4 (sensible defaults per chip family): the valid range should come from the connected
board's chip (`HELLO.chipType`, same source `native-arch.ts` uses), with a clear compile error naming the
chip's actual range. Check `pwm_out`, `interrupt`, `eswitch`/`ebutton` for the same hardcoded bound.

**Resolved 2026-09-23** (`decisions/chip-board-definitions.md`). Every pin-taking node (`gpio_out`,
`pwm_out`, `interrupt`, `eswitch`, `ebutton`, `display_spi`, `display_i2c`) now calls
`editor/src/definitions/pin-check.ts` against the Board menu's target; `PropertyPanel.vue`'s 13
`max="39"` inputs follow the target too. With no target the fallback range is 0-48. Still open: nothing
has been deployed through the new checks on real hardware yet. Worth doing on the S2 Mini (a pin above
39, e.g. GPIO 40) and the CYD (Board menu → CYD, the gs4 test flow at 27 MHz should compile clean;
40 MHz should fail to compile, not crash the board).

**Hardware check, 2026-09-24 -- LOLIN S2 Mini: pass (Mike).** Board menu auto-detected "Auto: LOLIN S2 Mini",
Arch menu "Arch: xtensawin". Blink on GPIO 15 deployed and ran. `gpio_out` on GPIO 40 deployed (rejected before
this work). `gpio_out` on GPIO 23 failed to compile, naming the valid pins. Still to do: CYD (27 MHz clean,
40 MHz compile error, optional `spiBus: 1` at 40 MHz), Pico / Pico W / Pico 2 auto-detect, Pico W GPIO 25
rejected as reserved. `~/.thingstudio/boards/` and `processors/` confirmed filled on first start (all 11 files
identical to the built-ins; existing flows and credentials untouched); editing one and seeing it after
Connect/Deploy not yet tried.

**Hardware check, 2026-09-24 -- CYD (picked by hand), 27 MHz: pass (Mike).** The gs4 and mono test flows
deploy and draw. The gs4 flow first hit a `MemoryError` on its `bytes(buf)` copy under runtime 2.0.0, not
related to this work; fixed by sending the `bytearray` itself (`learnings/hardware-bringup-hil-rig.md`,
2026-09-24). 40 MHz on bus 2 fails to compile, as intended; 40 MHz on bus 1 compiles and renders.
CYD done.

**Hardware check, 2026-09-24 -- Pico / Pico W / Pico 2: pass (Mike).** Auto detected each; GPIO 25 rejected as
reserved on the Pico W. Moving from the CYD to a Pico exposed a stuck manual Board menu pick, fixed the same day
(`decisions/chip-board-definitions.md`). Side finding: after the editor's Install runtime, the Picos needed a
power cycle (no reset button). Cause: the install's single Ctrl-C is ignored by a running listener
(`kbd_intr(-1)`), and a Pico doesn't reset when the port opens. Fixed 2026-09-24: Install runtime now sends
STOP_TO_PROMPT first and waits for a prompt like Remove flow (`board_recovery.catch_prompt`); confirmed on
the Pico the same day (Mike), both the connected path and unplug-and-replug. Editing `~/.thingstudio/boards/pico.json` (new name, extra pin label) showed up on the next Connect
with no restart: the override console line, the renamed Auto label, and the label in the property panel.
Deleting the file and restarting the backend restored the built-in, identical. **All hardware checks from
`board-definitions-landed-briefing.md` pass (2026-09-24).**
