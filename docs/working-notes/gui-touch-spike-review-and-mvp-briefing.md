# Briefing: review the GUI/touch bring-up, then carry on to MVP

Status: brief, 2026-10-09. Written at the end of the Freenove bring-up session (2026-10-08). Nothing here is committed
yet: Mike commits.

**Who this is for:** an implementation session. First review what the last session built (it was fast, and part of
it has only been tested against fakes), then continue down the launch path in `launch-mvp-scope-briefing.md`.
Marketing sessions: not yours.

Read first: `launch-mvp-scope-briefing.md` (the launch gates and the headliner spec), `road-to-mvp.md` (the finish
line), `gui-layout-widget-system-scoping.md` and `decisions/gui-layout.md` (the GUI design), `touch-input-briefing.md`.

## What the last session delivered

Hardware: Mike's **Freenove ESP32-S3 Display 4.0" (FNK0104S, ST7796, 320x480, FT6336U touch)** runs the GUI in
portrait and landscape, in 16 greys and full colour (RGB565), with touch buttons. Mike confirmed display, colour and
landscape on the board, and that the "next page" button turns the page.

- **Memory.** The classic-CYD OOM was heap fragmentation. Fixes: banded rendering (`BandSurface`, ~5 KB strips) and
  runtime 9.2.0, which answers `DEPLOY_ERROR` ("no room to receive the flow") instead of timing out. The S3 needs the
  `SPIRAM_OCT` MicroPython build, or only ~121 KB of heap shows. In the FAQ and boards docs.
- **ST7796** in `display_spi` (own driver on the `ST77xx` base, `vendor/st7796py/`); board `freenove-s3-4in`.
- **Full colour** (byte-swapped RGB565 constants so strips are already in wire order; accent colour for bar fill and
  light-on) and **landscape** (MADCTL rotation 4 or 7).
- **`touch_i2c`** node (FT6336U driver `vendor/ft6336u/`): polls, sends `down`/`up` with `{x, y}`, swap/flip options,
  optional reset pin. **`gui_button`** widget, **`gui_touch`** node (hit-tests the visible page or modal, emits the
  button's name as topic with payload `down`/`up`). Down and up only, one finger.
- **Layout outline** (`ScreenOutline.vue`, `gui/screen-edit.ts`): read/write outline of each page's tree with
  move up/down, indent/outdent, remove, add, page order, modals. No preview, no drag. Edits `screens` through
  `screens-store.ts`.
- **Spike closed:** the frozen-firmware spike is closed ("fulfilled all its goals"). Frozen firmware is deferred but
  still in MVP (Mike).
- Docs: `nodes/touch-i2c.md`, `nodes/gui.md` (button, touch, layout outline, colour), `display-spi.md`, `boards.md`,
  `faq.md`, `debugging.md`. Flows: `test-flows/gui-hero-*.flow.json` (cyd, cyd-dummy, freenove, colour, landscape) and
  `gui-touch-freenove-s3-4in.flow.json`.

## Review: what to check, and why

**1. Things only tested against fakes. Verify on the board or say they aren't verified.**
- The FT6336U driver and touch axes. Portrait works (the button press lands). Landscape touch is untried: the
  swap/flip defaults are guesses.
- Press highlight. A fix went in on 2026-10-08 (press drawn at once, held 150 ms minimum). Mike hasn't confirmed it.
- `st7796py`'s init table was written from datasheet and library knowledge and works on Mike's panel; other ST7796
  panels (e.g. 3.5") are unconfirmed. Don't claim more than that in docs.
- The 9.2.0 OOM message path is covered by a unix-port test with a small heap, not by a real ESP32 run.

**2. Departures from what Mike said. Confirm he's happy, or change them.**
- Mike said "touch node -> gui screen". Built as touch -> **gui touch** -> logic, because `gui_screen` is a source
  with no input and giving it one means a compiler change. Cost: one extra node per screen. Alternative: let a
  source node also take input.
- `gui_button` is **allowed to be unwired** (new `allowUnwired` flag on `NodeDefinition`; the compiler otherwise
  rejects unconnected nodes). Check this doesn't weaken the "disconnected node" error anywhere else.
- Widgets can be **placed once only** (editor check in `gui/screens.ts`). The device side already supports a widget
  on several displays and has a test. Lifting the editor limit is the only change needed for multi-screen; Mike
  wants it architected, not built.
- A press stays drawn for 150 ms even after the finger lifts; the `up` event itself isn't delayed.

**3. Code worth a second pair of eyes.**
- `gui.py`: `touch()`, `_release()`, the new `release_at` handling in `step()`, and `last_push = None` to bypass the
  redraw rate limit. Check banded surfaces (which `step()` doesn't render) and modals.
- `screen-edit.ts`: pure functions, tested (8 tests). Check path handling when a widget is removed and re-added.
- `ScreenOutline.vue` has had no real-browser use beyond a smoke check; it uses h()-rendered children with an
  unscoped style prefixed `.outline` (scoped CSS doesn't reach them).
- `main.ts` now holds screens in `screens-store.ts`, not a local variable. Save/load/compile all read the store.

**4. Housekeeping.**
- Not committed. Commit groups: 9.2.0 runtime; ST7796 + board; full colour; landscape; touch + button + gui touch;
  layout outline; docs and notes. Remove `.git/index.lock` first if it exists.
- `make editor` after pulling, or the browser shows an old build.
- Update `decisions/gui-layout.md` and `outstanding-items.md` with: touch decisions (button in MVP; down/up only;
  gui touch node), the layout outline, and the spike closure. Some of this is written; check what is missing.
- Backend assets (`backend/.../_assets`) are built by `make`; the manifest gained `ft6336u` and `tsgui_button`.
- Tests: editor 863 passing; device-runtime tests under the unix-port binary (build it, or use `MICROPYTHON_BIN`).
  Two tests were flaky once (a backend ws-relay test and one editor test) and passed on rerun: find them.

## Continue towards MVP (suggested order)

Launch gates, from `launch-mvp-scope-briefing.md`: GUI system and headliner on the Freenove, newcomer test,
Homebrew/Windows, Pico W WiFi password.

1. **History graph widget (Mike asked, rrdtool/cacti style).** A travelling time-series line/bar graph. Design intent:
   time-stepped ring buffer (fixed sample step, not per message), fixed or auto range, optional consolidation
   (last/avg/max), history stored per widget with drawing stateless, memory-bounded (check the S3's PSRAM and the
   CYD's ~100 KB). It will show whether the widget interface needs changing (draw is stateless today).
2. **Seven-segment look.** Mike: "could just be a font". DSEG (OFL) via the font pipeline
   (`gui-font-pipeline-scoping.md`, `FONT_SOURCES`/`FONT_SIZES` in `runtime_manifest.py`). Keep the font set small
   (font data loaded from `.mpy` stays in RAM).
3. **The headliner flow** on the Freenove, per the spec: BME280, MQTT both ways, on-screen toggle button for a
   Tasmota plug or WLED strip, unknown/stale states, WiFi pulled -> screen says so. Needs: where the BME280 connects
   on this board (unknown), a toggle with ON/OFF shown on the button (a button already shows a bound value), the
   MQTT nodes, and a task guide in the docs. Acceptance: no function node needed for drawing or layout.
4. **GUI view (phase 6).** The outline is a stopgap. Decide with Mike how far to take it: a preview of each page
   (the layout engine already runs in the editor), then drag. "Cut widgets, not the layout model."
5. **Compile-time check of screen size against the display node** (not done), and the **modal close-reason** output.
6. **Headless compile/validate CLI**, then the **AI-authoring doc** (items 5 and 6 of the launch brief). The CLI
   comes first: an agent can only check its work if the compiler runs outside the browser.
7. **Download the generated Python** (small).
8. **Packaging and newcomer test:** Homebrew, Windows on real hardware, a newcomer from the target group, and
   confirm the Pico W password bug on hardware (see `mvp-remaining-work-briefing.md`).
9. **Frozen firmware** is still in MVP but deferred. Notes: `frozen-firmware-spike-briefing.md` (closed section) and
   the addendum under the flashable-image item in `outstanding-items.md`. Libraries already go as `.mpy`.

**Post-MVP, high priority (Mike):** user-made GUI widgets. Today a widget is a Python module (`natural`, `make`) plus
a TypeScript natural-size mirror (`widgets.ts`) plus entries in `gui.ts`, `screens.ts` and the manifest. The
proposal is a `.widget.json` descriptor plus `.widget.py`, modelled on custom nodes: inert data in the editor, the
Python compiled to `.mpy`, natural size declared as a number or small formula over properties.

**Not started, outside the touch MVP tier:** swipe/drag, sliders, `touch_spi` (XPT2046, needs calibration),
`display_i2c` strips, the ILI9341 controller for the 2.8" FNK0104B named in the launch brief (Mike's unit is the
4.0" ST7796; decide which board the headliner ships on), fonts read from flash on demand.

## Working rules that bit last session

- **Mac writes:** the container is not the Mac. Copy through the outputs folder and verify hashes. Docs that Mike
  edited directly on the Mac must be patched there, not overwritten from the container copy.
- Workflow files and the Makefile are protected from remote writes: hand Mike a patch.
- Don't state a hardware result you haven't seen. Wrong claims last session: libraries "go as source" (they are
  compiled to `.mpy` before `DEP_PUT`), and examples from the wrong Freenove model (FNK0115, an RGB-panel board).
- Follow `CLAUDE.md`: clear failure over per-board fixes; human-facing docs short, Node-RED style.
