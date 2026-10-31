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

## Steers from Mike, 2026-10-07

- **Two displays (Q5) is an architecture constraint only.** Answered on paper; not built or tested.
- **The Freenove FNK0104B isn't to hand yet** (Mike is ordering one). The spike continues without it. It is the
  board for the marketing videos, to show off the best.
- **The hero app must work at lower colour depth on the CYD** (gs4, and ideally gs2/mono), not rely on RGB565.

## Findings

Status: desk and host results in, 2026-10-07. Board numbers (Q6 RAM, Q7 speed) pending: run the scripts in
`pocs/nano-gui-spike/` on the CYD (and Pico W + OLED, optional) and paste the output back. nano-gui read at
`ff2aad51c3aa3d264f16efa324d935206171693a` (2026-06-13). Host runs used the MicroPython unix port
(1.30-preview, 64-bit). Pictures of every page state: `pocs/nano-gui-spike/shots/`.

### Recommendation: vendor parts

Take `gui/core/writer.py` (`Writer`/`CWriter`, ~300 lines), `drivers/boolpalette.py` (20 lines) and the
`font_to_py` font format and tool. Write our own widgets and surface. Don't take `nanogui.py`/`DObject`,
`colors.py`, the widgets or the drivers.

Why:

- **The text renderer is the valuable part.** Proportional fonts, colour glyph blits through `framebuf`, string
  measurement. It needs only a `FrameBuffer` with `width`/`height` (plus `palette` for colour). `writer.py`
  imports only `framebuf` and `uctypes`.
- **The widgets are small and fight our model.** Label/Meter/LED are 58/63/28 lines. For the hero page, Meter's
  `show()` had to be replaced outright, LED's partly; only Label was reused as-is. `DObject` brings the problems
  in Q1 below.
- **The core is coupled to one display.** `nanogui.py` imports `colors.py`, which imports a module that must be
  named `color_setup` and export one `SSD`. That is a one-display assumption baked into the import graph.
- **Its drivers aren't needed.** Our own surface over `display_spi`'s buffers works unchanged (Q2).

Everything the spike needed beyond `Writer` came to ~150 lines (`state_widgets.py`), already state-aware.

### Q1 — Positions from outside

Works, with catches. Each is a rule our widgets must follow or fix:

1. **Off-by-one at the right and bottom edges.** `DObject` clamps with `row + height >= device.height`. A
   widget whose rect ends exactly on the edge is moved 1px up/left, with only a `print` warning.
2. **Label height comes from the font**, not the rect.
3. **No clipping to the rect.** Text longer than its label paints over neighbours (a 40px label drew to x=212).
   `Writer` only discards glyphs at the screen edge.
4. **Borders are drawn 2px outside the rect.** The rect must be inset by 2 to keep the border inside.
5. **Widgets draw on construction.** `Meter.__init__` calls `show()`; so does `Label` when given text.

Consequence for the layout engine: a bound value's rect must fit its **widest** value, not the value seen at
compile time. On a 128x64 OLED, "21.9" in 32px digits is 103px wide but "-10.5" is 120px. Overflow at
runtime needs its own attributed error or truncation; nano-gui gives neither.

### Q2 — Frame formats and drivers

nano-gui's widgets and `Writer` draw into any `FrameBuffer` subclass with `width`, `height` and (for colour text)
a `BoolPalette`. The spike's `Surface` (~30 lines) wraps `display_spi`'s own gs4/gs2/mono buffers. The page was
pushed through a copy of `display_spi`'s viper expand path; a stand-in panel rebuilt the frame and it matched
the page in all three formats. **No nano-gui driver needed; no change to `display_spi`'s frame contract.**
Our vendored `ssd1306` driver is itself a `FrameBuffer` with `width`/`height`, so `Writer` draws on it directly.

- nano-gui's own TFT drivers use the same idea as `display_spi`: a 4-bit indexed buffer, a 16-entry RGB565 LUT,
  viper expansion line by line.
- **Mono with plain `Writer` ignores colours.** White-on-black needs the `invert` flag. `CWriter` works on a
  mono surface if the surface supplies a `BoolPalette`.
- **ILI9341 (Freenove):** nano-gui ships `ili9341.py` (4-bit) and `ili9341_8bit.py`, no 16-bit RGB565 driver.
  Full colour on the Freenove would be `display_spi`'s rgb565 path plus an ILI9341 init sequence, taken from
  nano-gui's driver or from rdagger/micropython-ili9341, which it is based on. Full RGB565 at 240x320 with
  PSRAM is untested: no board.
- nano-gui's CYD setup example (`setup_examples/ili9341_esp32_2432S028r.py`) drives the CYD as an ILI9341.
  Ours is confirmed ST7789-compatible; CYD variants differ.

### Q3 — Unknown and stale

All drawable without forking nano-gui, in gs4, gs2 and mono (`shots/host-page-states.png`):

- **Readout and bound text:** two plain Labels; unknown shows `--`, stale draws in the dim palette entry. No
  dim tone in mono, so stale gets a dotted underline.
- **Bar:** subclassing Meter bought nothing. `Meter.show()` crashes on `None` and its BAR style is a fixed 4px
  stripe, so `show()` was replaced. Unknown is a dashed outline with no fill; stale is a dim fill, or a hatched
  fill in mono.
- **Status LED:** unknown is a dashed ring; stale is dim, or a hollow ring in mono. `LED.show()` is reused for
  the disc.

- **Trend (moving histogram), added 2026-10-07 at Mike's request:** our own widget, no nano-gui code. Draws a
  series from a `journal` stand-in (`journal.py`, an `array('f')` ring); gaps show as a baseline tick. Unknown
  (no history) is a dashed outline; stale is dimmed columns, or hatched in mono. Host: 50-column redraw well
  under 1ms; a 50-entry ring is 200 bytes. The CYD bench times trend redraw plus pushing only its rect.

### Q4 — Clip and offset (banding)

**Yes, without changing nano-gui.** `band.py` (~40 lines) is a `FrameBuffer` over a 40-row strip that reports
the full screen size and shifts every drawing call up by the strip's offset; `framebuf` clips the rest.
Rendering the page in six 40-row bands gave a frame **byte-identical** to the full-frame render, in gs4, gs2
and mono. Band buffer at 320 wide: 6,400 B gs4, 3,200 gs2, 1,600 mono.

Costs: a Python call per drawing primitive; every widget crossing a band is redrawn for each band it crosses,
text included. Board timing pending (the bench measures it). Subclass gotcha: a Python subclass of
`FrameBuffer` must call `super().fill_rect(...)`; `framebuf.FrameBuffer.fill_rect(self, ...)` raises
`TypeError`.

### Q5 — Multiple surfaces (on paper)

`Writer` keeps text state per device (`Writer.state`, keyed by `id(device)`) and `DObject.devices` is per
device, so two surfaces can coexist. Two blockers, both in the parts not recommended: `colors.py` binds to one
`SSD` through `color_setup`, and nano-gui drivers keep the LUT as a **class** attribute, so two panels on the
same driver class share one palette. Taking only `Writer` + `BoolPalette` avoids both; each surface keeps its own
palette, as each `display_spi` node already does.

### Q6 — RAM

Exact by format, 320x240: full frame 38,400 B gs4, 19,200 gs2, 9,600 mono.

Host, 64-bit, indicative only (code and objects will be smaller on 32-bit ESP32/RP2):

| Item | Bytes |
|---|---|
| nano-gui core + Label/Meter/LED + spike wrappers | ~23,000 |
| Widget objects, hero page (9 items) | ~5,000 |
| Fonts for the hero page (digits48 subset + body16 + body20) | ~19,900 |

Board figures pending: `bench_cyd.py` prints RAM per stage; `bench_pico_oled.py` does the same on a Pico W,
optionally with WiFi up.

### Q7 — Redraw speed

Pending board runs. Host draw times are under 1ms for the whole page, but the host can't time SPI or show ESP32
Python speed. Wire time alone at the CYD's 27MHz: full RGB565 frame 153,600 B ≈ 46ms; the readout's rect alone
(220x54, 23,760 B) ≈ 7ms. The bench measures full-frame push, readout-rect push and banded draw+push.

### Q8 — Fonts

DejaVu as a stand-in. RAM measured on import of the `.mpy`, which tracks file size closely: font data stays
in RAM when imported from the filesystem.

| Font | `.mpy` | RAM |
|---|---|---|
| digits 24px bold, subset `-.0-9` | 1,418 | 2,912 |
| digits 32px bold, subset | 2,056 | 4,096 |
| digits 48px bold, subset | 3,979 | 4,800 |
| full ASCII 48px bold | 21,228 | 22,080 |
| body 10px, ASCII + ° | 2,523 | 3,616 |
| body 16px, ASCII + ° | 4,199 | 5,184 |
| body 20px, ASCII + ° | 5,071 | 6,048 |

A digits-only subset is ~4.6x smaller than full ASCII at 48px. The default `font_to_py` charset has no `°`;
pass it explicitly. Bytecode-only `.mpy` (header `M\x06\x00`) loads on any MicroPython 1.20+ regardless of chip.

### Q9 — Viper/native

Only in the drivers: `_lcopy` is `@micropython.viper`, `show()` is `@micropython.native`. `Writer`, `CWriter` and
the widgets are plain Python, so the recommended parts need no bytecode twin. `CWriter` uses
`uctypes.bytearray_at`/`addressof`; `uctypes` is on by default on ESP32 and RP2, but is a port option elsewhere.
Plain `Writer` (mono) doesn't use it. `nanogui.py` refuses firmware older than 1.20.

### Q10 — Monolith check

No event loop, no screen stack, no refresh policy. `refresh()` is optional; we never called it. Async exists
only in the drivers' `do_refresh()`. The only global coupling is the `color_setup` module convention and the
`DObject.devices` class registry, both avoided by the recommendation.

### Also found

- The CYD bench draws landscape (320x240). Landscape MADCTL isn't confirmed on our unit, so the script lists four
  candidates.
- After Mike decides: update `gui-layout-widget-system-scoping.md` ("Existing packages", "Open questions") and
  add a line to `decisions/gui-layout.md`. Any vendored part then gets the full vendoring treatment on main.
