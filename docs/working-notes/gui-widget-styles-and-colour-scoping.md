# GUI widget styles and a path to colour: scoping

Status: scoping, 2026-10-23. Nothing decided; open questions for Mike at the end. Raised by Mike: "gui widgets are
currently very dull. We have no ability to set color, and the design is boring." Drafted as a Claude Doc with a
mockup (today's page against a proposed dark theme): https://claude.ai/artifact/5F4ZbTjbr1MfBn4qLi3428. This file
is the repo copy. Styling belongs to the GUI subsystem, not the node format (`decisions/gui-layout.md`, 2026-10-15).

## Where things stand

GUI widgets draw in four hard-coded colours per surface: foreground, dim (stale), background and accent.
`rgb565Colours()` in `editor/src/node-library/gui.ts` fixes them for RGB565, and `_STYLE` in
`device-runtime/src/vendor/thingstudio_gui/gui.py` fixes palette indexes for the indexed formats. A flow can't change
any of them.

Everything proposed here can be drawn with stock `framebuf` primitives in strips, with no anti-aliasing and no
gradients. Rounded corners and pills come from `ellipse()` with its quadrant mask plus `fill_rect`.

## Widget styles

The biggest improvement is cards on containers, because every widget inside one looks better with no widget code
changed. None of these brings round dials back (decision of 2026-10-07).

- **Cards.** A container (row or column in the layout tree) gets an optional `card` style: a filled rounded
  rectangle in a card colour, with padding.
- **Caption plus value.** A small caption in a muted colour above a big number with muted units. A `caption` option
  on the readout, or a label in a muted style, so no new widget.
- **Status chip in place of the light.** A filled pill with short text ("OK", "Offline", "Open") in a state colour.
  The plain circle stays as the small version.
- **Segmented bar.** Square cells instead of an outlined box, each coloured by threshold (green, then amber, then
  red), unlit cells in a track colour.
- **Better trend.** Average bars in the accent colour, min–max ticks in muted, an optional dashed threshold line,
  optionally the latest value in a corner. The journal already sends min and max.
- **Buttons.** A filled rounded button for the main action. A toggle can look like a switch (track and knob) and
  still work with one tap, so it fits the down/up-only touch rule. Pending, unknown and failed keep their outline
  patterns on the track.
- **Header bar.** Screen title, time and WiFi signal on a card-coloured strip. Icons from an icon font run through
  the existing `font_to_py` pipeline (Tabler Icons are MIT-licensed, for example).
- **Page dots.** A pill for the active page.
- **Alarm banner and modal.** A strip or modal filled in the alarm colour.

## A path to colour

Colour depends on the wired display's frame format, and the boards span all three. One theme is written once and
resolved three ways. The widget styles above are shapes first (cards, pills, cells, switch track), so they work on
every format; only the colour changes.

| Frame format | Typical boards | What colour can do |
| --- | --- | --- |
| RGB565 | Freenove FNK0104S (ESP32-S3, PSRAM) | Full colour. Any role takes any colour, widgets can have their own colours, thresholds can blend between colours. The only cost is more strips per frame (8 rows per 5 KB strip at 320 wide). |
| gs4 / gs2 | Classic CYD, run indexed to save memory | Palette-bounded. gs4 has 16 entries: 10 roles leave 6 for custom colours. gs2 has 4, so the theme says how its roles fold into four. |
| Mono | SSD1306 / SH1106 OLEDs (`display_i2c` is mono only), a Pico with a small OLED | No colour. Each role is ink or paper; states differ by shape and pattern, as they do today. |

Six steps, in order, each small enough to land on its own. Steps 1–3 are the first piece of work.

1. **Name colours by role, not value.** Replace the four colours with a role table: `bg`, `card`, `fg`, `muted`,
   `track`, `accent`, `on_accent`, `ok`, `warn`, `alarm`. Widgets draw only by role, on every format.
2. **A theme on the gui screen, resolved by the wired display's format.** Pick a preset (dark slate, light paper,
   high contrast, amber) and edit any role. The compiler resolves it:
    - RGB565: byte-swapped values, as `rgb565Colours()` does now.
    - gs4 / gs2: the screen writes the display's palette, which reads "set by the screen's theme" while a GUI is
      wired. gs2 themes say how roles fold into four colours.
    - Mono: each role is ink or paper. A card is drawn inverted (filled ink, paper text) or outlined, as the theme
      says.
3. **The editor preview draws the real format.** A flow for an OLED previews in mono, and the property panel says
   which tier the screen is in ("full colour", "16 colours", "mono"), so nobody designs in colour for a mono panel
   by accident.
4. **Per-widget colour.** A widget picks a role, or a custom colour:
    - RGB565: any colour.
    - gs4 / gs2: custom colours take free palette entries; running out is a compile error naming the widgets.
    - Mono: custom colours are dropped with a compile warning, so a flow moved to a smaller board still compiles.
5. **Colour from the value, never colour alone.** Thresholds on the readout, bar, trend and chip map value ranges
   to `ok`, `warn` or `alarm`, on every format. Each state role also has a shape cue (on mono: `ok` outlined, `warn`
   hatched, `alarm` inverted), so a state never relies on colour. On RGB565 a threshold can also blend between
   colours (blue to red for temperature).
6. **Later: switching themes at runtime.** A day/night scheme in the device settings store, which already lists "a
   GUI colour scheme" as a use.

## Device-side change

Text drawn on a card needs the card colour behind its glyphs, so `text()` on the surface has to take a background
colour (or blit with a transparent key).

## Decided, 2026-10-23 (Mike)

- **Fold at low depth.** gs2 and mono fold roles onto what they have rather than refusing a theme it cannot express;
  the property panel shows the fold, so nobody wonders where their red went.
- **Cards, not a tile widget.** A card style on containers first; a widget that bundles caption/value/chip/sparkline
  is not built now (it is the answer to "cards are not enough", which the cards will tell us).
- **Trend: the first two only** — accent bars and muted min/max ticks. No threshold line, no value-in-the-corner yet.
- **The theme is a config node**, `thingstudio/config/gui-theme`, referenced by a gui screen the way a touch panel is
  (one theme serves several screens, and it is copyable between flows). Presets seed the roles and stay editable, so
  "create your own palette" is the normal case rather than a special one.
- **Seeding presets: dark slate and light paper.** High contrast and amber wait; with editable roles, a preset is a
  starting point, not a limitation.
- **Order:** step 1 (roles, no visual change) → the theme node and presets → trend → cards.

**Cards are in** (2026-10-23, runtime 13.0.0): `card` on a container (a checkbox in the layout outline) draws a filled
rounded panel in the theme's card colour behind its children, and a widget inside one clears to the card colour
rather than the screen background — including in banded rendering. Earliest visual item of the whole brief.

**Trend's two items are in** (2026-10-23, runtime 13.0.0): the average bar draws in `accent` and the min–max line in
`muted` (it was the foreground), with a test on a themed surface so the roles, not the defaults, are what is checked.
No threshold line and no value-in-the-corner, as decided.

**Step 2 is in** (2026-10-23, runtime 13.0.0): the `gui theme` config node with two presets and editable roles; a
`colour` property kind (`ColorField.vue`); the fold per frame format; and, on indexed formats, the display taking its
palette from the screen wired to it (`flow.links` in the compile context, `editor/test/display-spi-theme-palette.test.ts`
pinning the Python fold against `resolveThemeForFormat()`). Next: trend's two items, then cards.

**Step 1 is in** (2026-10-23, runtime 13.0.0): ten roles in `gui.ts` and `thingstudio_gui/gui.py`, a default theme
equal to the previous four colours, a device test that the theme path draws byte-identical frames to the old
four-colour tuple, and roles folded per format when no theme is given. A visible change still needs step 2.

## Open questions for Mike

- Before or after launch? The headliner (Freenove, RGB565) would show it off; steps 1–3 are the minimum.

**Amended 2026-10-24 (Mike): the theme is on the screen.** The screen's own `theme` starting point and role
colours are the normal path; the `gui-theme` config remains for older flows and for sharing a theme between
screens. The device contract is unchanged (same resolved `theme={...}` dict). See `decisions/gui-layout.md`.
