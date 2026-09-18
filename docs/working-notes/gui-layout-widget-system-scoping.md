# GUI layout and widget system — scoping and recommendation

Written 2026-09-18, in a session that started from Mike's idea of "a simple templating system for GUIs,
templates like [jsonforms.io](https://jsonforms.io/), taking input from touch nodes and sending renders to
display nodes." **Supersedes `cyd-touch-gui-flash-budget-briefing.md`'s item 3 (GUI framework selection —
nanogui/microgui/LVGL)**, the same way `touch-input-briefing.md` superseded that doc's item 2. That doc's
items 1/4 (CYD display, flash budget) are untouched here and still stand on their own.

Read `touch-input-briefing.md`, `framebuffer-display-node-scoping.md` (Claude project) and
`node-definition-model.md` first. Nothing below is built — scoping and a recommendation, with two real
decisions taken this session (see "Decisions taken", below).

## Decisions taken this session

1. **Hinch's `micropython-micro-gui` / `micropython-touch` rejected as the runtime GUI layer** — Mike's
   call, after reading micro-gui: too monolithic. Detail and what to salvage from it below.
2. **Layout must be container-based, not absolute coordinates** — Mike's requirement: "layout controls
   that position widgets in arrays rather than having to specify absolute coords... like flex on the web,
   or going back in time, X intrinsics in X windows."

Both are recorded in `decisions/gui-layout.md`. Everything else in this doc is a recommendation, not a
decision.

## Recommendation in one paragraph

Build our own. Screen structure lives in a **compiled structure tree**; widgets stay **nodes on the
canvas**, bound into named slots in that tree. The whole layout engine runs in the editor in TypeScript
and ships **nothing** to the device — the device receives a flat table of resolved rects. The fixed screen
size is what makes that cheap; retargeting one flow across different panels is what makes it worth doing
at all.

**Naming caution:** `flow-file.ts` already has a `layout` section (canvas node positions, design doc §
"flow file"). The screen structure described here is a different thing and must not be called `layout` in
the flow file — `screen`/`screenTree` or similar, to avoid two unrelated meanings of the same key.

## Why not JSONForms

JSONForms' actual value is a renderer registry resolving schema fragments to React/Angular components,
after which the **browser** does layout, text metrics, scrolling, focus and hit-testing. On a framebuffer
none of that exists, so copying it inherits the vocabulary and none of the leverage — we would still be
writing the entire part it delegates.

It also drags in JSON Schema, which is a *validation* language (`$ref`, `allOf`/`anyOf`/`oneOf`,
conditional subschemas). That is a resolver nobody wants to write, and certainly not one to put on-device.

Keep the one good idea: declarative-structure-as-data, with `(structure, data) -> draw calls` as a pure,
off-device-testable function.

## "Panel", not "form" — the physics rules out dense forms

- **Touch targets.** XPT2046 resistive with linear min/max calibration gives several mm of error. On a
  2.8" 320x240 panel that is roughly a 40-50px minimum comfortable target — call it 6-8 usable controls
  per screen. *Rule of thumb, not researched; measure on Mike's actual unit alongside the calibration
  pass `touch-input-briefing.md` already owes.* A dense scrolling form of labelled fields is not operable
  on this hardware.
- **No keyboard.** An on-screen keyboard at that target size on resistive touch is miserable. Free text
  entry is out of scope for v1 — which removes the most form-like widget there is.

So the thing to build is a **panel**: a few large controls, several screens, navigation between them. That
deletes scroll containers, validation display, tab order and text inputs from scope before any design work
starts.

## Layout — the fixed screen is the whole gift

Flexbox and X Intrinsics both do geometry at runtime because windows resize. A CYD screen is 320x240
forever. So the entire layout algorithm runs in TypeScript in the editor, and the device gets a rect
table: flexbox's authoring model at zero flash, zero RAM, zero runtime cost. That is also the answer to
"monolithic" — the layout engine never ships, so its size is irrelevant, and it directly helps item 4 of
`cyd-touch-gui-flash-budget-briefing.md` (nothing new joins `VENDOR_FILES` for layout).

From Xt, take the part that survived into every modern toolkit: **two-pass measure then arrange**.
Bottom-up, each widget reports a natural size; top-down, each container assigns rects to children. Skip
the geometry *negotiation* protocol (`XtGeometryYes`/`No`/`Almost`, children requesting resizes at
runtime) — that exists only because things change at runtime. Without it, layout is a single deterministic
pass with no convergence question and no iteration limit to tune.

The subset worth implementing, probably ~200 lines of TypeScript:

- `Row` / `Column` containers, nestable
- `gap`, `padding`
- per-child sizing: natural, or `grow: n` (weighted share of slack)
- cross-axis alignment: `start | center | end | stretch`
- main-axis distribution of leftover: `start | center | end | space-between`

No wrap, no shrink, no `order`, no `align-content`. Per "no premature optimization, but don't paint into
an architectural dead end": every one of those can be added later without changing the emitted rect table
or the device runtime at all, so leaving them out is a reversible call, not a one-way door.

**Fault handling (per the engineering-priority rule): overflow is a build error, not a visual bug.** A
compile-time layout can report "widget X's natural size 84px exceeds its 60px slot in screen Y" with full
attribution, before deployment. The web cannot do that and neither can a runtime layout engine. Same for
a widget naming a slot that does not exist in the tree, or a slot with no widget bound to it — both are
compile errors naming the slot, not silent blank areas discovered on hardware.

## Architecture — structure as a compiled tree, widgets as nodes

The obvious flow-native design is pure widgets-as-nodes (Node-RED Dashboard's model: `ui_button`,
`ui_slider`, `ui_gauge` as nodes, grouped into screens by a config node, reusing `resolveConfig` and the
existing property/codegen/test machinery). The container requirement above kills that on its own, for a
concrete reason:

**Nested containers are an ordered tree. A flow canvas is a wired graph, and a graph does not naturally
express sibling order.** Containers-as-config-nodes would need an explicit `order` property on every
widget — miserable to author and easy to break silently, which is exactly the failure mode this project's
fault-handling priority says to design out rather than document.

So the structure has to live in a document regardless. Hence the hybrid:

- **Structure is a compiled tree** — container nesting, gaps, grow weights, and named **slots** at the
  leaves. Small, stable, rarely edited. Lives in the `ui_screen` config node.
- **Widgets stay nodes on the canvas**, each with a `slot` property naming where it lands. Wires carry
  data in and events out, so the visual-dataflow property that justifies a flow editor at all survives.

Essentially `grid-template-areas`: structure in one place, content in another, each edited where it makes
sense. It also sidesteps sibling ordering entirely — order is positional in the tree.

**What this costs:** the widget->slot relationship is a property, not a wire, so screen composition cannot
be read off the canvas. That is the standard Node-RED Dashboard complaint and it is legitimate. It argues
for a **live layout preview** on the `ui_screen` config node reasonably early — not needed to ship, but
needed before the system is pleasant to use. Related to, but distinct from, the in-editor node reference
already tracked in `outstanding-items/in-editor-node-reference.md`.

## How touch events reach widgets

No wires between touch and widgets, and no runtime routing — **the compiler resolves it**, the same way
`resolveConfig` already resolves config references at codegen time.

- A `ui_screen` **config node** represents one screen and owns the structure tree.
- Each widget node references it plus a slot name.
- `touch_spi` references the same config node. That is the entire binding.

Codegen sees the whole graph, resolves layout, and emits a **static dispatch table** (resolved rects
paired with handlers) plus one dispatcher coroutine. Touch events and widgets never exchange `msg`s at
runtime; they compile into the same loop.

**Why not broadcast-and-self-filter** (wire touch to every widget, each tests `rect.contains(x, y)`):

- **Pointer capture.** Press a slider and drag off it — the slider must keep receiving events; same for a
  release landing outside the button that was pressed. Capture is inherently a single-owner stateful
  decision and cannot be made independently per widget.
- **Z-order.** Overlapping widgets both match, with no single-winner semantics. (Row/Column nesting makes
  overlap impossible anyway — a further argument for containers over absolute coordinates.)
- **Canvas clutter.** N wires carrying no information.

Centralised dispatch fixes all three, because one place decides who owns the pointer.

**Runtime state is small:** the captured widget, and the active screen index. Multiple screens are
multiple tables with the dispatcher indexing the active one.

Keep one escape hatch: give `touch_spi` a raw-coordinate output for anyone bypassing the widget layer
entirely. Costs nothing, and keeps the hardware node honest as a plain event source per
`touch-input-briefing.md`'s own scoping.

## Message shape for widget events

Per `CLAUDE.md`'s `msg`/`payload` convention, and answering one of `touch-input-briefing.md`'s open
questions (payload shape) for the widget layer specifically:

- `topic` = the widget's slot name (or node id) — routing/identification, always set, never omitted.
- `payload` = the widget's value: a bool for a toggle, a number for a slider, the selected item for a
  picker. One generic key a `debug` node can print without knowing anything about widgets.

This follows `ebutton`'s existing precedent (single output port, `topic` carries event identity, `payload`
carries state) rather than inventing a two-number payload. It only answers the question for widget
events — a raw `touch_spi` coordinate event still needs its own answer, and `{x, y}` in `payload` remains
the obvious candidate there.

## Hinch's frameworks — evaluated, not adopted

`micropython-touch` (the successor to `micro-gui`) is a complete GUI framework, not a driver: 20+ widgets
(Button, ButtonList, RadioButtons, Checkbox, Listbox, Dropdown, Slider, Dial, Knob, Meter, Scale, Grid,
Label, Textbox, DialogBox, Menu, graphing), a screen-stack navigation model with modal windows, an
event-driven callback system, running on **stock MicroPython firmware** with no custom build. It sits on
nano-gui's `framebuf`-subclass drivers, and its touch layer already covers XPT2046 **and**
CST816S/CST820/FT6206/TSC2007 — both `touch_spi` and `touch_i2c` targets, including CYDc's CST820. On
paper it fits every sourcing criterion this project has (`decisions/node-authoring.md`'s 2026-09-17
entry), from the same author as `mqtt_as`, `threadsafe_event` and `primitives_events`.

**Rejected as the runtime layer (Mike, 2026-09-18): too monolithic.** The specific mismatch: it wants you
to *subclass into* its model, owning the event loop, the screen stack, the refresh policy and the widget
class hierarchy. That is fine for hand-written Python and awkward for a code generator, which wants to
emit code rather than conform to an inheritance tree. And because layout here is compile-time, its
geometry management — a main reason it exists — would be dead weight.

**Still worth taking, without adopting the framework:**

- **Widget rendering routines.** Drawing a convincing slider thumb or dial is fiddly, debugged work. Read
  or vendor individual draw routines — same precedent as reading micropython-lib's SSD1306 for its
  `framebuf` shape without copying its design. Anything actually vendored gets the full `st7789py_mpy`
  treatment (pinned commit SHA, dual-method SHA-256 verify, per-directory README,
  `docs/third-party-licenses.md` row).
- **`Writer` / `font_to_py`.** Standalone, not part of the framework, and exactly what the layout engine
  needs. See the font dependency below.

**LVGL:** item 3 of the superseded briefing named it as a candidate and flagged two blockers — the
custom-firmware packaging question (unverified, a recollection) and its partial-rect flush contract
against `display_spi`'s full-frame port. Neither needs resolving now that we are not adopting a
framework. The flush-contract question itself does not go away, though — see the next section.

## The `display_spi` contract question does not go away

Item 3 flagged that LVGL pushes **partial dirty rectangles**, while `display_spi`/`display_i2c`'s current
contract is one `bytes` port, full frame, overwrite everything. Dropping LVGL does not drop that question,
because dirty-rect updates are the main performance lever here too:

A full 320x240 gs4 blit is ~38KB over SPI; repainting one button is a few hundred bytes. That gap is most
of the difference between a panel that feels responsive and one that does not, and a static resolved rect
per widget makes partial updates trivial to compute. **So the display nodes still need a partial-blit
path** — the same contract change item 3 anticipated, arrived at from a different direction. Whether that
is a second input port, a richer message shape carrying a rect alongside the bytes, or something else, is
not designed here. Worth resolving before the widget set grows, not after.

Widget rendering must also go through the `frameFormat`/`palette` abstraction that gs4/gs2/mono landed
(`decisions/node-authoring.md`), not assume RGB565 — see the grey-scale constraint below.

## Layering

Three tiers; the middle must never import `machine`:

1. **Hardware** — `touch_spi`/`touch_i2c` (event sources emitting raw or calibrated coordinates),
   `display_spi`/`display_i2c` (framebuffer sinks). Unchanged from existing scoping, apart from the
   partial-blit question above.
2. **UI runtime** — the generated dispatcher: hit-testing, capture, widget state, render calls.
   Hit-testing does **not** belong in the touch node.
3. **Layout + widget definitions** — editor-side TypeScript, compiling to the rect and dispatch tables.

Payoff for testing: tiers 2 and 3 exercise in `vitest` on synthetic `(x, y, down)` input with no SPI
mocking at all, and layout is testable as pure data (expected rect tables). Only tier 1 needs a real CYD.
That matches the established standard — off-device harness first, then a real hardware pass, per
`touch-input-briefing.md`'s testing section — while moving most of the surface area to the cheap side of
that line.

**Flagged compiler question, resolve before writing codegen:** a widget node is both a sink and a source
— a `msg` in updates its bound value, a touch in emits a change `msg` out. The four existing codegen
patterns (`codegenSink`, `codegenEventSource`, `repeatMs`, `function`) may have no shape for that. Check
`node-definition.ts` before committing to the node shape; if none fits, this is a compiler change, not
just a new node family.

## Knock-ons

- **Font metrics are now a blocking dependency, not a footnote.** Intrinsic sizing means a button reports
  its natural size as text width plus padding, so the editor needs *the same metrics the device has*
  before the layout engine can be implemented at all. Practical answer: one font source, one tool emitting
  both a `.py` for the device and a metrics JSON for the editor. This gates everything else — settle it
  first. It is also a new vendored asset, so `docs/third-party-licenses.md` gets a row in the same change.
- **Retargeting is the real prize.** Absolute coordinates weld a flow to one panel; a structure tree
  recompiles the same flow onto a 128x64 mono OLED. That is what justifies building this rather than
  typing x/y, and it only works because layout is compile-time.
- **gs4/gs2/mono constrains widget design.** No colour-coded state; pressed/selected/disabled must read
  through fill, outline and inversion. Design the widget vocabulary against 4-bit grey from the start
  rather than porting a colour design down.
- **Multi-screen navigation is a state machine** and arrives with the second screen: current-screen,
  transitions, back. Flow-expressed (a `msg` activates a screen) or a property of the screen graph? Not
  decided.
- **Touch-move becomes mandatory the moment a slider exists.** `touch-input-briefing.md` treats move as
  possible-v2, but a slider you cannot drag is a bad slider. Decide "sliders in v1?" and "move in v1?"
  together — move changes the touch node's event cadence entirely.
- **Runtime-variable content** (a list of N items known only at runtime) has no answer in a compile-time
  layout. Not a v1 problem; when it comes up, the likely shape is a fixed slot count or a list widget
  owning its own internal layout. Flagged so it is not rediscovered from scratch.
- **Version-bump discipline applies** if any part of the UI runtime ends up as a pushed file rather than
  purely generated code: `_RUNTIME_VERSION` / `EDITOR_TARGET_VERSION` per `CLAUDE.md`, plus a
  `VENDOR_FILES` entry (and item 4's flash-budget problem gets slightly worse).
- **User-guide pages are owed** for every new node type this produces, per `CLAUDE.md`'s
  user-experience-documentation rule, in the concise register `docs/user-guide/` already uses.

## Next steps, in order

1. **Settle the font/metrics pipeline.** It gates the layout engine; nothing else can start cleanly.
2. **Build the layout engine in TypeScript** — measure/arrange, the subset above, `vitest`-tested against
   expected rect tables. No device involvement at all.
3. **Resolve the `display_spi` partial-blit contract** (see above) — needed before the widget set grows.
4. **Define the screen-tree schema** and the slot-binding property on widget nodes; check the
   sink-and-source question against `node-definition.ts` at the same time.
5. **One widget end to end** — a button, through codegen to a real CYD, before building a widget set.
   Wire it into a `display_spi` CYD flow so a press visibly changes the screen, same spirit as the gs4
   animation flow being a demo as well as a test.

Open, not decided: multi-screen navigation model; sliders and touch-move in v1; widget set scope; the
partial-blit contract's shape.

Sources: [peterhinch/micropython-touch](https://github.com/peterhinch/micropython-touch),
[peterhinch/micropython-micro-gui](https://github.com/peterhinch/micropython-micro-gui).
