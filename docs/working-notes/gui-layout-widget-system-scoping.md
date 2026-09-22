# GUI layout and widget system — scoping and recommendation

Written 2026-09-18, in response to the idea of "a simple templating system for GUIs, templates like
[jsonforms.io](https://jsonforms.io/), taking input from touch nodes and sending renders to display
nodes." Revised the same day after Mike evaluated Hinch's micro-gui (too monolithic) and specified a
requirement for **container-based layout rather than absolute coordinates** — flex/X-Intrinsics style.
That requirement changed the central recommendation; this doc reflects the revision, not the original.

Nothing built yet. Builds on `touch-input-briefing.md` and `framebuffer-display-node-scoping.md`.

## Verdict up front

Build our own, not on a framework. Structure lives in a **compiled layout document**; widgets stay
**nodes on the canvas**, bound into named slots. The whole layout engine runs in the editor in
TypeScript and ships **nothing** to the device — the device receives a flat rect table.

The fixed screen size is what makes this cheap, and retargeting across panels is what makes it worth
doing at all.

## Why not JSONForms

Its actual value is a renderer registry resolving schema fragments to React/Angular components, after
which the **browser** does layout, text metrics, scrolling, focus and hit-testing. On a framebuffer none
of that exists, so copying it inherits the vocabulary and none of the leverage. It also drags in JSON
Schema, a *validation* language ($ref, allOf/anyOf/oneOf, conditional subschemas) — a resolver nobody
wants to write and certainly not one to put on-device.

Keep the one good idea: declarative-structure-as-data, with `(structure, data) → draw calls` as a pure,
off-device-testable function.

## "Panel", not "form" — the physics rules out dense forms

- **Touch targets.** XPT2046 resistive with linear min/max calibration gives several mm of error. On a
  2.8" 320×240 panel that is roughly a 40–50px minimum comfortable target — call it 6–8 usable controls
  per screen. *Rule of thumb; measure on Mike's actual unit.* A dense scrolling form of labelled fields
  is not operable.
- **No keyboard.** An on-screen keyboard at that target size on resistive touch is miserable. Free text
  entry is out of scope for v1 — which removes the most form-like widget there is.

So: a **panel** — a few large controls, several screens, navigation between them. That deletes scroll
containers, validation display, tab order and text inputs from scope.

## Layout — the fixed screen is the whole gift

Flexbox and X Intrinsics both do geometry at runtime because windows resize. **A CYD screen is 320×240
forever.** So the entire layout algorithm runs in TypeScript in the editor, and the device gets a rect
table. Flexbox's authoring model at zero flash, zero RAM, zero runtime cost — and the layout engine
never ships, which is also the answer to "monolithic".

From Xt, take the part that survived into every modern toolkit: **two-pass measure then arrange**.
Bottom-up, each widget reports a natural size; top-down, each container assigns rects to children. Skip
the geometry *negotiation* protocol (`XtGeometryYes/No/Almost`, children requesting resizes at runtime)
— that exists only because things change at runtime. Without it, layout is a single deterministic pass
with no convergence question.

The subset worth implementing, probably ~200 lines:

- `Row` / `Column` containers, nestable
- `gap`, `padding`
- per-child sizing: natural, or `grow: n` (weighted share of slack)
- cross-axis alignment: `start | center | end | stretch`
- main-axis leftover: `start | center | end | space-between`

No wrap, no shrink, no `order`, no `align-content`. Bonus the web cannot offer: **overflow is a build
error**, not a visual bug discovered on hardware.

**Dirty-rect updates fall out free.** A full 320×240 gs4 blit is ~38KB over SPI; repainting one button
is a few hundred bytes. That gap is most of the difference between a responsive GUI and a sluggish one,
and a static resolved rect per widget makes partial updates trivial.

## Architecture — structure as document, widgets as nodes

The earlier draft of this doc recommended pure widgets-as-nodes (Node-RED Dashboard style, everything a
node, grouped by a config node). The container requirement kills that, for a concrete reason:

**Nested containers are a tree. A flow canvas is a wired graph, and a graph does not naturally express
an *ordered* tree** — sibling order especially. Containers-as-config-nodes would need an explicit
`order` property on every widget: miserable to author, easy to break silently.

So the structure has to live in a document regardless. Hence the hybrid:

- **Structure is a document**, compiled in the editor — the container tree, gaps, grow weights, and
  named **slots** at the leaves. Small, stable, rarely edited.
- **Widgets stay nodes on the canvas**, each with a `slot` property naming where it lands. Wires carry
  data in and events out, so the visual-dataflow property that justifies a flow editor survives.

Essentially `grid-template-areas`: structure in one place, content in another, each edited where it
makes sense. It also sidesteps sibling ordering entirely — order is positional in the document.

**What this costs:** the widget→slot relationship is a property, not a wire, so screen composition
can't be read off the canvas. That is the standard Node-RED Dashboard complaint and it is legitimate.
It argues for a **live layout preview** on the screen config node reasonably early — not needed to
ship, but needed before the system is pleasant.

## How touch events reach widgets

No wires between touch and widgets, and no runtime routing — **the compiler resolves it**.

- A `ui_screen` **config node** represents one screen and owns the layout document.
- Each widget node references it plus a slot name.
- `touch_spi` references the same config node. That is the entire binding.

Codegen sees the whole graph, resolves layout, and emits a **static dispatch table** (resolved rects
paired with handlers) plus one dispatcher coroutine. Touch events and widgets never exchange `msg`s at
runtime; they compile into the same loop.

**Why not broadcast-and-self-filter** (wire touch to every widget, each tests `rect.contains(x, y)`):

- **Pointer capture.** Press a slider, drag off it — the slider must keep receiving events; same for a
  release landing outside the button that was pressed. Capture is inherently a single-owner stateful
  decision and cannot be made independently per widget.
- **Z-order.** Overlapping widgets both match, no single-winner semantics. (Row/Column nesting makes
  overlap impossible anyway, which is a further argument for containers over absolute coords.)
- **Canvas clutter.** N wires carrying no information.

**Runtime state is tiny:** the captured widget, and the active screen index. Multiple screens are
multiple tables with the dispatcher indexing the active one.

Keep one escape hatch: give `touch_spi` a raw-coordinate output for anyone bypassing the widget layer.
Costs nothing, keeps the hardware node honest as a plain event source.

## Hinch's frameworks — evaluated, not adopted

`micropython-touch` (successor to `micro-gui`) is a complete GUI framework, not a driver: 20+ widgets,
screen-stack navigation, modal windows, event-driven callbacks, stock MicroPython, `framebuf`-subclass
drivers, and touch support covering XPT2046 **and** CST816S/CST820/FT6206/TSC2007 — both `touch_spi`
and `touch_i2c` targets including CYDc's CST820. On paper a strong fit.

**Rejected as the runtime layer (Mike, 2026-09-18): too monolithic.** The specific mismatch — it wants
you to *subclass into* its model, owning the event loop, screen stack, refresh policy and widget class
hierarchy. Fine for hand-written Python, awkward for a code generator that wants to emit code rather
than conform to an inheritance tree. And because layout is compile-time here, its geometry management —
a main reason it exists — is dead weight.

**Still worth taking, without adopting the framework:**

- **Widget rendering routines.** Drawing a convincing slider thumb or dial is fiddly, debugged work.
  Read or vendor individual draw routines — same precedent as reading micropython-lib's SSD1306 for its
  `framebuf` shape without copying its design.
- **`Writer` / `font_to_py`.** Standalone, not part of the framework, and exactly what the layout engine
  needs. See the font dependency below.

## Layering

Three tiers; the middle must never import `machine`:

1. **Hardware** — `touch_spi`/`touch_i2c` (dumb event sources, raw/calibrated coordinates),
   `display_spi`/`display_i2c` (pure framebuffer sinks). Unchanged from existing scoping.
2. **UI runtime** — the generated dispatcher: hit-testing, capture, widget state, render. Hit-testing
   does **not** belong in the touch node.
3. **Layout + widget definitions** — editor-side TypeScript; compiles to the rect and dispatch tables.

Payoff: tiers 2 and 3 test in vitest/pymock on synthetic `(x, y, down)` with no SPI mocking; only tier 1
needs the CYD.

**Flagged compiler question:** a widget node is both a sink and a source — msg in updates its bound
value, touch in emits a change msg out. The four existing codegen patterns (`codegenSink`,
`codegenEventSource`, `repeatMs`, function) may have no shape for that. Check `node-definition.ts`
before committing; if not, it's a compiler change, not a node.

## Knock-ons

- **Font metrics are now a blocker, not a footnote.** Intrinsic sizing means a button reports its
  natural size = text width + padding, so the editor needs *the same metrics the device has* before the
  layout engine can be implemented at all. Practical answer: one font source, one tool emitting both a
  `.py` for the device and a metrics JSON for the editor. This gates everything else — settle it first.
- **Retargeting is the real prize.** Absolute coordinates weld a flow to one panel; a layout tree
  recompiles the same flow onto a 128×64 mono OLED. That is what justifies building this rather than
  typing x/y — and it only works because layout is compile-time.
- **gs4/gs2/mono constrains widget design.** No colour-coded state; pressed/selected/disabled must read
  through fill, outline and inversion. Design the vocabulary against 4-bit grey from the start rather
  than porting a colour design down.
- **Multi-screen navigation is a state machine** and arrives with the second screen: current-screen,
  transitions, back. Flow-expressed (a msg activates a screen) or a property of the screen graph? Not
  decided.
- **Touch-move becomes mandatory the moment a slider exists.** `touch-input-briefing.md` treats move as
  possible-v2, but a slider you cannot drag is a bad slider. Decide "sliders in v1?" and "move in v1?"
  together — move changes the touch node's event cadence entirely.
- **Runtime-variable content** (a list of N items known only at runtime) has no answer in a
  compile-time layout. Not a v1 problem; when it comes up, the likely shape is a fixed slot count or a
  list widget owning its own internal layout. Flagged so it isn't rediscovered.

## Next steps, in order

1. **Settle the font/metrics pipeline.** It gates the layout engine.
2. **Build the layout engine in TypeScript** — measure/arrange, the subset above, vitest-tested against
   expected rect tables. No device involvement at all.
3. **Define the layout document schema** and the slot-binding property on widget nodes.
4. **One widget end to end** (a button), through codegen to a real CYD, before building a widget set.

Open, not decided: multi-screen navigation model; sliders/move in v1; widget set scope.

Sources: [peterhinch/micropython-touch](https://github.com/peterhinch/micropython-touch),
[peterhinch/micropython-micro-gui](https://github.com/peterhinch/micropython-micro-gui).
