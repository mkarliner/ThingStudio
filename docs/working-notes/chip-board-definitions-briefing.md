# Briefing: chip and board definitions (MVP item 4)

2026-09-23. Written at the end of the session that took a blank ESP32-S2 to a blinking LED using only the
product and its docs. Read `docs/road-to-mvp.md` first; this says where item 4 stands and what Mike wants.

## What Mike wants

MVP item 4 is "sensible defaults per chip family (pins, SPI speed)". Mike's direction, 2026-09-23:

> it's related to the presets mechanism, the config folder should have human generatable files defining the
> characteristics of processors and possibly boards (ie: which board pins are which gpios).

His earlier wording in `road-to-mvp.md` §1.3: "board and processor definitions should be human editable files
in the thingstudio config folder." And from the presets work (`decisions/presets.md`): a hand-edited file that's
invalid must be flagged loudly, never silently ignored.

So: **processor (chip) definitions**, and **board definitions** that map board pin labels to GPIO numbers, as
JSON files a person can write, in `~/.thingstudio`.

## Why now: a real bug

Every pin-taking node validates against a hardcoded 0–39 (the classic ESP32's range). ESP32-S2 goes to GPIO 46
and ESP32-S3 (an MVP chip) to 48; RP2040 stops at 29. Logged as `outstanding-items/gpio-pin-range-by-chip.md`.
The hardcoded checks:

- `editor/src/node-library/`: `gpio-out.ts`, `pwm-out.ts`, `interrupt.ts`, `eswitch.ts`, `ebutton.ts`,
  `display-spi.ts`, `display-i2c.ts` (grep `pin > 39`).
- `editor/src/app/rete/PropertyPanel.vue`: 13 `max="39"` inputs.

## What already exists to build on

- **Presets storage** (`backend/src/thingstudio_backend/persisted_store.py`, `admin_api.py`):
  `~/.thingstudio/presets/<type>/<name>.json`, open `type` namespace, eager parse with a per-file
  `valid`/`error` flag. `outstanding-items/presets-design.md` and `decisions/presets.md` explain the
  copy-on-apply choice (flow files carry real values, never a reference) — keep that for pins too.
- **Chip detection** (`editor/src/app/native-arch.ts`): `inferNativeArch()` pattern-matches HELLO's free-form
  `chipType` (`sys.implementation._machine`, e.g. `"LOLIN_S2_MINI with ESP32-S2FN4R2"`,
  `"Raspberry Pi Pico W with RP2040"`). The manual override is the toolbar's **Native arch** dropdown. This is
  the natural first field of a chip file (`nativeArch`), and the dropdown the natural place for a
  "Chip/board: Auto" selector.
- **Related, unscoped items** that would read from the same data: `board-processor-reference-data.md` (Mike's
  original ask for this folder), `named-labeled-pin-mapping.md`, `editor-board-awareness.md`,
  `board-specific-node-collections.md`, `pin-resource-conflict-detection.md`. Scope item 4 so they can sit on it
  later; don't build them now.

## Questions to settle with Mike before coding

1. **Where do the definitions live, and who writes the first ones?** Suggested: Thingstudio ships a built-in
   set (MVP chips plus a few common boards) in the repo, and files in `~/.thingstudio/chips/` and
   `~/.thingstudio/boards/` add to or override them by id. Alternative: reuse the presets store with types
   `chip`/`board`. Either way a user never has to write a file to get working defaults.
2. **What's in a chip file?** Suggested minimum: `id`, `name`, `match` (substrings of HELLO `chipType`),
   `nativeArch`, `gpio` (valid pins), `inputOnly`, `avoid` (flash/PSRAM/strapping pins, with a reason each),
   default SPI max speed. Candidates for later: PWM/ADC-capable pins, default I2C/SPI pins.
3. **What's in a board file?** Suggested: `id`, `name`, `chip`, `match`, `pins` (label → GPIO, e.g.
   `"LED": 15`), notes. Flow files still store GPIO numbers; labels are UI only.
4. **How is the target chosen?** Suggested: automatic from HELLO when connected; a manual pick when not
   (replacing or extending the Native arch dropdown); the flow file could record the board it was written for.
5. **What happens with a pin outside the chip's range, or on the avoid list?** Suggested: out of range is a
   compile error naming the chip and its range; avoid-list pins warn but deploy. With no chip known (never
   connected), fall back to the widest range and say so.

## Suggested order

1. Agree the file formats (questions above), then write the built-in definitions for the five MVP chips, and
   boards seen on real hardware: LOLIN S2 Mini (LED 15), Raspberry Pi Pico / Pico W (LED 25 on the Pico; the
   W's LED isn't a GPIO), CYD (`test-flows/` has its pins), LuatOS CORE-ESP32-C3.
2. Backend: load built-ins plus user files, validate loudly, serve them (a small `/api/definitions` or the
   presets routes).
3. Editor: one module that resolves the active chip/board, used by all 7 nodes' pin checks and the property
   panel; fold `native-arch.ts` into it.
4. Docs: a page per MVP chip (range, pins to avoid, defaults) — `road-to-mvp.md` §2 wants one anyway — plus
   how to write a board file.

## How the last session worked (worth keeping)

- **Hardware:** Mike runs the board; the agent can't see USB serial. Ask for console output and back-end log
  lines. A LOLIN S2 Mini (ESP32-S2) is set up with runtime 2.0.0.
- **Testing without touching the shared mount:** backend pytest in a venv copy under the device's
  `~/scratch`; editor tsc/vitest/vite build in a copy with its own `npm ci --ignore-scripts`; MicroPython unix
  port built in the cloud workspace (a background build on the device gets killed when the command ends).
  Files move between them through the gitignored `.verify-tmp/`.
- **Screenshots of UI changes:** build, tar `dist` into `.verify-tmp/`, stage it, serve and screenshot with
  Playwright in the cloud workspace (`executablePath: '/opt/pw-browsers/chromium'`). Caught a toolbar layout
  bug that reading the markup didn't.
- **Stale builds bite:** the back end now shows a red banner when `editor/dist` or `site/` is older than its
  sources. After editor or docs changes, remind Mike to `npm run build` / `mkdocs build`.
- **Version bump rule:** item 4 should be editor/backend only. If it touches `device-runtime/src`, apply
  CLAUDE.md's bump rule (runtime is 2.0.0 now).

## Also still open for the MVP

- Item 6, WiFi transport: needs Mike's answers to the three questions in `mvp-kickoff-brief.md`.
- Item 7, packaging and install routes. Item 8, remaining docs (task guides, chip/board/display pages).
- GitHub Pages returns 404 (`outstanding-items/documentation-site.md`).
- The acceptance test: a first-time user who isn't Mike, download to blink.
