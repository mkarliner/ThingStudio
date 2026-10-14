# Decisions — Processor and board definitions (MVP item 4)

Status: detail file for `decisions.md`'s "Processor and board definitions" index entry.

- **2026-09-23 — Processor and board definitions built, pin checks now per chip/board. NOT yet
  verified on real hardware.** Brief: `chip-board-definitions-briefing.md`. Mike's answers to its five
  questions: user files live in `~/.thingstudio/processors/` (not `chips/`) and `~/.thingstudio/boards/`;
  built-in boards are the Pico, Pico W, Pico 2, LOLIN S2 Mini and the tested CYD (the CORE-ESP32-C3 in
  the brief's list was dropped). The other three suggestions (file contents, target choice, severity)
  were taken as written.
- **Where the data lives.** Built-ins are JSON files in `editor/src/definitions/processors/` and
  `boards/`, bundled into the editor (`builtin.ts`, `import.meta.glob`) so direct-WebSerial mode and a
  fresh install have them with no backend or user files. User files come from the backend's new
  read-only `GET /api/definitions` (`PersistedStore.list_definitions`), which only checks file names and
  JSON syntax. Field validation lives once, in `editor/src/definitions/definitions.ts`. Chose separate
  folders over reusing the presets store: presets are per-node property bundles written by the app;
  these are reference data written by hand, and a board names its processor.
- **Id is the file name**, never a field inside the file, so the two can't disagree. A user file with a
  built-in's id replaces it whole (no field merging), and the replacement is logged. An invalid user file
  never silently falls back: it's logged in red, listed under "Invalid files" in the Board menu, and the
  built-in stays in use.
- **Strict validation: unknown keys are errors.** A typo'd `"reserverd"` silently ignored would mean a
  pin check silently not running. Pin lists take numbers and `"a-b"` ranges; `reserved`/`avoid` are
  pin-or-range → reason maps; every pin named anywhere must be in `gpio`.
- **Processor fields:** `name`, `match`, `nativeArch`, `nativeArchConfirmed`, `gpio`, `inputOnly`,
  `noPull`, `reserved`, `avoid`, `spi` (`maxHz`, `otherPinsMaxHz`, per-bus `fastPins` or `pins`), `i2c`
  (per-bus `pins`), `notes`. **Board fields:** `name`, `processor`, `match`, `pins` (label → GPIO, UI
  only), `gpio` (narrows the processor's), `reserved`, `avoid`, `notes`. Flow files still store GPIO
  numbers only (copy-on-apply, as for presets).
- **Target choice.** New toolbar **Board** menu: Auto (default), each board, each processor alone. Auto
  reads HELLO's `chipType` (`"<board> with <MCU>"`). Board `match` compares exactly with the part before
  " with " (a substring match would let "Raspberry Pi Pico" claim a Pico W); processor `match` is a
  substring of the MCU part, punctuation-insensitive, longest wins ("ESP32S2" beats "ESP32"). A manual
  pick wins over detection, with a red console line when the connected board's processor disagrees. The
  CYD reports as `Generic ESP32 module with ESP32`, so it can only be picked by hand. The flow file does
  not record the board (see outstanding items).
- **Severity.** Errors: pin not on the chip/board, reserved pin, output on an input-only pin, SPI/I2C
  bus or bus pin the chip can't use, SPI speed over the limit. Warnings (compile continues): `avoid`
  pins, a pull asked of a `noPull` pin, and no target known (then only 0-48 is checked). New
  `CodegenContext.warn`/`target` and `CompileResult.warnings`; warnings are logged on Deploy and appended
  to the source preview as `# WARNING:` comments (after the source, so preview line numbers still match).
- **A board's labelled pins drop the processor's `avoid` warning** for that pin (the CYD's display DC is
  strapping pin 2 by design); the board's own `avoid` entries still apply. Without this every CYD flow
  warned about its own display wiring.
- **Reserved on classic ESP32: GPIO 1/3 (UART0), not just 6-11 (flash).** Every classic ESP32 board
  talks to Thingstudio over UART0, so driving those pins cuts the link. On S2/S3/C3 the USB/UART pins
  are only `avoid` at processor level (it depends on the board), and `reserved` on boards known to use
  them (S2 Mini: 19/20 native USB, 26 PSRAM).
- **ESP32 SPI limit is 27 MHz off the bus's fast pins, and it's an error, not a warning.** Source:
  ESP-IDF's SPI master docs (80 MHz on IO_MUX pins, 26.6 MHz full-duplex via the GPIO matrix) and the
  2026-09-18 CYD crash (`learnings/hardware-bringup-hil-rig.md`: 40 MHz → invalid device handle →
  Guru Meditation boot loop). 27 MHz rather than 26.67 MHz because 27 MHz is the value tested on real
  CYDs (ESP-IDF rounds it down to 80/3 MHz). Fast pins per MicroPython SPI id, from MicroPython's
  `machine_hw_spi.c` and ESP-IDF's `spi_pins.h`: ESP32 id 1 = 14/13/12, id 2 = 18/23/19; S2/S3 id 1 =
  12/11/13, id 2 has none; C3 has only id 1 (6/7/2). No matrix limit is set for S2/S3/C3: TiDAL (S3)
  runs 40 MHz on id 2 through the matrix, and ESP-IDF's check is ESP32-only.
- **RP2 bus pins are an error when wrong.** SPI: bus = bit 3 of the pin, role = pin mod 4 (0 MISO, 2
  SCK, 3 MOSI), matching MicroPython rp2's `machine_spi.c` `IS_VALID_*` macros. I2C: bus = bit 1, even =
  SDA. RP2350's 30-47 follow the same pattern (RP2350B only; the Pico 2 board narrows to 0-29). SPI
  maxHz 62.5 MHz (RP2040) / 75 MHz (RP2350), half the default system clock.
- **Native arch.** Auto now uses the target processor's `nativeArch`; with no target it falls back to
  `native-arch.ts`'s `inferNativeArch()`, kept because it also covers chips no definition has yet
  (ESP32-C6). A test keeps the two in step for every built-in processor.
- **Property panel.** Pin inputs' `max` follows the target (was a fixed 39 on 13 inputs), and a hint
  under each shows the board's label (`TFT_DC`) or "reserved" / "avoid" / "not on this board".
- **2026-09-24 — Built-ins are copied into `~/.thingstudio/processors/` and `boards/` on backend start,
  missing files only (Mike's call).** Mike wanted users to copy and modify the built-ins without the
  repo. First draft rewrote a separate `~/.thingstudio/built-in/` reference folder on every start; Mike
  preferred copying only missing files into the live folders, so a user edits a built-in in place and
  recovers the original by deleting the file and restarting the backend. `builtin_reference.py`, called
  from `__main__.main()` (not `create_app()`, so tests never write to a real home). Accepted cost: a
  later version's fix to a built-in doesn't reach an existing copy, edited or not, until it's deleted.
  To keep untouched copies quiet, the editor only logs "replaces the built-in" when a user file's
  content differs from the built-in. Runs at backend start because there is no install step yet;
  packaging (MVP item 7) must ship `editor/src/definitions/` alongside the backend. No built-in presets
  exist yet; if some are added they should follow the same copy-missing rule.
- **2026-09-24 — Auto shows its choice in the Board menu** by relabelling the Auto option ("Auto:
  LOLIN S2 Mini", "Auto: ESP32 (any board)", "Auto: unknown board"), not by selecting that board.
  Selecting it would turn Auto into a manual pick that stops following the next board connected.
- **2026-09-24 -- A manual Board menu pick goes back to Auto when a board with a different processor connects**
  (Mike's call, over keeping the pick and blocking Deploy, or only warning louder). Found moving from the CYD
  to a Pico: the CYD pick stuck, so pins and native arch were still the ESP32's. A pick for the same processor
  stays (that's how the CYD gets picked). `target.ts`'s `choiceForConnectedBoard`, called on HELLO.
- **2026-09-30 — "Pins…" page (Mike, `mikes-questions-and-points.md`: "a button by the board and processor drop
  downs that will show a human readable page of their definitions").** Built in the editor from the resolved
  Target (`definitions/definition-page.ts`), the object the pin checks read, so page and compile agree. Opens in
  one named tab; each click re-reads `~/.thingstudio`'s definition files first (Mike: edits must show at once),
  so clicking again refreshes it. Named pins first, then every GPIO with status (free / limited / avoid: compile
  warns / reserved: compile stops) and reason, then SPI/I2C bus pin rules, then which files to edit. The tab is
  opened before the async re-read, since Safari blocks `window.open` after an `await`.
- **2026-09-30 — Boards can say what each physical pin carries (Mike: "include the physical pin that a given
  gpio is connected to and also gnd and power pins to avoid nasty accidents").** New optional board key
  `header`: physical pin -> GPIO number or a label ("GND", "3V3(OUT)", "RUN"). Validated: a GPIO must exist on
  the board and appear once. The Pins… page draws a 1..N header as two columns like the board, power red and
  ground grey (a label containing "GND" is ground first, so AGND isn't mistaken for power), and adds the header
  pin to the named/all pins tables ("not on the header" for the Pico's LED). Data only from the maker's own
  pinout: Pico, Pico W and Pico 2 from Raspberry Pi's pinout SVGs (their documentation repo), all three
  identical; a test checks every GPIO but 23/24/25/29 is on it. LOLIN S2 Mini and CYD left without a header:
  Wemos doesn't number the S2 Mini's pins and the CYD's connectors are community-documented only.
- **2026-10-12 — Boards can lift processor pin rules with `free` (Mike, adding the LuatOS ESP32C3-CORE).**
  The C3 processor file reserves GPIO 12-17 as flash pins, but this board runs its flash in DIO mode and wires
  its LEDs to 12 and 13. Mike rejected both narrowing the processor's reservation (leaves QIO/in-package-flash C3
  boards unprotected) and downgrading 12-13 to avoid (a warning that's wrong on this board). New optional board
  key `free`: a pin list that drops the processor's `reserved` and `avoid` entries for those pins in
  `buildTarget`. The board's own `reserved`/`avoid` can't name a `free` pin (validation error), and `free` pins
  must be on the board. Board file `luatos-esp32c3-core.json` from the LuatOS wiki pinout, untested on hardware.
- **2026-10-12 — The editor says when a user file is an old, unedited copy of a built-in (Mike: "yes").** Found
  when the backend copied a first draft of the LuatOS board into `~/.thingstudio/boards/` and that copy quietly
  beat the fixed built-in. Files are still never overwritten. `copy_missing_builtins` now records a sha256 per
  copied file in `<kind>/.builtin-copies` (no `.json` suffix, so it's never listed), and records an existing file
  that already equals the built-in. `/api/definitions` adds `untouchedCopy`. An untouched copy that differs from
  the current built-in goes in `DefinitionSet.staleCopies`, not `overrides`, and the console says to delete it.
  It's still used, as before. Copies made before this and since changed can't be told apart, so they get no line.
- **2026-10-12 — Header numbering and USB end (Mike, from the LuatOS board's pinout picture).** The LuatOS
  ESP32C3-CORE numbers its right row top to bottom (17 opposite 1), not back up like the Pico, so the Pins… page
  drew it wrong. New optional board keys, both needing `header`: `headerOrder` ("around", the default, or "down")
  and `usb` ("top" = the pin 1 end, or "bottom"). The page draws a USB row at that end and says so in words. Set
  on the four boards with a header: Pico, Pico W, Pico 2 top; LuatOS bottom, "down". The LOLIN S2 Mini, CYD and
  Freenove have no `header`, so there's nothing to show the USB end against.
- **2026-10-14 — Named pins (Mike: "architect support for eg: PyBoard, implies gpio pins as strings as well as
  ints").** A pin id is now a number or a name: `PinId = number | string`. A string in a pin list is a range
  (`"4-7"`) only when it looks numeric -- those still expand to numbers, so every existing definition, flow and
  built-in is unchanged -- and a named pin otherwise (`^[A-Za-z][A-Za-z0-9_-]*$`, the STM32 pyboard's `X1`/`A13`).
  Named *ranges* aren't supported; list names one by one. The board/processor descriptor accepts names anywhere a
  pin goes (`gpio`, `inputOnly`, `noPull`, `reserved`, `avoid`, `free`, `pins`, a bus's pins, SPI `fastPins`). In a
  board's `header`, a string value that names one of the board's pins is that pin; any other string stays a label
  (`"GND"`) -- so a named pin always wins over a same-spelled label. This is the interface change permission Mike
  gave the same session (`interfaces/board-descriptor/` SPEC + schemas updated).
  Codegen: `checkPin`/`checkOptionalPin` return a `PinId`; a named pin is emitted as a quoted Python literal
  (`machine.Pin("X1", ...)`, `runtime.shared('pin', "X1", ...)`), and the pin-derived variable names
  (`_gpio_*`, `_ebutton_*`, `_irq_*`, ...) hex-encode anything but `[A-Za-z0-9]` so two different names can't
  collide on one variable. No `device-runtime/src` change: `runtime.shared`'s key was always arbitrary, so no
  version bump. With no target, a named pin is allowed with the existing no-target warning (it can't be checked).
  UI: one shared `editor/src/app/rete/PinField.vue` -- a number input on a numeric target, a dropdown of the
  target's pins on a named-pin one, a text field with no target -- used by every pin-taking node and the I2C/touch
  config forms (config-types.ts gains a `pin` field kind).
  Scope: this is the mechanism. STM32/pyboard deploy still needs the separate filesystem-root fix
  (`outstanding-items/stm32-pyboard-support.md`). Custom nodes don't get a `pin` property kind yet (later).
- **2026-10-14 — First named-pin built-in: `stm32f405` processor + `pyboard-v10` board.** gpio is the pyboard's
  header pins (X1–X12, X17–X22, Y1–Y12; X13–X16 are reset/ground/power, not GPIO), from the PYBv1.0 `pins.csv`.
  SPI/I2C bus pin lists are the F405's hardware mappings (`spi.maxHz` 21 MHz, SPI2's limit). `wifi: false`. The
  board's four LEDs are `pyb.LED(1-4)`, not header pins, so `pins` is `{}`. Not verified on hardware. The
  filesystem-root fix that makes a pyboard deploy at all is in `board_fs.py` (`learnings/micropython-device-runtime.md`).
