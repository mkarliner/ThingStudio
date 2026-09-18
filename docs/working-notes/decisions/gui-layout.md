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
