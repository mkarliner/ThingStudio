# Briefing: board/processor definitions landed, hardware check next

2026-09-24. Handoff from the session that built MVP item 4 (processor and board definitions). The original
brief is `chip-board-definitions-briefing.md`; what was decided, and why, is in
`decisions/chip-board-definitions.md`. Read that decision file before changing anything here.

## First: is it committed?

The work was written into the repo on Mike's old machine but **not committed** when he moved. If
`git log` on the new machine has no commit like "Board/processor definitions...", ask Mike to commit and
push from the old machine first (`rm -f .git/index.lock` before `git add`; see CLAUDE.md's git rules).

## What's built (all editor/backend, no `device-runtime/src` change, no version bump)

- **Definition files.** Built-ins: `editor/src/definitions/processors/*.json` (esp32, esp32-s2,
  esp32-s3, esp32-c3, rp2040, rp2350) and `boards/*.json` (pico, pico-w, pico-2, lolin-s2-mini, cyd). The
  id is the file name. Code: `definitions.ts` (strict validator: unknown keys are errors), `target.ts`
  (HELLO `chipType` → board/processor), `pin-check.ts` (checks nodes call), `builtin.ts` (bundling).
- **User files** in `~/.thingstudio/processors/` and `boards/`. The backend copies any missing built-in
  in on start (`backend/.../builtin_reference.py`, never overwrites; delete + restart restores the
  original) and serves them read-only at `GET /api/definitions`. A user file with a built-in's id
  replaces it; the console only reports that when the content differs. Invalid files are logged in red
  and listed under "Invalid files" in the Board menu.
- **Board menu** (toolbar): Auto, or a board or a processor picked by hand. Auto relabels itself with
  what it found ("Auto: LOLIN S2 Mini") rather than selecting it. The CYD reports as a generic ESP32,
  so it's always a manual pick. The **Arch** menu (was "Native arch") shows its Auto choice the same way
  and now takes the arch from the processor file.
- **Checks** in all 7 pin nodes (gpio_out, pwm_out, interrupt, eswitch, ebutton, display_spi,
  display_i2c). Errors: a pin that doesn't exist, a reserved pin, an output on an input-only pin, a bad
  SPI/I2C bus or bus pin, SPI too fast. Warnings (`CompileResult.warnings`, logged on Deploy and appended
  to the preview): avoid pins, a pull on a no-pull pin, no target (checks fall back to 0-48). Pin fields
  in the property panel show the board's label or "reserved"/"avoid".
- **Docs:** `docs/user-guide/boards.md` (new, in the mkdocs nav), node pages updated, debugging.md's
  Arch section.

## Next: hardware check (nothing has run on a real board yet)

Rebuild first (`cd editor && npm run build`, `mkdocs build`), then `thingstudio-backend`.

1. **S2 Mini:** connect. The Board menu should read "Auto: LOLIN S2 Mini" and Arch "Arch: xtensawin".
   Blink on GPIO 15, then try `gpio_out` on 40 (was rejected before, should work now) and 23 (should fail
   to compile, naming the valid pins).
2. **CYD:** pick CYD by hand. `test-flows/display-spi-gs4-cyd-test.flow.json` at 27 MHz should compile
   clean and run. At 40 MHz it should fail to compile, not crash the board. Optional: `spiBus: 1` at
   40 MHz on the same pins should now be allowed. That's untested; if it works on real hardware, record
   it in `learnings/hardware-bringup-hil-rig.md`.
3. **Pico / Pico W / Pico 2:** Auto should find each. On the Pico W, `gpio_out` on 25 should fail as
   reserved.
4. Check that `~/.thingstudio/boards/` and `processors/` were filled on first start, and that editing
   one (e.g. adding a pin label) shows up after Connect or Deploy.

Log results in `outstanding-items/gpio-pin-range-by-chip.md`.

## Open follow-ups

Listed in `outstanding-items/processor-board-definitions-followups.md`:
- the flow file doesn't record its board;
- the Board menu choice isn't remembered across page reloads;
- CYD touch/SD/LED pins are unverified;
- no board-level defaults (e.g. seeding display_spi pins);
- ESP32-C6 has no processor file.

Mike also asked for built-in presets to be copied into `~/.thingstudio` the same way. None exist yet, so
nothing to do until some are added.

## Things to know

- **Two `editor/test/node-startup.test.ts` tests (and one tsc error in it) fail, but not because of
  this work.** They failed the same way before it started. Ask Mike whether startup-node work is in
  progress.
- **How the last session tested without touching the shared mount:** it copied the repo (without
  `node_modules`) into the cloud workspace and ran `npm ci --ignore-scripts`, tsc, vitest, vite build and
  backend pytest there, plus Playwright screenshots against a real backend started with a scratch `HOME`.
  Results went back through the gitignored `.verify-tmp/` as a tarball. The sandbox can't unlink files on
  the mount, so it overwrote each file in place with `cat src > dest` after checking for drift.
- **The ESP32 SPI rule:** the limit is 27 MHz unless SCK/MOSI are the bus's own IO_MUX pins (MicroPython
  id 1 = 14/13, id 2 = 18/23). The source is `learnings/hardware-bringup-hil-rig.md`'s 2026-09-23 entry.
- **Packaging (MVP item 7)** must ship `editor/src/definitions/`. The backend finds it by repo path,
  like `editor/dist` and `device-runtime/src`.
