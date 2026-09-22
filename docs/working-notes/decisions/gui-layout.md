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
