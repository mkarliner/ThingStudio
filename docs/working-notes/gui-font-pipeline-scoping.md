# GUI font pipeline — scoping

Status: built 2026-10-07 (option A, Atkinson Hyperlegible, both chosen by Mike the same day). Phase 2 of
`gui-layout-widget-system-scoping.md`'s phasing ("Font/metrics pipeline"), after flow dependencies (phase 1).
Blocks the layout engine (phase 3): layout needs exact text widths. Inputs: the nano-gui spike's findings
(`nano-gui-spike-briefing.md`, Q1, Q8) and the spike's `make_fonts.sh` on the `spike/nano-gui` branch.

## What the pipeline must give

1. **The board:** font modules in `font_to_py` format, drawn by Hinch's `Writer`/`CWriter` (the spike's
   recommendation: vendor `writer.py` + `boolpalette.py`, write our own widgets).
2. **The layout engine (editor):** exact string widths and line heights, the same numbers `Writer` uses.
   `font_to_py` fonts are fixed-height, proportional-width, no kerning: a string's width is the sum of its
   glyphs' widths. So per-glyph advance widths plus the height are the whole metric set.
3. **The GUI view's preview (editor):** the glyph bitmaps themselves, so the preview is pixel-exact
   ("Exact preview" in the GUI scoping note), not a browser font approximating it.
4. **Only the fonts a flow uses reach the board**, through flow dependencies (each font is a library).

## Facts that shape it

- **Font data imported from a `.mpy` stays in RAM** (spike Q8): RAM ≈ file size. Every font is a RAM cost,
  and on a classic ESP32 MicroPython has ~110 KB in total (FAQ, CYD figures). Fonts must be few and small.
- **Subsets pay.** Digits-only (`0123456789.-`) at 48px: 4.8 KB RAM vs 22 KB for full ASCII (spike Q8).
  Body 16px, ASCII + `°`: 5.2 KB. The default charset has no `°`; it must be passed explicitly.
- **A bound value's rect must fit its widest possible value** (spike Q1): "-10.5" is wider than "21.9". So
  the layout engine needs the widest glyph in a charset as well as the widths of known strings.
- **Bytecode-only `.mpy` works on any chip** (MicroPython 1.20+), so fonts need no per-architecture build.
- **The converter needs FreeType** (`freetype-py`), a native library. Fine on a developer machine or in CI;
  a cost if the installed backend had to carry it.

## Options

### Where the conversion runs

- **A. Prebuilt set, converted at build time (recommended for MVP).** A tool script (`tools/build_fonts.py`)
  runs `font_to_py` over a fixed list of (font, size, charset), and commits the `.py` sources plus one
  metrics/bitmap JSON per font. The backend serves them like other libraries; the editor reads the JSON.
  Deterministic, no FreeType in the shipped product, reviewable diffs. Cost: only the sizes and charsets
  we chose exist.
- **B. Per-flow subsets, converted by the backend at deploy.** The compiler knows every static string and
  the charset of every bound value, so it could ask for exactly those glyphs. Smallest possible RAM. Cost:
  FreeType in every installed backend (five platform bundles), conversion time on deploy, and fonts that
  differ per flow (cache and hash by content). Worth it only if RAM measurements say so.

A leaves B open if the device and editor reach fonts only through a lookup by font id (already a lock-in
item: "font glyphs are reached through lookup functions"). Nothing on the board would change.

### Charsets

- **digits:** `0123456789.-+:%` and space. For readouts, clocks, percentages.
- **body:** printable ASCII plus `°`, `±`, `µ`. Labels, titles, units, short text.
- Later, only if asked: Latin-1 for non-English labels.

Bound values pick their charset from the widget type (a numeric readout uses digits). A static label
containing a character outside its font's charset is a compile error naming the label and the character.

### Sizes

A short ladder per charset, chosen so a 320x240 TFT and a 128x64 OLED both have sensible steps:

- body: 10, 12, 16, 20, 24
- digits: 16, 24, 32, 48, 64

The placement in `screens` names a size from the ladder, per display. The layout engine reports overflow
with attribution if no size fits.

### Which font

Needs an open licence that allows redistribution in the repo and on boards, and good hinting, since
`font_to_py` renders 1-bit glyphs and unhinted outlines look ragged at 10-16px.

- **DejaVu Sans / Sans Bold** — the spike's stand-in. Bitstream Vera licence (permissive). Strongly hinted,
  reads well at small sizes, wide coverage. Looks a little dated.
- **Atkinson Hyperlegible** — OFL. Designed for legibility (distinct 0/O, 1/l/I), which suits readings at a
  distance. Less hinting; check at 10-12px.
- **Inter / IBM Plex Sans** — OFL, modern. Designed for screens with antialiasing; check 1-bit rendering at
  small sizes before choosing.
- **A pixel font for the smallest OLED sizes** (e.g. Terminus, OFL) — crisp at 10-12px where outline fonts
  struggle. Would mean two families.

Choosing is a look test: render each candidate at the ladder sizes in mono and gs4 on the host (the spike's
render path already produces PNGs), then on the CYD and an OLED.

## Look test, 2026-10-07 (host, 1-bit, exactly as `Writer` draws)

`font_to_py` (c247614, 2025-05-28) over DejaVu Sans 2.37, Atkinson Hyperlegible (googlefonts repo) and Spleen
(bitmap, BDF), at the ladder sizes with the charsets above; a sample CYD page and a 128x64 OLED page per family.

- **Both outline fonts render cleanly in 1-bit from 12px up.** At 10px DejaVu is a little cleaner; Atkinson's
  10px is cramped.
- **Atkinson tells 0/O (slashed zero) and 1/l/I apart; DejaVu doesn't** (its l and I are identical).
- **Atkinson's numerals are narrower.** "-10.5°C" in 32px digits fits a 128px OLED in Atkinson; in DejaVu the
  `°C` falls off the edge -- the widest-value problem (spike Q1) in practice.
- **RAM is close:** the hero page's eight fonts total 30.2 KB in DejaVu, 28.2 KB in Atkinson. Per font, e.g.
  body16 3.8 KB, digits48 4.2-4.6 KB, digits64 7.5-8.0 KB.
- **Spleen** is crisp at 8 and 12px but monospaced and retro; only worth adding for an 8px size.

## Built, 2026-10-07

- **Font:** Atkinson Hyperlegible, Regular for body, Bold for digits. **Ladder:** body 12/16/20/24 (10 dropped:
  Atkinson is cramped there), digits 16/24/32/48/64. Charsets as above.
- **The list** lives in `device-runtime/runtime_manifest.py` (`FONT_SOURCES`, `FONT_CHARSETS`, `FONT_SIZES`,
  `font_ids()`); each font is appended to `DEPENDENCIES` as `font_<charset><size>`, so the backend serves it and
  a flow that imports `font_body16` gets only that font.
- **`tools/build_fonts.py`** runs the vendored `font_to_py` (`tools/vendor/font_to_py/`) over `tools/fonts/`
  and writes `device-runtime/src/vendor/fonts/font_<id>.py` and `editor/src/gui/fonts/font_<id>.json`
  (height, baseline, max width, each glyph's width and bitmap, sample widths). `--check` fails on stale output.
- **Editor:** `editor/src/gui/font-metrics.ts` -- `textWidth`, `missingChars`, `widestWidth`, `glyphBitmap`.
- **Cross-check:** `device-runtime/test/test_fonts.py` imports every board module on the unix port and checks
  each glyph's width and bitmap against the editor JSON. Vitest checks the editor's widths against
  font_to_py's own sample widths.
- **Found:** font_to_py's line height isn't exactly the size asked for (body16 is 17px, digits48 is 47px).
  Layout must use `height` from the font, never the nominal size.
- **Size as `.mpy`** (≈ RAM when imported): body12 2.6 KB, body16 4.3, body20 4.5, body24 6.3; digits16 1.1,
  digits24 1.7, digits32 2.5, digits48 4.7, digits64 7.9.
- Not yet: `Writer` itself isn't vendored (that comes with the widgets); a check against `Writer`'s own
  `stringlen` belongs there.

## Proposed shape (option A)

- `device-runtime/src/fonts/` (or a `fonts/` asset folder the backend serves): generated `font_<id>.py`, one
  per (family, weight, size, charset), e.g. `font_body16`, `font_digits48`.
- `runtime_manifest.py` `DEPENDENCIES` gains one entry per font, generated from the same list the tool uses,
  so flow dependencies send only the fonts a flow's generated code imports.
- `editor/src/gui/fonts/<id>.json`: `{id, height, baseline, charset, widths: {char: px}, maxWidth,
  bitmaps: {char: base64}}`. Bitmaps only for the preview; the layout engine needs widths and height.
- `tools/build_fonts.py`: one list of fonts, regenerates both outputs; CI checks the committed outputs are up
  to date (like `build_assets.py`).
- **Cross-check test:** on the unix port, `Writer` string lengths for a sample of strings equal the
  editor JSON's sums. Keeps the board and the layout engine from drifting.
- Licence rows in `docs/third-party-licenses.md`: the font, and `font_to_py` (MIT) as a build tool.

## RAM budget check (hero app on a CYD)

Title (body20), labels and units (body16), one big readout (digits48), a small readout (digits24): about
6.0 + 5.2 + 4.8 + 2.9 ≈ 19 KB (spike figures, DejaVu). Plus a gs4 framebuffer (38.4 KB) and widget code.
That fits in ~110 KB only with WiFi and MQTT also loaded if little else is; the hero app's board pass
(phase 7) is where this gets measured. A Pico + 128x64 OLED (1 KB mono framebuffer) has far more room.

## Decisions for Mike

1. ~~Option A or B?~~ **A, prebuilt set** (Mike, 2026-10-07). B only if measured RAM forces it.
2. Which font family: run the look test on DejaVu, Atkinson Hyperlegible and one modern sans, plus a pixel
   font for small OLED sizes?
3. The charsets and size ladder above: right steps, anything missing (e.g. `€`, `£`)?
4. Where generated fonts live: under `device-runtime/src/` like the vendored libraries, or a separate assets
   folder?

## Out of scope

Antialiased (gs4) glyph rendering, kerning, right-to-left text, runtime-variable fonts, glyphs read from a
file on demand (a later RAM lever; `Writer` would need a font object that reads from a file).
