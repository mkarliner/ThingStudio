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
