# GUI layout and widget system — scoping and recommendation

Written 2026-09-18, from Mike's idea of "a simple templating system for GUIs, templates like
[jsonforms.io](https://jsonforms.io/), taking input from touch nodes and sending renders to display nodes."
**Supersedes `cyd-touch-gui-flash-budget-briefing.md`'s item 3** (GUI framework selection —
nanogui/microgui/LVGL). That doc's items 1/4 (CYD display, flash budget) still stand on their own.

**Revised 2026-09-22** after Mike's steers: the GUI gets its own parallel editor view; GUI nodes are
two-faced; MVC shapes the design; **unknown** is part of the visual language. That replaced the 2026-09-18
named-slot design.

**Revised 2026-10-06** in a brainstorm with Mike: MVP scope and hero app; multiple displays; page
navigation and modals as first-class; the Pico memory constraint; the pure-Python-vs-C decision examined;
existing packages surveyed, with a nano-gui spike as the next step. New sections are marked (2026-10-06).
Note: the repo copy of this file had not picked up the 2026-09-22 revision (only the Claude project copy
had); this version consolidates both.

Read `touch-input-briefing.md`, `framebuffer-display-node-scoping.md` (Claude project) and
`node-definition-model.md` first. Nothing below is built.

## Decisions taken

Recorded in `decisions/gui-layout.md`. Everything else in this doc is recommendation, not decision.

1. **2026-09-18 — Hinch's `micropython-micro-gui` / `micropython-touch` rejected as the runtime GUI
   layer** (too monolithic).
2. **2026-09-18 — layout is container-based, not absolute coordinates.**
3. **2026-09-22 — the GUI gets its own editor view**; GUI nodes are two-faced; MVC is the guiding pattern.
4. **2026-09-22 — unknown is a first-class value state** with its own visual treatment.
5. **2026-10-06 — MVP scope:** a minimal widget set, enough for one hero app (a CYD home-monitoring
   panel). Touch is architected; only tap-zone page navigation is built.
6. **2026-10-06 — multiple displays are architected from the start** (e.g. a 320x240 TFT plus a 128x64
   OLED on one board).
7. **2026-10-06 — page navigation is first-class**, and **modals are full-screen**.
8. **2026-10-06 — Pico constraint:** flows without a GUI must not be penalised on a Pico, and a Pico with
   a small OLED must run a small GUI. The 320x240 hero app on a Pico is desirable, not mandated.
9. **2026-10-06 — no custom firmware.** The GUI is Python on stock MicroPython's `framebuf`, with viper
   for hot loops. Custom-firmware routes (LVGL, C user modules) rejected for MVP.

## Recommendation in one paragraph

Build our own, on stock firmware, borrowing drawing code where it fits (nano-gui is the lead candidate).
In the editor, a **GUI view** edits page trees per display and a **flow view** edits wiring; a GUI node is
one record shown in both. The layout engine runs in the editor at compile time and ships the device only
per-display tables of resolved rects. On the device, one **GUI subsystem** owns rendering, navigation,
touch dispatch and widget values, across one or more display **surfaces**. Widget nodes are ordinary
msg-in nodes whose generated code hands values to that subsystem. Every value carries a state — unknown,
known, stale, pending, error — with a look that works in 4-bit grey and in mono.

## MVP scope and the hero app (2026-10-06)

**Hero app:** a home-monitoring panel on a CYD (ESP32-2432S028R), or its 8MB-PSRAM variant.

- At least one real sensor: BME280 (temperature/pressure/humidity), already vendored.
- A carousel of 3-4 pages with readouts and bars, showing unknown and stale honestly.
- One drill-down detail page.
- An alarm modal raised over MQTT, closable by the flow when the condition clears.

**Touch:** architected, minimally built. The CYD has almost no free buttons, so the one touch feature
built is **tap zones**: tap the left half for `prev`, the right half for `next`. That needs only raw
`touch_spi` coordinates, no hit-testing or dispatch tables. BOOT (GPIO0) may serve as `home`/`back` once
booted — to verify.

**Widget set:** not finalised. Working list: static label, bound label, big numeric readout with units,
bar/meter, **trend (moving histogram)**, status indicator (LED-style), page indicator, modal. Pending is the
only value state that needs touch editing, so it is designed but not built; error can follow.

**No round dials; trends instead (Mike, 2026-10-07).** A dial spends a lot of screen on what a number says in
less. A moving histogram shows what a number can't: which way a value is heading.

**History lives in a `journal` node, not in the widget (2026-10-07).** Mike's references, in order:

- His [node-red-contrib-journal](https://flows.nodered.org/node/node-red-contrib-journal) (v0.1.6, read from the
  npm tarball): a fixed-length FIFO, clocked or message-driven, that outputs the series on each update and,
  every `max` entries, the average on a second output, so journals cascade into longer windows.
- **[RRDtool](https://oss.oetiker.ch/rrdtool/) as the model for this kind of display,** and Cacti (and MRTG
  before it), which built on it. One round-robin database per data source holds several archives at different
  resolutions; the classic Cacti/MRTG page shows the same quantity as daily, weekly, monthly and yearly graphs
  one above the other. Each time scale shows something the others hide: minutes show spikes and events, hours
  the daily cycle, days the weekly pattern and drift. That is the insight to deliver, not the storage trick.

The trend widget is a pure view: it draws one journal. That is the MVC split this doc already
argues for, and the journal is useful without a display (publish a summary over MQTT, feed a function node).
Recommendations, not decided:

- **One journal node per time scale, cascaded (Mike's call, 2026-10-07: "more modular").** As in
  node-red-contrib-journal: each node is one RRDtool archive, and its consolidated output feeds the next node.
  One sensor → minute journal → hour journal → day journal, each optionally driving its own trend widget.
  Properties, in RRDtool terms:
  - **First journal only** is clocked: `step` (e.g. 60 s) sets the x-axis in time; `heartbeat` is how long an
    input stays valid, so a tick with no input younger than this records unknown (our `staleAfter`).
  - **Downstream journals** are message-driven: each consolidated msg from upstream is one row.
  - Every journal: `rows` (ring length) and `steps` (rows consolidated per output msg, e.g. 60 minutes → 1 hour).
  - `xff` (RRDtool's "xfiles factor"): the fraction of unknown rows a consolidated output may contain and still
    be known. Above it, the output is a gap. Averages are over known rows only, never treating a gap as zero.
- **Min and max travel down the cascade.** An hourly average hides a spike the minute view shows, and a stage
  fed only averages can't recover it. So each journal's output carries the consolidated `min` and `max` as
  extra msg keys (`payload` stays the average, per the msg convention). A downstream journal takes the min of
  incoming `min`s and max of incoming `max`es, falling back to `payload` when they're absent (a raw sensor
  feeding the first stage). Each journal keeps three rings (avg/min/max), so a long-range trend can draw each
  column as a min–max range with the average marked, as RRDtool/Cacti graphs do. Whether the widget draws
  ranges in MVP is open; carrying min/max in the msg should be in from the start, since adding it later changes
  the cascade's msg shape.
- **Unknown is first-class, as in RRDtool:** gaps are NaN in the ring, drawn as gaps, never as a repeated last
  value. `payload: None` in records unknown. Archives start empty on boot and redeploy.
- **Storage:** three `array('f')` rings (avg/min/max) per journal, sized at compile time: 12 bytes per row.
  Hour + day + week journals (60 + 24 + 7 rows) ≈ 1.1KB. A plain list of floats costs far
  more on ESP32/RP2, where floats are heap objects.
- **Trend widget draws one journal.** A Cacti-style page is several trend widgets, one per journal in a cascade,
  stacked or as carousel pages. The GUI view's "trend" can offer time scales and create the journals, wiring and
  widgets together.
- **What crosses the msg is the open question.** Copying a series into a new list on every tick allocates on
  every tick. Options: a read-only view of the ring plus its head index, or the widget holding a reference to the
  journal's rings through `set_value` and reading them at draw time. Settle with the device runtime. Needs a
  `series` port type so wiring a scalar into a trend is a compile error, not a blank widget.
- **The journal's output** (every `steps` rows: `payload` the average, `min`, `max`, `topic` set) follows the msg
  convention, so it feeds the next journal, a readout ("today's mean") or MQTT alike.
- **Later, not MVP:** RRDtool's COUNTER/DERIVE data-source types (rates from an increasing counter, e.g. an
  energy meter's pulse count); persistence (flash wear, and the board's clock may not be set); timestamps (with
  a fixed step, order and interval are enough to draw).
- **Fixed min/max on the widget for MVP.** Autoscale can come later without changing the msg shape.
- **Redraw the whole trend rect each update** (`w` vlines); `framebuf.scroll()` moves the whole buffer, not a
  rect.
- Readout plus trend is the common pairing: wire the sensor to both the readout and the journal.

**Second display:** architected, not needed by the hero app. On a CYD an I2C OLED would go on the spare
connector (believed CN1, GPIO22/27 — check against the board definition).

## Widgets are ordinary msg-in nodes (2026-10-06)

Mike's question: why doesn't a widget just take a msg to set its value, like every other node? It does.
On the canvas a widget is a normal node; `set_value` is only what its generated input handler calls.

The one difference: a widget never draws when its msg arrives. It stores the value and marks its area
dirty, and one subsystem draws. Widgets share things ordinary nodes don't:

- **One framebuffer and one bus per display.** Independent drawing would interleave writes.
- **Message rate is not frame rate.** 50 msgs a second must not mean 50 redraws and 50 SPI pushes.
- **Layout is shared.** A widget doesn't know its rect, font or theme; the compiled tables do.
- **Stale is a timer, not a message.** One loop dims values that have gone quiet.
- **Touch, later, needs one owner** for hit-testing and pointer capture.

For MVP, widgets are input-only: no `gui.event` output face is generated. The call stays in the
subsystem's API so adding touch later doesn't strand deployed boards.

## "Panel", not "form" — the physics rules out dense forms

- **Touch targets.** XPT2046 resistive with linear min/max calibration gives several mm of error. On a
  2.8" 320x240 panel that is roughly a 40-50px minimum comfortable target — call it 6-8 usable controls
  per screen. *Rule of thumb, not researched; measure on Mike's unit alongside the calibration pass
  `touch-input-briefing.md` already owes.*
- **No keyboard.** Free text entry is out of scope for v1.

So the thing to build is a **panel**: a few large controls, several pages, navigation between them. No
scroll containers, validation display, tab order or text inputs.

## Why not JSONForms

JSONForms' value is a renderer registry resolving schema fragments to React/Angular components, after
which the **browser** does layout, text metrics, scrolling, focus and hit-testing. On a framebuffer none
of that exists. It also drags in JSON Schema, a *validation* language nobody wants to resolve on-device.

Keep the one good idea: declarative structure as data, with `(structure, values) -> draw calls` as a pure,
off-device-testable function.

## Layout — the fixed screen is the whole gift

Flexbox and X Intrinsics do geometry at runtime because windows resize. A display's size is fixed. So the
layout algorithm runs in TypeScript in the editor and the device gets rect tables: flexbox's authoring
model at zero flash, RAM or runtime cost.

From Xt, take **two-pass measure then arrange**; skip its runtime geometry negotiation. The subset, probably
~200 lines of TypeScript:

- `Row` / `Column` containers, nestable
- `gap`, `padding`
- per-child sizing: natural, or `grow: n`
- cross-axis alignment: `start | center | end | stretch`
- main-axis distribution: `start | center | end | space-between`

No wrap, shrink, `order` or `align-content`; each can be added later without changing the device tables.

Layout runs **once per display**, with that display's size and font metrics — a widget's natural size
depends on where it is placed.

**Overflow is a build error, not a visual bug**, with full attribution: "widget X's natural width 84px
exceeds the 60px its column gives it on page Y of display Z."

**Engine built 2026-10-07** (`editor/src/gui/layout.ts`, ~210 lines; `editor/test/gui-layout.test.ts`): the
subset above, two passes, whole-pixel results (leftover grow and space-between pixels go to the first
children). Leaves take a natural size from the caller; a hero-style page measured with the real fonts fits
320x240 and is an attributed error on 128x64. Errors are collected, not thrown, so one build reports every
problem. Not yet: the `screens` format, per-widget measurement (a widget's natural size from its font and
widest value), and turning rects into device tables.

## Two views, one model

Wiring describes how data moves; layout describes where things sit. **One node record, two projections**,
never two copies kept in sync.

- The **flow view** shows a widget's data face — a value in (events out, once touch exists).
- The **GUI view** shows its presentation face — placement in a page tree, sizing, alignment, live preview.
- The flow file gets a separate **`screens`** section holding the page trees per display, referencing
  widget nodes by id. Not `layout` — `flow-file.ts` already uses that key for canvas positions.

**Not everything is two-faced:** containers and static labels exist only in the GUI view; bound labels,
interactive widgets, navigators and modals have both faces.

**Mechanics:**

- **Shared selection** across views.
- **Deletion** deletes everywhere; removing from a container only unplaces.
- **Unplaced tray:** a widget not placed on any display is a compile warning.
- **Exact preview:** the GUI view runs the same layout engine, font metrics and palette as the build,
  per display, and can show any widget in any value state.
- **Display switcher** in the GUI view, one preview per display.
- **Binding to hardware:** each display's screen set names its display node and (optionally) its touch
  node, by node id. No wires between touch and widgets.

**Placement properties belong to the placement, not the node (2026-10-06).** Size, alignment, variant
("label + units" on the TFT, "value only" on the OLED) and font size live on the entry in `screens`. Data
properties (`staleAfter`, units, controlled/uncontrolled) stay on the node.

## Multiple displays (2026-10-06)

MVC makes this cheap: values are the model, each display is another view.

- **Each display has its own screen set**: its own pages, active page, navigator and optional touch node.
- **Values are display-independent.** `set_value('temp', 21.5)` updates every place the widget appears.
- **One placement per widget for MVP.** To show a value on both displays, wire the msg to two widgets.
  `screens` references widgets by id, so allowing several placements later is a validation change only.

**Device side:** one GUI subsystem — one value store, one render loop — driving a list of **surfaces**.
Each surface has its own framebuffer and frame format (gs4 TFT, mono OLED), rect tables, dirty areas,
active page and navigation state, optional touch binding, and redraw rate (I2C is much slower than SPI).
One loop also serialises redraws if two displays share a bus.

## Pages and navigation (2026-10-06)

Small displays mean many pages, so navigation is most of the experience. Generic MicroPython GUI libraries
(LVGL, Hinch's) give screen load/push/pop and leave navigation design to the app; products that take it
seriously (smartwatches, Nextion HMIs, 3D-printer LCD menus) put it at the centre.

**The active page is model state owned by the flow.** Navigation is built on that.

**A navigator node per display** — the flow face of its screen set:

- **Input:** commands as msgs — `next`, `prev`, `back`, `home`, or a page name.
- **Output:** the current page (and modal open/close) whenever it changes.

This gives:

- **Navigation without touch:** a GPIO button, a timer (kiosk auto-cycle) or an MQTT msg drives it.
- **The flow knows what's on screen**, e.g. to poll an expensive sensor only while its page is visible.
- **Linked displays are wiring:** one navigator's output drives another's input.

**Page structure: a tree, carousel at the top.**

- The top level is a **carousel** — next/prev, optional wrap, page indicator.
- Any page can have **child pages**; drill down, return with `back`.
- **Goto by name** from anywhere.

A flat carousel is a tree one level deep, so MVP can ship flat without a format change.

**Designed in, built later:** idle return to home after N seconds; transitions (none for MVP — a page
change is a full repaint); tappable back buttons and tab bars (act on the navigator directly, no wires);
swipe (needs touch-move).

**Page chrome via a per-display page template** — a header/content/footer container every page fills,
carrying title and page dots. Possibly the real form of the original "templating" idea.

**Rendering:** only the active page draws. Off-page widgets still store values and run stale timers, so a
page is correct the moment it appears.

## Modals (2026-10-06)

Full-screen, matching the displays. No overlay drawing or dimming: opening or closing a modal is a page
change. A modal is a page outside the carousel tree, stacked over the current page.

**A modal is a two-faced node:**

- **GUI face:** a page laid out in the GUI view, using the display's page template, with bound widgets.
- **Input:** a msg opens it; its payload can fill content (the alarm text). `payload: None` closes it, so
  a self-clearing condition closes its own modal.
- **Output:** how it closed — `{'topic': '<modal name>', 'payload': 'ack' | 'timeout' | 'closed'}` — so
  the flow can escalate an unacknowledged alarm.

**Rules:**

- **One visible modal per display;** others **queue**, and the visible one shows "+N more". Nothing is
  dropped silently.
- **Priority:** a higher-priority modal takes the screen; the interrupted one returns to the queue. MVP may
  use one level, but the field exists.
- While a modal is open, `next`/`prev` do nothing; `back`, a tap or BOOT dismisses. Idle return never
  dismisses a modal.
- Optional auto-dismiss timeout, reported as `timeout`.
- Modals are per display; wire one msg to two modal nodes to alert on both.

## Remote views (2026-10-08)

Mike's question: could a view be a remote app, a phone or a single-page web app? Yes, and the MVC split makes
it cheap: a remote view is one more surface. Mike: "this kills two birds with one stone" -- the editor's
live GUI preview (phase 6) is itself a remote view over the existing USB/WiFi connection, so building one
builds most of the other.

- **Board side:** no framebuffer, no drawing. The surface sends changes as messages: the whole visible
  screen when the page or modal changes, then changed values. A board with **no display** (a Pico W) can
  still have a GUI.
- **Two shapes, both built into the subsystem:** a `RemoteSurface` is a display that lives elsewhere, with
  its own page tree and navigation; the `on_value` feed reports every value and state change, on screen or
  not, for a viewer that pages by itself (e.g. one retained MQTT topic per widget).
- **Transport is the caller's:** MQTT (we ship `mqtt_as`; a web page joins the broker over WebSockets) is the
  likely default; the editor connection (the reserved, unbuilt `VALUE_STREAM` message) for the preview; a
  WebSocket server on the board later, if ever (flash and RAM, nothing built in).
- **Rendering:** either a pixel-exact mirror of a real display (the editor has the layout engine and every
  glyph as data), or a page tree of its own laid out for a phone with ordinary HTML widgets.
- **A web page that can be installed** covers phones; no native app until there's a reason.
- **Hard parts:** security -- a view you can tap is remote control of hardware, so input waits for board
  authentication (HMAC scheme, designed, not built); read-only is low risk. Connection loss maps onto the
  value states: when the link drops, everything shown goes stale. Scope: read-only display is a feature; a
  full remote dashboard edges towards Node-RED Dashboard and Home Assistant.
- **MVP:** architected, not built, beyond the two hooks above.

## MVC — where the line falls

- **Model** — widget values and their states, the active page, the modal queue. The flow owns them.
- **View** — rendering from the resolved rect tables, per surface.
- **Controller** — touch dispatch, hit-testing, pointer capture, tap zones.

Enforce hardest: **interaction state vs. value state.** Pressed, dragging and highlighted never enter the
flow. Only values cross.

## The device-side GUI subsystem and its two calls

A single dispatcher/render coroutine owns the surfaces, rect tables, value store, navigation state,
pointer capture and dirty areas. Widget nodes reach it through two calls, one per MVC direction. Neither
takes a display argument.

**`set_value` — model to view.** Stores and timestamps the payload, marks the widget's areas dirty on every
surface where it is placed and visible. Never draws.

**`event` — controller to model.** Wakes whoever waits on that widget when a touch produces a new value.
Not generated for MVP.

```python
# Input face: msg in -> set_value (model -> view)
async def slider_3_input(msg):
    gui.set_value('slider_3', msg['payload'])        # None means unknown

# Output face: event out (controller -> model) -- post-MVP
async def slider_3_events():
    while True:
        value = await gui.event('slider_3')          # blocks until a user change
        await emit_slider_3({'topic': 'slider_3', 'payload': value})
```

Why: rendering is decoupled from message rate; the input face is a sink and the output face an event source
(`codegenEventSource`), likely no new codegen pattern — still to confirm against `node-definition.ts`; GUI
code stays out of per-node codegen and is tested once.

## Unknown state

A thermostat panel that boots showing 20°C before hearing from the thermostat is lying. **Unknown is a
first-class state**; flow-fed widgets never start from a default value.

| State | Meaning | How it is entered |
|---|---|---|
| **unknown** | never reported, or explicitly cleared | boot, redeploy, `payload` of `None` |
| **known** | a reported value | a real `payload` arrives |
| **stale** | known, but older than the widget's `staleAfter` | render-loop timer |
| **pending** | user asked for a value, awaiting confirmation | user edit on a flow-controlled widget |
| **error** | the source reported a failure | a message flagging an error (shape open) |

MVP builds unknown, known and stale. Every boot and redeploy starts flow-fed values at unknown.

**Visual language** — must read in gs4, gs2 and mono, so shape and pattern, not tone alone:

- **Unknown** — no value: `--` for a number, a track with no thumb, a centred toggle, a gauge with no
  needle, a dashed outline.
- **Stale** — last value dimmed in gs4/gs2; in mono, a dotted underline or similar pattern.
- **Pending** — requested value drawn hollow, solid when confirmed.
- **Error** — value area hatched or crossed, short text if there is room.

**Messages:** `payload: None` sets unknown; any other payload sets known; stale is derived on the device;
error shape open (one option: `{'payload': None, 'status': 'error'}`).

**Input from unknown** (post-MVP): an unknown two-state control offers both states; an unknown slider takes
wherever the user drags. Not decided.

## Controlled and uncontrolled widgets

Post-MVP (needs touch editing). Recommendation: **the wiring decides.**

- **Input unwired → uncontrolled.** The widget is the source of truth, may have an initial value, never
  unknown.
- **Input wired → flow-controlled.** Starts unknown. A user edit shows **pending** until a `set_value`
  arrives; a differing echo snaps to the flow's value; no echo within a timeout reverts and marks the edit
  unconfirmed.

Also borrow Node-RED Dashboard's pass-through option and emit-while-dragging vs. on-release.

## Touch dispatch

MVP: **tap zones only** (left/right halves → `prev`/`next` on that display's navigator), from raw
`touch_spi` coordinates.

Later: codegen emits a **static dispatch table** per surface and page (rects paired with widget ids); the
subsystem handles pointer capture. Not broadcast-and-test, because of capture, z-order and canvas clutter.
`touch_spi` keeps a raw-coordinate output for anyone bypassing the GUI.

## Message shapes

- **Widget events:** `topic` = widget name, `payload` = new value (following `ebutton`).
- **Navigator out:** `topic` = navigator name, `payload` = current page name (modal open/close shape to
  settle in implementation).
- **Modal out:** `topic` = modal name, `payload` = close reason.
- **Unknown commands or close reasons** produce a clear `NODE_ERROR`, never silent ignore.
- Raw `touch_spi` coordinates: `{x, y}` in `payload` is the obvious candidate.

## Memory and the Pico (2026-10-06)

Two separate budgets; lazy loading helps only RAM.

**Flash — what gets pushed.** `deploy_runtime.py`/`runtime_manifest.py` push every `VENDOR_FILES` entry to
every board on every bootstrap (`outstanding-items.md`, P4 item, 2026-09-17). Adding a GUI framework,
widget routines and fonts would cost every Pico flash even without a display. **The selective vendor push
(only what the flow uses, from the compiler's node list) is a prerequisite for GUI work.**

**RAM — what loads at runtime.**

- Flows already compile to `.mpy` in the browser. Check whether runtime and vendored files also ship as
  `.mpy`; if not, that is the cheapest RAM win.
- **One module per widget type, imported only if the flow uses it** — imports decided at compile time.
- **Per-page lazy loading: possible, not MVP.** MicroPython frees an unloaded module only when nothing
  references it, fragmentation is real, and each page change would pause for a flash import. Keep it
  possible: draw routines are plain functions behind a lookup table. A load failure shows an error page.
- **Fonts are the item to watch.** Font data imported from `.mpy` lives in RAM. Mitigations, cheapest
  first: subsets (digits-only for big readouts), few sizes per display, glyphs read from a file on demand.

**Enforcement:** board definitions carry a memory budget; the compiler estimates a flow's GUI RAM
(framebuffers, fonts, widgets) and warns or blocks with attribution; the board reports free heap after
deploy so estimates can be checked.

**Rough numbers, not measured:** Pico W free heap with networking up is perhaps 150-170KB. A 320x240 gs4
framebuffer is 38.4KB; 128x64 mono is 1KB. CYD with PSRAM removes RAM as a constraint (even RGB565,
~150KB, fits).

**Keeping the hero-app-on-Pico option open — banded rendering.** Draw the screen in strips (320x40 gs4 is
~6.4KB): draw every widget intersecting the strip, push it, move on. Uses the same display path partial
redraws need. Only possible if widgets draw through the surface API with a clip area and offset, never
assuming a full framebuffer.

**Built 2026-10-08, and the default, not just a Pico option.** The CYD (classic ESP32, no PSRAM) failed to
allocate the 38,400-byte 240x320 gs4 frame on deploy: the heap had room in total but no contiguous block that
big. `BandSurface` (`thingstudio_gui.py`) keeps one strip buffer (~5 KB, `bandRowsFor()` in `gui.ts`) and a
y-offset `FrameBuffer` subclass, so widgets draw in screen coordinates unchanged. Each pass draws only the
strips the dirty widgets touch; a full redraw sends every strip. `gui_screen` sends one message per strip
(`payload` = strip bytes, `y` = first row); `display_spi` writes a message with `y` as a strip, one without
as a full frame (old behaviour kept). `test_gui_bands.py` checks the strips are byte-identical to a full
frame in gs4 and mono. Not done: `display_i2c` strips (SSD1306 frames are 1 KB, not needed yet).

## Pure Python vs. C (2026-10-06)

The 2026-09-18 rejection of LVGL-style options implied "pure Python, stock firmware". Examined explicitly.
Four levels, not two:

1. **`framebuf` in stock firmware.** `fill_rect`, `line`, `blit`, `text`, `ellipse` are C on every port.
   A "pure-Python" GUI on it does its pixel-heavy work in C.
2. **Viper / native decorators.** Python compiled to machine code by our own mpy-cross. Already used
   (`display_spi`'s gs4/gs2/mono conversion; `native-arch.ts` picks `-march` per chip). No firmware change.
3. **Dynamic native modules** (C compiled to `.mpy`). No custom firmware, but a build per chip × `.mpy`
   sub-version (native code must match exactly — 6.3 since v1.23), restricted C (no static data, only
   `mp_fun_table` firmware calls, float pain on armv6m), and per-chip C toolchains in our release pipeline.
4. **Custom firmware** (LVGL, C user modules). Our own firmware per board; breaks the "flash stock
   MicroPython, then connect" install route and the "people bring any MicroPython board" stance; large
   flash footprint on a 2MB Pico. lvgl_micropython has no prebuilt binaries.

For a dashboard redrawing a few times a second, levels 1-2 should suffice: the hot paths are pixel-format
conversion (already viper) and glyph drawing (C `framebuf.blit`).

**Decision (Mike, 2026-10-06):**

- **Default:** Python on stock `framebuf`, viper for hot loops, stock firmware.
- **Viper fallback:** each viper function has a plain-bytecode twin; the compiler picks, and says so when
  it falls back (viper emitter missing on a port, or unverified `-march` for an unknown chip).
- **Escape hatch:** hot paths (blit/convert, glyph draw, fill) sit behind a small accelerator interface,
  so a per-chip dynamic native module can replace one later without touching widgets or firmware.
- **Custom firmware rejected for MVP** on install-route and board-coverage cost, not performance. Revisit
  only for a measured bottleneck levels 2-3 can't fix.

## Existing packages (2026-10-06)

| Package | What it is | Fit |
|---|---|---|
| **Hinch's nano-gui** (MIT) | Display-only GUI: Label, Meter, LED, Dial, Scale, Textbox, graphs. No event loop: `value()` writes the framebuffer, `refresh()` pushes. ILI9341/ST7789/SSD1306, Pico supported, 4-bit palette drivers. A CYD setup exists. | **Lead candidate for the drawing layer.** The passive sibling of micro-gui, so the "too monolithic" objection mostly doesn't apply. Matches MVP: flow-driven, deferred refresh. |
| `font_to_py` / `Writer` | Font converter and renderer | Take, as planned. |
| lvgl_micropython | Full LVGL binding, many drivers | Custom firmware, no prebuilt binaries, runtime layout and event loop. Not MVP. |
| mpdisplay / pydisplay | Drivers + primitives, "not a GUI library", alpha | Not a dependency; borrow its idea of draw calls returning the changed area. |

Open nano-gui questions, for the spike (`nano-gui-spike-briefing.md`): does it accept positions from our
layout compiler cleanly; RAM and redraw speed on a CYD; can its widgets draw unknown/stale; does it fit our
`display_spi` frame formats and drivers or bring its own; does it allow clip/offset drawing (banding).

## Things to lock in now (2026-10-06)

These would strand deployed boards if wrong; everything else can grow later.

1. Rect and dispatch tables are per display, even for one display.
2. The value store is keyed by widget id, not placement.
3. Active page and navigation state (page stack + modal queue with priority) are per display.
4. `set_value` and `event` take no display argument; `event` stays in the API though unused in MVP.
5. Widgets draw through each surface's frame format and palette, with clip area and offset — never
   assuming a full framebuffer.
6. Pages are identified by stable names, not indices, in tables and msgs.
7. The `screens` format is tree-shaped from day one.
8. Navigator commands and modal close reasons are open vocabularies; unknown values give `NODE_ERROR`.
9. Widget draw routines and font glyphs are reached through lookup functions, not direct data access.
10. Board definitions carry a memory budget field.

## The `display_spi` contract question

`display_spi`/`display_i2c` take one full frame over one `bytes` port. Dirty areas are the main performance
lever: a full 320x240 gs4 push is ~38KB; one widget is a few hundred bytes. **The display nodes need a
partial-push path** — a second port, a msg carrying a rect with bytes, or a direct call from the GUI
subsystem. Banded rendering needs the same path.

**MVP may defer it (2026-10-06):** without touch, updates are infrequent, and a rate-limited full-frame
push may be acceptable — rough reasoning, to measure in the spike. The subsystem tracks dirty areas
regardless.

Widget rendering goes through the `frameFormat`/`palette` abstraction, never assuming RGB565.

## Layering

1. **Hardware** — `touch_spi`/`touch_i2c` (event sources), `display_spi`/`display_i2c` (framebuffer
   sinks). Unchanged apart from partial pushes.
2. **GUI subsystem** — surfaces, value store and states, navigation and modals, dispatch, rendering, and
   the accelerator interface. Never imports `machine` directly.
3. **Adapter nodes** — generated, thin: widgets (`set_value` in), navigators, modals.
4. **Editor** — GUI view, `screens` section, layout engine per display; compiles the tables.

Tiers 2-4 test in `vitest` and pymock on synthetic input, no SPI mocking. Value-state transitions,
navigation and modal queueing are plain state-machine tests. Only tier 1 needs real hardware.

## Knock-ons

- **Font metrics block the layout engine.** One font source, one tool emitting a `.py` for the device and
  a metrics JSON for the editor. New vendored asset → `third-party-licenses.md` row.
- **Retargeting:** a page tree recompiles onto a 128x64 OLED; absolute coordinates never could.
- **gs4/gs2/mono constrains all widget design.** No colour-coded state.
- **Touch-move is needed as soon as a slider or swipe exists.** Decide together, post-MVP.
- **Runtime-variable content** (N items known only at runtime): not v1.
- **Version-bump discipline** if the GUI subsystem ships as pushed files: `_RUNTIME_VERSION`/
  `EDITOR_TARGET_VERSION`, plus a manifest entry (selective push).
- **User-guide pages are owed** for the GUI view, navigator, modal and each widget node.

## Phasing (revised 2026-10-06)

0. **nano-gui spike, on a branch** (`nano-gui-spike-briefing.md`). Decides vendor-whole, vendor-parts or
   write-our-own; informs everything below.
1. **Selective vendor push** — prerequisite for the Pico constraint.
2. **Font/metrics pipeline.**
3. **Layout engine in TypeScript**, per display, `vitest`-tested against expected rect tables.
4. **GUI subsystem runtime** — surfaces, value states (unknown/known/stale), navigation, modal queue,
   tested in pymock.
   **Built 2026-10-08:** `device-runtime/src/vendor/thingstudio_gui/gui.py` (a flow dependency,
   `thingstudio_gui`; 4.9 KB as `.mpy`), tested on the unix port with real `framebuf` in
   `device-runtime/test/test_gui.py`. Widgets, the editor's table output and codegen come next.
5. **Widget set for the hero app** + navigator + modal nodes; tap-zone navigation.
   **Board side and measuring built 2026-10-08:** label (static or bound), readout with units, bar, status
   light, page dots -- `device-runtime/src/vendor/thingstudio_gui/<widget>.py`, one library each
   (`tsgui_<widget>`), drawing through the surface's own text and colour helpers. A readout's number field
   is sized from its value range (`lo`, `hi`, `decimals`), every digit at the widest digit's width, so a
   value in range never overflows and "11.1" sits where "88.8" would. The editor's measure is
   `editor/src/gui/widgets.ts`; both sides are checked against `editor/test/fixtures/gui-widget-sizes.json`.
   `device-runtime/test/test_gui_widgets.py` checks every widget stays inside its rect in every state, in
   4-bit grey and mono. Text is drawn by our own ~20 lines (glyph framebuffer + two-colour palette blit,
   nano-gui's technique), not Hinch's `Writer`: see `decisions/gui-layout.md`, 2026-10-08. Not yet: the
   canvas nodes, navigator and modal nodes, tap zones, the `screens` format and codegen.
6. **GUI view v1:** outline tree per display plus live preview showing value states.
7. **Hero app end to end on a CYD** with a BME280 and an MQTT alarm.
8. **Pico + OLED check** against the memory budget.
9. Post-MVP: partial pushes/banding if measured necessary, touch dispatch and interactive widgets,
   pending/controlled widgets, direct manipulation in the preview.

## Open questions

- v1 widget set, finalised.
- GUI view scope for MVP (outline tree + preview, or simpler).
- Font pipeline: which font, sizes, subsets. Scoped 2026-10-07: `gui-font-pipeline-scoping.md`.
- nano-gui: adopt whole, adopt parts, or own (spike).
- Whether MVP needs partial pushes at all (measure).
- Navigator output shape for modal open/close.
- How a `journal` series crosses a msg without allocating on every tick; the `series` port type; whether trends draw
  min–max ranges in MVP; the journal node's name ("journal" vs. something RRD-flavoured).
- Post-MVP: controlled vs. uncontrolled by wiring or property; error-state shape; input from unknown;
  pending timeout and `staleAfter` defaults; transitions and back behaviour details.

Sources: [peterhinch/micropython-touch](https://github.com/peterhinch/micropython-touch),
[peterhinch/micropython-micro-gui](https://github.com/peterhinch/micropython-micro-gui),
[peterhinch/micropython-nano-gui](https://github.com/peterhinch/micropython-nano-gui),
[de-dh CYD LVGL/nano-gui setup](https://github.com/de-dh/ESP32-Cheap-Yellow-Display-Micropython-LVGL/),
[kdschlosser/lvgl_micropython](https://github.com/kdschlosser/lvgl_micropython),
[tdhoward/mpdisplay](https://github.com/tdhoward/mpdisplay),
[MicroPython natmod docs](https://docs.micropython.org/en/latest/develop/natmod.html),
[MicroPython .mpy compatibility](https://docs.micropython.org/en/latest/reference/mpyfiles.html).
