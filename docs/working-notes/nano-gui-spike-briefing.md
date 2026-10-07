# nano-gui spike — briefing

Written 2026-10-06 at the end of the GUI brainstorm with Mike. Read
`gui-layout-widget-system-scoping.md` first, especially "Existing packages", "Pure Python vs. C",
"Memory and the Pico" and "Things to lock in now". Decisions: `decisions/gui-layout.md`.

## Goal

Decide how much of Peter Hinch's [micropython-nano-gui](https://github.com/peterhinch/micropython-nano-gui)
(MIT) the GUI subsystem should use for drawing:

1. **Vendor whole** — nano-gui's widgets are our widgets' draw layer.
2. **Vendor parts** — take individual draw routines plus `Writer`/`font_to_py`.
3. **Write our own** — read nano-gui for technique only.

The spike answers that question and nothing else. It does not build the GUI subsystem, layout engine or
GUI view.

## Work on a branch

Mike's call: the spike will likely touch a lot of code, so it lives on its own branch, not main.

```sh
rm -f .git/index.lock          # always first -- see CLAUDE.md "Git writes from the agent sandbox"
git switch -c spike/nano-gui
```

Git writes are Mike's to run in a real Terminal. Spike code is disposable; what goes back to main is the
findings, written into this file's "Findings" section and the scoping doc. Any vendored code that
survives gets the full vendoring treatment (pinned SHA, dual-method SHA-256 verify, per-directory README,
`docs/third-party-licenses.md` row) when it lands on main, not during the spike.

## Hardware

- A CYD (ESP32-2432S028R), stock MicroPython. The PSRAM variant too, if to hand.
- **The launch headliner board, if to hand: Freenove FNK0104B** (ESP32-S3, 2.8" 240x320 ILI9341 on SPI,
  FT6336U capacitive touch, PSRAM — amount unconfirmed). Added 2026-10-06: the launch plan
  (`launch-mvp-scope-briefing.md`, `decisions/launch-scope.md`) made this the hero board after this briefing
  was first written. Display pins from Freenove's docs (verify): MOSI 11, SCLK 12, MISO 13, CS 10, DC 46,
  backlight 45, no reset. MicroPython needs the ESP32-S3 build with octal SPIRAM for PSRAM to appear.
- Optional: a Pico W with a 128x64 SSD1306, for the small-GUI check.

## Questions to answer

Hand-written test scripts are fine; no codegen needed.

1. **Positions from outside.** Can nano-gui widgets be placed at rects our layout compiler supplies
   (x, y, w, h), without its own geometry getting in the way?
2. **Frame formats and drivers.** Does it fit `display_spi`'s gs4/gs2/mono `framebuf` frames and our
   vendored `st7789py_mpy`/`ssd1306` drivers, or does it insist on its own driver classes? What would
   joining the two cost? Note: the CYD panel is driven as ST7789-compatible today. **The Freenove board's
   panel is an ILI9341, which `display_spi` doesn't drive yet** (launch item: a second controller with real
   per-controller codegen). Note whether nano-gui ships an ILI9341 driver usable here, and whether full
   RGB565 at 240x320 (153,600 bytes) works with PSRAM, so the headliner can be full colour.
3. **Unknown and stale.** Can its Label/Meter/LED draw the unknown (`--`, no needle, dashed outline) and
   stale (dimmed / mono pattern) treatments, by subclassing or a thin wrapper, without forking?
4. **Clip and offset.** Can a widget draw into a band (a strip framebuffer with a y-offset) rather than
   the full frame? This decides whether banded rendering stays possible with nano-gui.
5. **Multiple surfaces.** Can two displays (TFT + OLED) run at once, each with its own framebuffer?
6. **RAM.** `gc.mem_free()` before and after import and after drawing a hero-app page, on CYD and Pico W
   (and the Freenove board, if to hand). Separate framebuffer, fonts and code.
7. **Redraw speed.** Time to update one readout and push (a) the full frame, (b) the changed rect only, if
   the driver allows. Is a rate-limited full-frame push acceptable for MVP?
8. **Fonts.** `font_to_py` output size for a big digit font (subset) and a body font; RAM when imported as
   `.mpy`.
9. **Viper/native use.** Which nano-gui code uses `@micropython.viper`/`native`, and does it need the
   plain-bytecode-twin treatment for unknown chips?
10. **Monolith check.** Does anything force it to own the event loop, refresh policy or a screen stack?
    (micro-gui was rejected for exactly that.)

## A sample page to draw

One hero-app page, hand-placed: a title bar, a big temperature readout with units, a pressure bar/meter, a
status LED and page dots. Draw it once in the known state, once with the readout unknown, once stale.

## Findings

*To fill in at the end of the spike:* answers to each question above, measured numbers, and a
recommendation (whole / parts / own) with reasons. Then update `gui-layout-widget-system-scoping.md`'s
"Existing packages" and "Open questions", and add a line to `decisions/gui-layout.md` once Mike decides.
