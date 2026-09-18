# Touch-screen input — briefing for next session

Written 2026-09-18, right after `display_spi` closed out gs4/gs2/mono on real CYD hardware. Nothing
below is started — planning only, so a future session can pick this up without rediscovering context.
This supersedes and replaces `cyd-touch-gui-flash-budget-briefing.md`'s item 2 (which was a short,
"not researched yet" placeholder) with real research; that doc's items 1/3/4 (CYD display, GUI
framework, flash budget) are untouched by this doc and still stand on their own. Read
`framebuffer-display-node-scoping.md` (Claude project) and `node-definition-model.md` first if you
haven't already worked on this project's display/event-source nodes before -- this briefing builds
directly on both.

## Goal

A touch-input node family, parallel to `display_spi`/`display_i2c`: `touch_spi` (resistive, XPT2046 --
CYD's own touch controller, the natural first real-hardware target since CYD is already being brought
up for item 1 of the other briefing) and `touch_i2c` (capacitive, GT911/FT6236/CST820-class chips, no
real-hardware target lined up yet but worth designing for from the start rather than bolting on later).
Mirrors this project's already-established `display_spi`/`display_i2c` bus-family split
(`framebuffer-display-node-scoping.md`'s "the framebuffer contract, not one universal node" steer) --
not re-litigated here, just reused.

**Architecturally this is an event source, not a sink** -- confirmed, not assumed, by looking at how
`interrupt`/`ebutton`/`eswitch` are actually built: touch produces data (coordinates, press/release)
rather than consuming it, so it wants `NodeDefinition.codegenEventSource`
(`editor/src/compiler/node-definition.ts`'s `EventSourceCodegenResult` -- `waitStatement` +
`buildMsg`, no `repeatMs`), the same fourth codegen pattern `interrupt.ts` introduced specifically
because "block until an external event fires" has no `repeatMs` value that means that. `display_spi`/
`display_i2c`'s own `codegenSink` pattern is the wrong shape entirely for this -- don't start from
those files, start from `interrupt.ts`/`ebutton.ts`.

## Hardware facts, researched this session (not carried over from the old placeholder)

**CYD's XPT2046 touch controller is on a SEPARATE SPI bus from the display, not a shared one.**
Corroborated by multiple independent sources, including a real runnable MicroPython pin/baudrate
config, not just a pin table:

| Signal | GPIO |
|---|---|
| T_CLK (SCK) | 25 |
| T_CS | 33 |
| T_DIN (MOSI) | 32 |
| T_DO (MISO) | 39 |
| T_IRQ | 36 |

vs. the display's own HSPI/SPI2 bus (SCK=14, MOSI=13, MISO=12, CS=15, DC=2, BL=21 --
`cyd-touch-gui-flash-budget-briefing.md`). Sources: [Mischianti's CYD pinout](https://mischianti.org/esp32-2432s028-cheap-yellow-display-high-resolution-pinout-datasheet-schema-and-specs/)
(explicitly labels this "Touch (VSPI)"); [Random Nerd Tutorials' CYD pinout](https://randomnerdtutorials.com/esp32-cheap-yellow-display-cyd-pinout-esp32-2432s028r/)
(explicitly notes touch and display are on separate buses "to function simultaneously without bus
conflicts"); [Random Nerd Tutorials' MicroPython CYD guide](https://randomnerdtutorials.com/micropython-cheap-yellow-display-board-cyd-esp32-2432s028r/)
has real working code: `SPI(2, baudrate=1000000, sck=Pin(25), mosi=Pin(32), miso=Pin(39))` +
`Touch(touchscreen_spi, cs=Pin(33), int_pin=Pin(36), ...)`; [jtobinart/MicroPython_CYD_ESP32-2432S028R](https://github.com/jtobinart/MicroPython_CYD_ESP32-2432S028R)
is a maintained MicroPython library for this exact board bundling this pin story.

**One conflicting data point, flagged not resolved:** [an ESPHome issue](https://github.com/esphome/esphome/issues/16879)
has a reporter's YAML putting touch on the display's own HSPI pins (14/13/12 + CS33) and reporting
touch failure there -- most likely a misconfiguration on the reporter's part (attempting to consolidate
onto one bus) rather than a genuine alternate wiring, since GPIO-to-controller wiring is fixed in
copper and the separate-VSPI-bus story is far more corroborated, including by runnable code. No
independent confirmation found of a hardware revision that actually shares the bus. Treat as
unresolved rather than a real alternate config; don't build around it without checking against Mike's
actual unit first, same "controller variant is genuinely ambiguous across batches" caution the other
briefing already applies to CYD's display chip.

Practical upshot: **no shared-bus baudrate-conflict question to solve for CYD specifically** (each bus
gets its own `machine.SPI(id, ...)` instance, no interaction with `display_spi`'s own SPI construction)
-- but this is a CYD-specific fact, not a general one. A different board that genuinely does put touch
and display on one shared physical SPI peripheral would raise a real design question `display_spi`'s
current codegen doesn't have an answer for: it constructs its own dedicated `machine.SPI(spiBus, ...)`
unconditionally (`display-spi.ts`, no dedup/sharing mechanism across node instances, unlike e.g.
`ebutton.ts`'s fixed-name-per-pin dedup for a shared driver instance). Worth a moment's thought before
assuming a future shared-bus board "just works" -- not a CYD blocker, flagged for whenever it comes up.

**CYD has a second, capacitive variant** (ESP32-2432S024C, "CYDc") using a **CST820** I2C touch
controller instead of XPT2046 -- confirmed via [a board-definition bug report](https://github.com/rzeldent/platformio-espressif32-sunton/issues/51)
that specifically flags some ESPHome/PlatformIO board defs incorrectly listing CST816S/GPIO21 for this
variant when it's actually CST820. Good concrete illustration of why `touch_i2c`/`touch_spi` need a
`controller` picklist the same way `display_spi`/`display_i2c` do, not an assumption baked into the
node -- confirm which physical unit Mike has before picking a controller default.

**XPT2046 electrical/protocol facts, from the datasheet directly:**
- Max SPI clock ≈ 2 MHz (125 kHz ADC sample rate × 16 clocks/sample) -- [datasheet](https://grobotronics.com/images/datasheets/xpt2046-datasheet.pdf),
  corroborated by [components101](https://components101.com/ics/xpt2046-touch-screen-controller-ic).
  Confirms the "much slower than the display's 27-60MHz" expectation; the field example above uses a
  conservative 1MHz. Irrelevant to bus-sharing on CYD specifically (separate bus, above), but this is
  the number to reach for if a future board's `touch_spi` baudrate property needs a sane default.
- T_IRQ (datasheet's PENIRQ) genuinely goes low on touch (X+ line pulled toward ground through the
  resistive layer) -- confirms an interrupt/event-driven design is the right shape, not just polling.
  This is a real GPIO IRQ pin exactly like `interrupt.ts`'s own subject -- `touch_spi`'s IRQ handling
  should very likely reuse the exact same `ThreadSafeEvent` hard-IRQ-to-uasyncio bridge
  (`device-runtime/src/vendor/threadsafe_event/`) `interrupt.ts` already established and its README
  already traces as hard-IRQ-safe, not a fresh mechanism.
- XPT2046 delivers **raw uncalibrated 12-bit ADC values**, never pre-calibrated screen coordinates.
  Every driver found (below) requires a per-panel calibration step. This is real setup-UX surface area
  a `display_spi`-style "just pins and a controller picklist" node doesn't have to deal with -- see
  "Calibration, a genuinely new design question" below.

## Driver candidates researched, license-checked

All three below are pure-Python, MIT-licensed, no custom-firmware/C-module requirement -- fit this
project's stock-MicroPython + `mpremote cp` deployment model the same way `st7789py_mpy` was chosen
over `russhughes/st7789_mpy` for exactly that reason (`decisions/node-authoring.md`'s 2026-09-17
entry). None fetched/vendored/hash-verified yet -- this is a candidate list, not a vendoring record;
whichever gets picked needs the full `st7789py_mpy`-style README treatment (pinned commit SHA via a
real `git log -- <path>`, dual-fetch SHA-256 verification, `third-party-licenses.md` row) before it's
actually vendored.

**XPT2046 (resistive, `touch_spi`):**
- [rdagger/micropython-ili9341](https://github.com/rdagger/micropython-ili9341)'s `xpt2046.py` -- MIT,
  zero deps. `XPT2046(spi, cs, int_pin=None, int_handler=None, width, height, x_min, x_max, y_min,
  y_max)`. Simple linear min/max calibration per axis (4 constants). Supports both polled (`get_touch()`)
  and IRQ-driven (`int_pin`/`int_handler`) operation. Already field-proven specifically on CYD via
  jtobinart's repo above -- the "someone already got this exact chip on this exact board working"
  precedent counts for something.
- [robert-hh/XPT2046-touch-pad-driver](https://github.com/robert-hh/XPT2046-touch-pad-driver) -- MIT,
  zero required deps (optional `uasyncio` for an async variant). `get_touch()` returns `(x, y)` or
  `None`. More sophisticated 8-value affine-style calibration vector (vs. rdagger's simple linear
  min/max), derived via a bundled 4-point `calibrate.py` tool -- better geometric correctness
  (handles rotation/skew, not just per-axis scaling) at the cost of a fussier calibration UX. Also
  supports both polled and IRQ-driven modes.
- [peterhinch/micropython-touch](https://github.com/peterhinch/micropython-touch) -- MIT. A common
  abstract base class across multiple controllers (XPT2046, FT6206, TSC2007, CST816S/CST820/CST328
  referenced in its README) -- same Peter Hinch source this project already trusts and has vendored
  from three times (`mqtt_as`, `threadsafe_event`, `primitives_events` -- "every asyncio-based library
  vendored so far in this project is his," per the other briefing). Expects a nano-gui-style display
  driver underneath, which doesn't match this project's own `display_spi` shape without adaptation --
  worth reading as a reference implementation for the unified `touch_spi`/`touch_i2c` abstraction even
  if not vendored verbatim, same way `micropython-lib`'s SSD1306 driver was read for its
  `framebuf.FrameBuffer`-subclass shape without necessarily copying its whole design.

**Capacitive I2C (`touch_i2c`), no real-hardware target lined up yet, lower priority:**
- GT911: [esophagoose/gt911-micropython](https://github.com/esophagoose/gt911-micropython) -- MIT,
  pure Python, no deps. `GT911(sda, scl, interrupt, reset)`, `get_points()` (multi-touch), interrupt or
  polled. Common on larger Sunton/Waveshare ESP32-S3 panels (4.3"/7"+), not CYD.
- FT6236/FT6336: [lbuque/micropython-ft6x36](https://github.com/lbuque/micropython-ft6x36) (also on
  PyPI) -- MIT per PyPI metadata (the repo's own LICENSE file branch wasn't pinned down -- confirm
  directly before vendoring, don't take the PyPI metadata as the final word). Two-point touch,
  rotation support. IRQ-vs-polling behavior not confirmed from available material -- read the source
  before committing to a design around it.
- CST816S/CST820: no clean standalone pure-MicroPython driver found outside `peterhinch/
  micropython-touch` above -- most other CST816-family MicroPython code found was embedded in
  board-specific LVGL/watch projects, not a reusable standalone driver. CircuitPython options exist
  (e.g. `NeoStormer/CircuitPython_CST816`) but are a different API family (`board`/`busio`, not
  `machine`) -- not a drop-in port, don't assume portability without checking.

None of the drivers found expose hardware gesture recognition (swipe/long-press IDs some
CST816-series chips support in their register map) -- out of scope for a v1 either way, flag only if a
future ask specifically wants gestures.

## Calibration -- a genuinely new design question, no existing precedent in this project to reuse

Unlike `display_spi`'s pin/controller properties (static, known once from a datasheet, same for every
unit of that board), touch calibration constants are **per physical panel, not per board model** --
two CYD units of the identical model can need slightly different min/max or affine constants due to
manufacturing tolerance. This doesn't fit cleanly into either of this project's two existing property
patterns (a plain node property, or a config node referenced by ID via `resolveConfig` --
`node-definition.ts`). A `config` node (shared, reusable settings referenced by ID,
`config-node-and-palette-implementation-briefing.md`) is probably the right fit for calibration
constants specifically -- reusable across multiple touch reads on the same panel, edited once --
worth confirming against that briefing's own design before assuming, not just asserted here.

Real open questions, not decided: does this project want a guided on-device calibration flow (a
`function`-node-driven "tap these 4 corners" wizard flow, output constants a flow author copies into a
config node -- closest to robert-hh's `calibrate.py` tool's own approach) or does it accept manually-
entered raw ADC min/max as a first pass (closer to rdagger's simpler model, less accurate but much
less to build)? Given this project's own "no premature optimization, but don't paint into a dead end"
principle (`interrupt.ts`'s header cites the same one for its debounce-algorithm choice), a v1 that
starts with rdagger's simpler linear min/max (matching CYD's own field-proven precedent) and treats an
on-device calibration wizard as a clearly-separable follow-up looks like the safer shape to commit to
first -- not decided here, flagged as the natural default absent a reason to start with the fussier
8-parameter approach.

## Node/message shape, open questions

Not designed yet -- a few concrete questions worth answering before writing any codegen, following the
same "resolve the real design fork before building" discipline `display_spi`'s own gs4/gs2/mono session
applied to MicroPython's bit-packing order:

- **Event granularity**: touch-down / touch-up as two `topic`s (mirroring `ebutton`'s `press`/`release`
  topic-carries-event-identity single-output design, `ebutton.ts`'s own precedent) is the obvious
  starting shape. Does a v1 also need touch-move (continuous position while held), or is that better
  left to a v2 given it changes the event cadence entirely (a stream of positions, not a single
  press/release pair) -- Mike's call, not decided here.
- **Payload shape**: `{x, y}` coordinates seems obvious, but should `payload` be a dict (`{'x': ..,
  'y': ..}`, matching this project's own `msg` dict convention elsewhere) or should x/y become part of
  `msg` at the top level alongside `topic`/`payload`? `ebutton`'s own `payload` is a single bool
  (button state) -- touch needs two numbers, no existing single-value precedent to copy directly.
- **Debounce/settle**: does a touch controller need anything like `interrupt`'s cooldown-window
  debounce, or does IRQ + a single SPI read-and-verify already give a clean enough signal without one?
  `interrupt.ts`'s header explains why its own debounce lives in the coroutine (soft context) rather
  than the IRQ handler -- if `touch_spi` needs debounce too, that same split is the template to copy,
  not re-derive.
- **Multi-touch**: XPT2046 is inherently single-touch (resistive). GT911 supports real multi-touch
  (`get_points()` plural, above) -- does `touch_i2c` need a `payload` shape that can carry more than
  one point from day one, or is single-touch-only an acceptable v1 scope limit for both node types
  (simpler, and XPT2046 is the only real hardware target lined up anyway)? Not decided.

## Testing/verification plan (mirror the established standard, don't invent a new one)

Same process this project has now run twice for `display_spi` (gs4, then gs2/mono): a pymock-based
off-device harness extension first (this project's `pymock/machine.py`-style SPI/Pin fixtures, per
whatever `ebutton`'s own test file uses for its `machine.Pin`/`WaitAny` mocking -- read
`editor/test/node-ebutton.test.ts` or equivalent for the actual pattern before writing a new one from
scratch), verified via `tsc --noEmit` + `vitest run` against an isolated extraction
(`CLAUDE.md`'s mandated fallback, never `npm ci`/`vitest` against the live-mounted `editor/` directly),
*then* a real CYD hardware pass -- don't call it done until that real pass is clean, the same standard
gs4/gs2/mono and the TiDAL display bring-up both held themselves to. A real-hardware test flow
(`test-flows/touch-spi-cyd-test.flow.json` or similar) wired into a `display_spi` CYD flow so a touch
event can visibly draw something (a dot at the touch coordinates, reusing the already-confirmed gs4/
gs2/mono render pipeline) is probably the most convincing single real-hardware proof, same spirit as
the gs4 animation flow being "showing off" as well as a real test.

## Open questions carried forward

- CYD's XPT2046 pin mapping (25/32/39/33/36, separate VSPI bus) is well-corroborated but not yet
  confirmed against Mike's actual physical unit the way the display controller variant was -- do that
  confirmation pass before wiring pins into a flow, not after.
- Driver pick between rdagger's (simpler, CYD-field-proven) and robert-hh's (more accurate
  calibration) XPT2046 driver -- leaning rdagger for v1 per the calibration section above, not decided.
- Calibration UX (manual constants vs. guided wizard) -- leaning "start manual, wizard as a follow-up,"
  not decided.
- Event granularity/payload shape/debounce/multi-touch -- all open, above.
- `touch_i2c`'s own controller pick and first real-hardware target -- no board lined up yet, lower
  priority than `touch_spi`/CYD.
- Whether `display_spi`'s current "no shared-bus dedup" gap ever needs solving depends entirely on a
  future board actually sharing a physical SPI peripheral between display and touch -- not CYD, not
  blocking this work, just flagged so it isn't rediscovered from scratch later.
