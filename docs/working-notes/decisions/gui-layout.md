# GUI layout / widget system decisions

Topic file for the touch-driven GUI layer that sits between `touch_spi`/`touch_i2c` and
`display_spi`/`display_i2c`. Indexed from `decisions.md`. Full reasoning:
`docs/working-notes/gui-layout-widget-system-scoping.md`.

---

**2026-09-18 -- Hinch's `micropython-micro-gui` / `micropython-touch` rejected as the runtime GUI layer.**
Mike's call after reading micro-gui: too monolithic. It fits every sourcing criterion this project
normally applies (pure Python, stock MicroPython, same author as `mqtt_as`/`threadsafe_event`/
`primitives_events`, 20+ widgets, touch support covering both `touch_spi` and `touch_i2c` controllers),
but it expects callers to *subclass into* its model -- owning the event loop, the screen stack, the
refresh policy and the widget class hierarchy. That is a poor fit for a code generator, which wants to
emit code rather than conform to an inheritance tree. Its geometry management is also dead weight given
the compile-time layout decision below. **Not a blanket rejection:** individual widget *rendering*
routines and the standalone `Writer`/`font_to_py` tooling are still candidates to read or vendor, under
the usual `st7789py_mpy`-style vendoring treatment. Supersedes
`cyd-touch-gui-flash-budget-briefing.md`'s item 3, which had named nanogui/microgui/LVGL as the candidate
set. ([detail](../gui-layout-widget-system-scoping.md))

**2026-09-18 -- layout is container-based, not absolute coordinates.** Mike's requirement: "layout
controls that position widgets in arrays rather than having to specify absolute coords... like flex on
the web, or going back in time, X intrinsics in X windows." Consequences worked through in the scoping
doc: because the panel size is fixed, the layout engine runs in the editor at compile time and ships
nothing to the device (the device gets a flat table of resolved rects); the model is Xt's two-pass
measure/arrange without its runtime geometry-negotiation protocol; layout overflow becomes a build error
with full attribution rather than a visual bug found on hardware. Recommended -- **not decided** -- shape
is a hybrid: screen structure as a compiled tree owned by a `ui_screen` config node, widgets as canvas
nodes bound into named slots in that tree. ([detail](../gui-layout-widget-system-scoping.md))
*(Note, 2026-10-06: the named-slot shape was superseded by the 2026-09-22 entry below.)*

**2026-09-22 -- the GUI gets its own editor view; GUI nodes are two-faced; MVC is the guiding pattern.**
Mike's direction: GUI layout and event management are orthogonal to the flow paradigm, so they get a
parallel GUI view with drag-and-drop layout into container widgets. A GUI node is one record shown in both
views -- its data face (value in, events out) in the flow view, its presentation face (position in a
container tree) in the GUI view. Container trees live in a new `screens` section of the flow file,
referencing widget nodes by id (not `layout`, which already means canvas positions). **Supersedes the
2026-09-18 named-slot design**, which was a workaround for not having a layout view. The recommended MVC
split (flow owns values, GUI subsystem owns view and controller, interaction state never enters the flow)
and the two-call device boundary (`set_value` in, `event` out) are recommendations, not decisions.
([detail](../gui-layout-widget-system-scoping.md))

**2026-09-22 -- unknown is a first-class value state in the GUI's visual language.** Mike's requirement:
in real IoT use a value may be unknown until an external device or system reports it, so the GUI must show
that rather than rely on default initial values. Flow-fed widgets start unknown on every boot and redeploy.
The recommended wider state set (unknown / known / stale / pending / error), its mono-safe visual
treatments, and `payload: None` as the unknown signal are recommendations, not decisions.
([detail](../gui-layout-widget-system-scoping.md))

**2026-10-06 -- MVP GUI scope: a minimal widget set for one hero app; touch architected, barely built.**
Mike's call. The hero app is a home-monitoring panel on a CYD (or its 8MB-PSRAM variant): a BME280 sensor, a
carousel of 3-4 pages, one drill-down page, an MQTT-driven alarm modal. Touch is designed in, but the only touch
feature built for MVP is tap zones (left/right half -> prev/next page) from raw `touch_spi` coordinates. Widgets
are ordinary msg-in nodes on the canvas; their generated code hands values to one GUI subsystem, which does all
drawing (shared framebuffer/bus, message rate decoupled from frame rate). Widget set itself not yet finalised.
([detail](../gui-layout-widget-system-scoping.md))

**2026-10-06 -- multiple displays are architected from the start.** Mike's requirement (e.g. a 320x240 TFT plus
a 128x64 OLED). Each display gets its own screen set, pages, navigator and optional touch binding; on the device,
one GUI subsystem drives a list of surfaces, each with its own framebuffer, frame format, rect tables and redraw
rate. Widget values are display-independent. Recommended, not decided: one placement per widget for MVP;
placement-level presentation properties. ([detail](../gui-layout-widget-system-scoping.md))

**2026-10-06 -- page navigation is first-class; modals are full-screen.** Mike's steer: small displays imply many
pages, and other micro GUI systems under-invest in navigation; modals take the whole screen. Recommended, not
decided: the active page is flow-owned model state; a navigator node per display (commands in, current page
out); pages as a tree with a carousel top level; modals as two-faced nodes (msg opens, `payload: None` closes,
close reason out) with a per-display queue and priority. ([detail](../gui-layout-widget-system-scoping.md))

**2026-10-06 -- Pico constraint.** Mike's call: flows without a GUI must not be penalised on a Pico, and a Pico
with a small OLED must run a small GUI; the 320x240 hero app on a Pico is desirable, not mandated. Consequences:
the selective vendor push (`outstanding-items.md`, P4, 2026-09-17) becomes a prerequisite for GUI work; one
module per widget type, imported only if used; board definitions get a memory budget the compiler checks;
widgets draw with clip/offset so banded rendering stays possible. ([detail](../gui-layout-widget-system-scoping.md))

**2026-10-06 -- no custom firmware: the GUI is Python on stock `framebuf`, with viper for hot loops.** Mike agreed
after examining the implicit "pure Python" assumption. Stock `framebuf` primitives are already C; viper is
already used (`display_spi`, `native-arch.ts`). Each viper function gets a plain-bytecode twin the compiler can
fall back to, saying so. Hot paths sit behind an accelerator interface so a per-chip dynamic native module can
replace one later. Custom-firmware routes (LVGL via lvgl_micropython, C user modules) rejected for MVP on
install-route and board-coverage cost, not performance. Next step: a nano-gui spike on its own branch to decide
vendor-whole / vendor-parts / write-our-own (`nano-gui-spike-briefing.md`).
([detail](../gui-layout-widget-system-scoping.md))
- 2026-10-07 (Mike): fonts for MVP are a **prebuilt set** -- a build-time tool converts a fixed list of (font, size,
  charset) with `font_to_py` and commits the board modules and the editor's metrics/bitmap JSON. No FreeType in
  the shipped product; per-flow subsets (backend converts at deploy) stay possible behind the font-id lookup if
  RAM forces it. Family and size ladder still open. `gui-font-pipeline-scoping.md`.
- 2026-10-07 (Mike, from the look test): GUI font is **Atkinson Hyperlegible** (Regular body, Bold digits) --
  distinct 0/O and 1/l/I, narrower digits that fit small displays. Body ladder 12/16/20/24 (no 10px), digits
  16/24/32/48/64. Built the same day: `tools/build_fonts.py`, fonts as flow dependencies.
  `gui-font-pipeline-scoping.md`.
- 2026-10-07: layout engine built as scoped (row/column, gap, padding, grow, align/alignSelf, justify incl.
  space-between; no wrap or shrink). Results are whole pixels; leftover pixels go to the first growers/gaps.
  Overflow and duplicate ids come back as a list of attributed errors, never thrown. `editor/src/gui/layout.ts`.
- 2026-10-08 (Mike): **remote views are architected in** -- a phone or web page is one more surface, and the
  editor's live preview is the first one ("kills two birds with one stone"). Built now: the subsystem's
  surface is an interface (`FrameSurface` draws a framebuffer, `RemoteSurface` sends changes) plus an
  `on_value` feed of every change. Transport, client and input (which needs board auth) not built.
  `gui-layout-widget-system-scoping.md`, "Remote views".
- 2026-10-08: text is drawn by our own small routine on the surface (blit each glyph through a two-colour
  palette, the technique nano-gui's `CWriter` uses), **not** a vendored `Writer`, against the spike's
  recommendation. Why: `Writer` keeps a text cursor per device, wraps lines and needs a `palette` attribute on
  the framebuffer, none of which we use, and it doesn't clip to a widget's rect, which we need; the
  measuring is already in the editor. ~20 lines instead of ~320. Widgets: one library per type
  (`tsgui_label`, `tsgui_readout`, `tsgui_bar`, `tsgui_led`, `tsgui_pagedots`).
- 2026-10-08: **the GUI always draws in strips** (`BandSurface`, ~5 KB each), never a full framebuffer. The
  CYD couldn't allocate 38,400 contiguous bytes for a 240x320 gs4 frame on deploy despite enough free heap
  in total (fragmentation). Strip messages carry `y`; `display_spi` accepts strips or whole frames.
  `gui-layout-widget-system-scoping.md`, "banded rendering".
- 2026-10-08 (Mike): **frozen-firmware spike closed; custom firmware stays deferred.** Desk findings met its
  goals (about 75% less heap when frozen, a pushed library can override a frozen one); board stages and
  firmware builds not run. The GUI's own memory problems were fixed in Python (strips, per-flow libraries).
  Optional firmware tier is post-MVP. `frozen-firmware-spike-briefing.md`, "Closed".

**2026-10-07 -- no round dials; a trend (moving histogram) widget instead.** Mike's steer: dials waste screen
space and say no more than a number; moving histograms are useful for seeing trends. The trend widget joins the
MVP working list. Mike pointed at his node-red-contrib-journal, then at RRDtool (and Cacti, built on it) as
the model for this kind of display: the same quantity shown at several time scales, each giving a different
insight. **Decided (Mike): one `journal` node per time scale, cascaded** ("more modular"), each one an
RRDtool-style archive. Recommended, not decided: only the first journal is clocked (step, heartbeat); xff
decides when a consolidated value becomes a gap; each output carries `min`/`max` alongside the average in
`payload` so long scales keep spikes visible; trend widgets are pure views of one journal; how a series crosses
the msg is open.
([detail](../gui-layout-widget-system-scoping.md))

- 2026-10-08 (Mike, recorded 2026-10-09): **touch in the MVP is buttons, down/up only, one finger.** No move,
  drag, swipe or sliders. Built: `touch_i2c` (FT6336U driver, `vendor/ft6336u/`), a button widget, and a
  `gui_touch` node that hit-tests the visible page or modal. The button and `gui_touch` shape is replaced by
  the 2026-10-09 entry below. A **layout outline** in the gui screen's properties (`ScreenOutline.vue`) stands
  in for the GUI view: edit the page tree, no preview, no drag.
- 2026-10-09 (Mike): **the headliner ships on the Freenove ESP32-S3 Display 4.0" (FNK0104S: ST7796, 320x480,
  FT6336U touch)**, Mike's own unit, not the 2.8" FNK0104B in `launch-mvp-scope-briefing.md`. The ST7796
  driver and the `freenove-s3-4in` board definition are the headliner's hardware; ILI9341 leaves the MVP path.
  Also in `decisions/launch-scope.md`.
- 2026-10-09 (Mike): **custom firmware images are decided by the CYD gate.** The driver is deploying a modest
  GUI app on a classic CYD. Gate: from a fresh runtime install, deploy the hero GUI flow (BME280, MQTT, 3-4
  pages), then a different flow, then the GUI flow again, five times over, with no removing flows, no manual
  resets and no reboots beyond what Deploy does. Stock firmware passes: custom images are post-MVP. It fails:
  the MVP ships a small set of custom images, classic ESP32 first. Mike expects the latter. Replaces the
  2026-10-08 "optional firmware tier is post-MVP" above.
- 2026-10-09 (Mike's direction; details recommended, not decided): **buttons get their own output; touch
  plumbing leaves the canvas.** Mike: a button "floating in the air doesn't look right"; GUI-only plumbing
  shouldn't be visible; `touch_i2c` is for non-GUI uses. Recommended shape:
  - The button sends `topic` = its name, `payload` = a value set on the button, on release inside it (or on
    press, by property). Modes: momentary (sends its value), toggle (sends the opposite of its state, shows
    ON/OFF), navigate (next/prev/home/page on its own screen, no wire; the only button allowed unwired; any
    other unwired button gets a warning).
  - The input sets what the button shows. Wired, the flow owns the state: a toggle fed by the plug's MQTT
    state shows the real state, and a tap shows **pending** until it is confirmed (the controlled widget in
    `gui-layout-widget-system-scoping.md`). Unwired, the button keeps its own state.
  - The touch panel becomes a **config node** (controller, I2C bus, address, size, swap/flip, reset pin). The
    gui screen names it in its properties and the GUI polls it itself; `touch_i2c` references the same config
    for raw use. Both on one panel: a compile error in the MVP. The `gui_touch` node goes.
  - Open: whether the screen-to-`display_spi` wire should also become a screen property. Left as is for now.
- 2026-10-09 (Mike): **node colour means group; labels drop the `gui` prefix.** One colour per palette group,
  the icon and label tell nodes apart: general slate `#5c6370`, network blue `#3b6ea6`, hardware copper
  `#a0522d`, gui teal `#2e8a74` (dark backgrounds of the same hues). GUI labels read "button", "readout",
  "bar", "light", "label", "screen", "navigator", "modal"; type ids keep `thingstudio/gui_*` (flow files store
  only type ids, so colours and labels can change later without touching saved flows). The hardware buttons'
  labels become "gpio button" (`ebutton`) and "gpio switch" (`eswitch`) so they can't be mistaken for the
  on-screen one. Node-RED Dashboard is the precedent (`ui_button` type, "button" label, one colour).
