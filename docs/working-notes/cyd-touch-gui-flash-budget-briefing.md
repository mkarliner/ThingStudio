# CYD display, touch, GUI framework, flash budget — briefing

Written 2026-09-18 at the end of the `display_spi`/`display_i2c` real-hardware session (TiDAL badge).
Nothing below is started — planning only, so a future session can pick any of these up without
rediscovering context. Four things Mike wants on the table, not all necessarily done in one session:

1. Get the same display support working on CYD that was just proven on TiDAL.
2. A touch-screen driver, architected for multiple touch controllers (not one node per chip).
3. Pick a GUI framework to sit in front of the display node — candidates named: nanogui, microgui, LVGL.
4. Load only the node support code a given flow actually uses, instead of pushing everything to every
   board — a memory/flash optimization.

Read `framebuffer-st7789-display-briefing.md` and `claude/framebuffer-display-node-scoping.md` (the
Claude Project) first — items 1-3 below all build directly on that research.

## 1. CYD display support (`display_spi`, ILI9341/ST7789V/ILI9342)

**Controller variant is genuinely ambiguous — the single biggest open question, resolve before anything
else here.** Board: ESP32-2432S028R ("Cheap Yellow Display"). One source (mischianti.org) documents it as
ILI9341. A separate ESPHome issue flagged that this exact board family ships in *at least three known
display variants — ST7789V, ILI9341, and ILI9342* — depending on batch, same enclosure/silkscreen, no
visible way to tell them apart. Never chased to resolution. Confirm against Mike's actual unit — don't
assume from the model number or a photo. If the eventually-vendored driver(s) expose a chip-ID read
command (CYD's SPI wiring includes MISO, unlike TiDAL, so read-back is actually possible here), try that
first; failing that, try each candidate driver on real hardware and see which produces a correct image.
Record whichever variant it turns out to be — the next person shouldn't have to redo this.

**Interim findings, 2026-09-18 (this session) — converging, but not yet driver-confirmed.** Mike's
actual unit: board ID string `esp32-2432s028` (no `R` suffix), 2 USB ports.
`test-flows/cyd-controller-id-probe.py` (written and run this session) against real hardware: `0xD3`
RDID4 (ILI9341/ILI9342's "spells 9341" register) came back `00 00 00` — absence of the expected
`00 93 41` signature, though not conclusive alone (RDDID/RDID1-3 also came back zero, and a CYD-focused
diagnostic tool project doesn't even attempt automatic ID detection on this hardware family — these
registers are known-unreliable here). `0x09` RDDST *did* return real, structured data (`30 80 00 00`
once framing-aligned), confirming the SPI/MISO wiring and pin numbers below are correct — the bus talks
fine, the chip just doesn't answer the ID-specific commands usefully.

Two independent community threads on this exact board family (a CYD GitHub issue and a TFT_eSPI
discussion) report that the 2-USB-port CYD variant uses **ST7789**, while the single-USB "R" variant
uses ILI9341 — consistent with Mike's board having no `R` suffix and 2 USB ports. Mike then flashed
Bruce firmware (`BruceDevices/firmware`) — its own default profile for board string `2432S028` selects
ILI9341 — and reported the display works but colors look off (green text on a white background,
uncertain if intended). That "renders, but colors look wrong" symptom is the textbook signature of an
ILI9341 driver running an ST7789 panel (or vice versa) — a *known, currently-unresolved* Bruce issue
(`BruceDevices/firmware#1546`, "CYD-2432S028 Inverted Screen Colors") reports the identical symptom on
this identical board.

**RESOLVED, 2026-09-18: confirmed ST7789(V), working config found on real hardware.** The three
converging signals above turned out right. `test-flows/cyd-display-test-pattern.py` +
`cyd-display-orientation-test.py` + `cyd-display-mh-test.py` (all written and run this session) pushed
real photographed test patterns through the project's already-vendored `st7789py_mpy` driver until all
6 independently-colored bars rendered correctly — no new controller driver needed, as hoped. Working
config for this unit: `reset=None` (RST tied high), `xstart=0, ystart=0` (no GRAM offset at native
240x320), `inversion_mode(False)` (the driver's own `init()` hardcodes `True`, tuned for TiDAL's
different panel), and `MADCTL = 0x4C` (`BGR | MH | MX`, written directly — `_set_mem_access_mode()`'s
rotation table never exercises the `MH` bit, which this panel needed for correct horizontal
orientation). Backlight active-high was correct (no repeat of TiDAL's active-low surprise). Full
reasoning, the chip-ID-read dead end, and real bugs hit along the way (a full-frame `MemoryError` on
classic ESP32, the MADCTL `MH` gap, unreliable ID registers):
`docs/working-notes/decisions/node-authoring.md` (2026-09-18 entry) and
`docs/working-notes/learnings/hardware-bringup-hil-rig.md`. **Still only one confirmed unit** — the
"no visible way to tell variants apart" caveat above still applies to a different physical board;
this doesn't prove every CYD is ST7789(V).


**Pins (mischianti.org's documented values, for the ILI9341 case — unverified):** MISO=12, MOSI=13,
SCK=14, CS=15, DC=2, RST tied high in hardware (no GPIO), backlight=21, 55MHz SPI clock. Different bus,
different numbers entirely from TiDAL's SPI 2 / CS=10 / CLK=12 / DIN=11 / RESET=14 / DC=13 — confirms
`display_spi`'s "pins are node properties, not board defaults" design is still right.

**Panel geometry:** commonly cited as 240×320 (2.8", the controller's native resolution) — confirm on the
real unit, not assumed, per the GRAM-offset lesson below.

**Vendoring a second controller driver is real codegen work, not just a picklist addition.**
`display_spi`'s `controller` property currently only accepts `"st7789"` (`CONTROLLERS` in
`display-spi.ts`), and today that property is decorative beyond one validation check — `codegenSink`
hardcodes `from st7789py import ST7789` and the literal `ST7789(...)` constructor regardless of what
`controller` is set to. A second controller needs real per-controller branching (different import,
different constructor shape — an ILI9341 driver's constructor won't necessarily match
`devbis/st7789py_mpy`'s own `(spi, width, height, reset, dc, cs=None, backlight=None, xstart=-1,
ystart=-1)` param-for-param; verify, don't assume). Driver selection: same criteria already used for
`st7789py_mpy`/`ssd1306` (pure Python, works unmodified on stock MicroPython, no custom-firmware/C-module
requirement, pinned commit SHA + dual-method SHA-256 verify, per-directory README,
`third-party-licenses.md` row) — `decisions/node-authoring.md`'s 2026-09-17 entry has the full reasoning
this should match.

**Known-good pin quirks, still worth a real-hardware confirmation pass each:**
- RST tied high, no GPIO — `display_spi`'s `reset` property already has a `-1` ("not wired") sentinel for
  exactly this (`optionalPin()`, resolves to a literal `None`; every call site in `ST77xx` already guards
  with `if self.reset:`, confirmed by reading the code, not assumed). Should just work with `reset: -1` —
  but CYD would be the first *real board* to exercise that path (today only an off-device pymock covers
  it).
- Backlight polarity on GPIO21 — **unconfirmed, treat as a real risk.** `display_spi`'s backlight-on
  codegen is a hardcoded `.value(1)` (active-high assumption), which was wrong for TiDAL (confirmed
  active-low from `emfcamp/TiDAL-Firmware`'s own docs — see the lessons section below). Don't assume CYD
  is active-high just because that's more common; check a real schematic/datasheet, or expect to
  rediscover the same "backlight silently off" symptom TiDAL had.
- `xstart`/`ystart` GRAM offset — `display_spi`'s `-1` "auto" default only resolves correctly for
  `st7789py_mpy`'s own table (240×240 and 135×240 only). An ILI9341 driver will have its own, different
  offset story — some ILI9341-based boards need a rotation-dependent offset (different at portrait vs
  landscape). Don't assume `-1` "just works" here without checking.

**Verify the same way TiDAL's flow was:** `verify-flow-file.ts` + a `compile()` dry run through the real
registry off-device first (cloud-sandbox extracted copy, per `CLAUDE.md`'s constraints), *then* a real
CYD deploy pass — don't call it done until that real pass is clean, same standard this session held
itself to across four rounds of real-hardware bugs on TiDAL before that flow finally rendered correctly.
Draw something visually distinct from the TiDAL test pattern (different resolution/orientation) so a
plausible-but-wrong render doesn't slip through the way a GRAM-offset bug easily could on a smaller,
more forgiving shape.

### Lessons from the TiDAL session — apply proactively here, don't rediscover them

Four real bugs were found and fixed getting `display_spi` working on real TiDAL hardware
(`test-flows/README.md`'s `display-spi-tidal-test.flow.json` section and `decisions/node-authoring.md`'s
2026-09-17/18 entries have the full detail). Each is a *class* of mistake, not a one-off:

1. **Wire-type gap (`any -> bytes`)** — fixed generically in `sockets.ts`. Nothing to redo for CYD.
2. **Power/backlight-enable pin polarity** — active-low on TiDAL, contradicting `display_spi`'s hardcoded
   active-high write. Check CYD's polarity before wiring a flow, not after seeing a blank screen.
3. **GRAM offset** — was hardcoded wrong for TiDAL's panel size; now a real, verified property, but its
   auto-default is specific to one driver's own table (see above).
4. **RGB565 byte order** — `framebuf.RGB565` stores pixels CPU-native (little-endian on ESP32); the
   ST7789 wants big-endian over SPI (confirmed via `micropython/micropython#3536`, an unmerged upstream
   PR — no in-framework fix exists). Fixed with a manual byte-swap loop, documented as a gotcha in
   `docs/user-guide/nodes/display-spi.md`. **Applies identically to ILI9341** or any other controller
   fed from `framebuf.FrameBuffer(..., framebuf.RGB565)` — not a fresh investigation, just do the swap.

All four were caught only because of a real hardware pass — the off-device suite was green the whole
time for every one of them.

## 2. Touch-screen driver, architected for multiple touch controllers

**Superseded, 2026-09-18 -- see `touch-input-briefing.md` for the real, researched version.** The
hypotheses below (kept for the historical record only) turned out directionally right -- SPI/I2C split,
event-source codegen pattern -- but that doc has actual hardware facts (CYD's XPT2046 pin mapping,
confirmed a separate bus from the display, not shared), license-checked driver candidates, and the real
open design questions (calibration UX, event/payload shape, multi-touch scope) this placeholder didn't
have yet. Start there, not here.

Original starting hypotheses, superseded above, kept for context only:

- **Likely mirrors the display bus-family split** (`display_spi`/`display_i2c`'s own converged design,
  "the framebuffer contract, not one universal node" — Mike's steer that session): touch controllers
  split the same way. Resistive touch (XPT2046, the chip on CYD's own board, sharing the display's SPI
  bus on a separate CS pin) is SPI. Capacitive touch (common alternatives on other ESP32 boards: GT911,
  FT6236/FT6336, CST816) is typically I2C. A `touch_spi`/`touch_i2c` split parallel to
  `display_spi`/`display_i2c` is the natural first guess — not confirmed, needs the same kind of hardware
  survey the display nodes got before locking it in.
- **Likely an event-source node, not a sink** — unlike `display_spi`/`display_i2c` (pure sinks: push a
  buffer, no output), touch produces data (coordinates, press/release, maybe gestures) rather than
  consuming it. Architecturally closer to `ebutton`/`interrupt`'s existing event-source pattern
  (`codegenEventSource`, `ThreadSafeEvent`-based) than to a sink node — worth starting from that precedent
  rather than inventing a new node shape.
- CYD's own XPT2046 is the natural first real-hardware target, same as ST7789/ILI9341 was for
  `display_spi` — it's already wired into a board this project is actively bringing up (item 1 above),
  sharing the same SPI bus (separate CS, MISO now actually needed for real instead of just present).

None of this is confirmed — treat it as a starting point for a proper scoping doc, not a design already
decided.

## 3. GUI framework selection (nanogui / microgui / LVGL)

An evaluation and decision task, not implementation yet. The original scoping doc already flagged this as
a forward-looking fork point: **LVGL's own flush callback pushes partial dirty rectangles, not full
frames** — `display_spi`/`display_i2c`'s current contract is "one `bytes` port, full frame, overwrite
everything," which would force any LVGL-style framework to composite a full frame on every partial redraw,
defeating the point. That contract question needs resolving as part of picking a framework, not after.

Worth weighing against this project's own established sourcing pattern: **every asyncio-based MicroPython
library vendored so far in this project is Peter Hinch's** — `mqtt_as`, `threadsafe_event`, and
`primitives_events` (`ESwitch`/`EButton`/`WaitAny`/`Delay_ms`, vendored just this session). Peter Hinch
also maintains `micropython-nano-gui` and a newer, more full-featured `micropython-micro-gui` — pure
Python, asyncio-native, no custom firmware required, fitting both this project's deployment model (stock
MicroPython + `mpremote cp`, no custom-firmware builds — the exact reason `russhughes/st7789_mpy` was
ruled out for ST7789 in favor of `devbis/st7789py_mpy`) and its established "prefer a maintained
implementation from a source we already trust" pattern. "nanogui"/"microgui" in Mike's ask are presumably
these two, though worth confirming which one he means (or means both, one superseding the other) before
starting.

LVGL's official MicroPython binding (`lv_micropython`) has historically required a custom-compiled/frozen
MicroPython firmware build, not stock MicroPython + `mpremote cp` — if still true, that's very likely a
hard blocker for this project the same way it was for `russhughes/st7789_mpy`, independent of LVGL's
partial-flush question above. **This is a recollection, not freshly checked — verify LVGL's current
MicroPython packaging options at the start of that evaluation rather than trusting it**, since packaging
options do change and getting this wrong would misjudge the whole framework choice.

Evaluation should cover at minimum: pure-Python vs. C-module/custom-firmware requirement (likely
decisive, per above); full-frame vs. partial-rect flush contract (needs a `display_spi`/`display_i2c`
API change either way if going with something LVGL-shaped); how much drawing/widget surface each library
actually offers vs. how much this project wants to own; and whether the eventual choice depends on item 2
being ready first (a GUI framework needs touch input to be genuinely useful, though pure display output
without touch is still a valid intermediate milestone).

## 4. Load only the node support code a flow actually uses (flash/memory budget)

This is the already-tracked, not-yet-solved item in `outstanding-items.md` (the "[P4] `VENDOR_FILES`
doesn't scale past a handful of display controllers" entry, raised 2026-09-17, restated again at the
`display_spi`/`display_i2c` "Resolved" entry) — Mike is naming it as an explicit target for the next
session now, not a someday item.

**The specific waste today:** `test-flows/deploy_runtime.py`'s `VENDOR_FILES` list (`threadsafe_event.py`,
`mqtt_as/__init__.py`, `primitives_events/events.py` + `delay_ms.py`, `st7789py.py`, `ssd1306.py` — and
growing with items 1-3 above) is pushed **unconditionally to every board on every bootstrap**, regardless
of whether that board's actual flows use MQTT, a display, buttons, any of it. Confirmed by reading
`deploy_runtime.py` directly this session, not assumed. Each addition (a second SPI display driver from
item 1, a touch driver from item 2, a GUI framework from item 3) makes this worse — flash cost accrues
per board regardless of what that specific board is actually running.

**Shape of a fix, not yet designed in detail:** a mapping from node `type` (as it appears in a flow file's
`nodes[].type`) to the vendor file(s) that node's generated code actually imports, computed from a given
flow before deployment, so `deploy_runtime.py`/`deploy_flow.py` push only what that flow's own node set
needs instead of the full `VENDOR_FILES` list every time. Open questions to work out: does this replace
the current "bootstrap once, deploy many flows" model (if flows on the same board use different node
sets, does each deploy need to check/patch the vendor files present?) or sit alongside it as a smarter
default; whether the mapping lives as a static table in `deploy_runtime.py`/`deploy_flow.py` or gets
derived from each `NodeDefinition`'s own `imports` (the same list `codegenSink`/`codegenTransform` already
return, which is suggestive — the codegen layer already knows exactly what a node imports, this might not
need a second source of truth at all); and whether this is scoped to vendor files only or extends to the
runtime's own core modules too (`errors.py`/`cbor.py`/`framing.py`/`messages.py`/`protocol.py`/
`runtime.py`, currently also pushed unconditionally — likely out of scope, those are required for every
flow regardless of node set, but worth a moment's thought before assuming so).
