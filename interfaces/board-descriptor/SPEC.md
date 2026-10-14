# Board and processor descriptor — v1 specification

Status: v1, shipped. This is the format of the JSON files a user writes in `~/.thingstudio/boards/` and
`~/.thingstudio/processors/`, and the built-ins the editor ships in `editor/src/definitions/{boards,processors}/`.
Both come from the same format, so a built-in is just a file that happens to ship with the editor.

The authoritative prose is this file; the machine-readable contract is `board.schema.json` and
`processor.schema.json` (JSON Schema draft 2020-12, usable in an editor or validator). The parser that enforces
this is `editor/src/definitions/definitions.ts`. For a task-oriented walkthrough, see
`../../docs/user-guide/boards.md`.

Design intent: design doc §3. Rationale: `../working-notes/decisions/chip-board-definitions.md`.

## 1. File and identity

- **Location** — `~/.thingstudio/boards/<id>.json` and `~/.thingstudio/processors/<id>.json`; built-ins under
  `editor/src/definitions/`.
- **Id** — the file name without `.json`. Lowercase letters, digits, `-` and `_` (`^[a-z0-9][a-z0-9_-]*$`). It is
  never a field inside the file, so the two can't disagree.
- **Overrides** — a user file with the same id as a built-in replaces it whole; there is no field-level merging.
- **Validation is strict.** An unknown key is an error, not ignored (a typo'd `reserverd` would otherwise mean a pin
  check that silently doesn't happen). Every problem is reported with the file it came from.

The editor loads these files on start, on connect and on deploy. An invalid file is not loaded; the built-in it
would have replaced stays in use, and the problem is listed (Board menu's "Invalid files", plus the console).

A definition file is exactly one object. All keys are optional unless the table says required. A "pin or range"
string is `"5"` or `"6-11"`; pins are 0–255.

## 2. Processor

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Name shown in the Board menu. |
| `match` | string[] | yes | Substrings matched against the MCU part of `HELLO`'s `chipType` (the part after `" with "`), case-, space- and dash-insensitive. |
| `nativeArch` | string | yes | The `mpy-cross -march` value, e.g. `xtensawin`. |
| `gpio` | pin list | yes | Every GPIO the processor has; at least one pin. |
| `nativeArchConfirmed` | boolean | no | `false` marks `nativeArch` a guess (shown as unverified). Default `true`. |
| `inputOnly` | pin list | no | Pins that can't drive an output. Must be in `gpio`. |
| `noPull` | pin list | no | Pins with no internal pull resistors. Must be in `gpio`. |
| `reserved` | {pin/range: reason} | no | Pins that must not be used. Keys must be in `gpio`. |
| `avoid` | {pin/range: reason} | no | Pins that warn. Keys must be in `gpio`. |
| `spi` | object | no | SPI buses and speed limits (below). |
| `i2c` | object | no | I2C buses (below). |
| `notes` | string | no | Shown on the Pins page. |

`spi`: `maxHz` and `otherPinsMaxHz` (positive integers), and `buses` — an object keyed by bus number (as a
string, e.g. `"1"`). Each bus is `{}` (usable with any pins) or carries:

- `fastPins` — `{sck, mosi, miso}` GPIO numbers that reach the bus without the GPIO matrix (ESP32 family). Not a
  restriction.
- `pins` — when present, the **only** pins this bus can use, per role, as pin lists (RP2 family).

`i2c`: `buses`, same shape; each bus is `{}` or `pins` — `{sda, scl}` pin lists that are the only pins the bus can
use.

## 3. Board

A board names a `processor` and may narrow its pin set.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Name shown in the Board menu. |
| `processor` | string | yes | Id of a known processor. |
| `match` | string[] | yes | Board names MicroPython reports, exact (case-insensitive) against the part of `chipType` before `" with "`. `[]` to pick by hand. |
| `pins` | {label: GPIO} | yes | Human labels for pins, shown in the properties panel. May be `{}`. |
| `gpio` | pin list | no | The pins this board has, if fewer than its processor. Must be a subset of the processor's. |
| `reserved` | {pin/range: reason} | no | As for a processor; keys must exist on the board. |
| `avoid` | {pin/range: reason} | no | As for a processor; keys must exist on the board. |
| `free` | pin list | no | Pins the processor `reserved`/`avoid` that are fine here (e.g. a board running flash in DIO mode). Must exist on the board and not be in this board's own `reserved`/`avoid`. |
| `notes` | string | no | Shown on the Pins page. |
| `wifi` | boolean | no | `false` if the board has no WiFi radio (hides WiFi connect). Omit if unsure; unstated offers it. |
| `header` | {physical pin: GPIO or label} | no | What each physical pin carries, for the Pins page. A GPIO must exist on the board and appear at most once. |
| `headerOrder` | `"around"` \| `"down"` | no | Numbering of a 1..N dual-row header. Default `"around"`. Needs `header`. |
| `usb` | `"top"` \| `"bottom"` | no | Which end the USB connector is at (pin 1 top left). Needs `header`. |

## 4. How a board and processor are resolved

- Processors are resolved before boards, since a board names its processor.
- A board's `gpio`, when present, narrows the processor's set; `reserved`/`avoid`/`free`/`pins`/`header` are all
  checked against that narrowed set.
- At runtime, `HELLO`'s `chipType` (`"<board part> with <mcu part>"`) is matched: the board part against boards'
  `match`, the MCU part against processors' `match`. No match falls back to a processor-only target (pins checked
  against the processor's range).

## 5. Conformance

`editor/test/board-descriptor-schema.test.ts` asserts the key set in each JSON Schema equals the parser's
(`PROCESSOR_KEYS`/`BOARD_KEYS` in `definitions.ts`), so the published schema cannot drift from the code that
enforces it. The parser itself is covered by `editor/test/definitions.test.ts`.

Change these descriptors (a key, its type, or a validation rule) only with Mike's explicit permission — a format
users have written files against.
