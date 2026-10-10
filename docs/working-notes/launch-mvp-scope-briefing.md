# Briefing: product work the launch plan added to MVP

Status: brief, 2026-10-05. Written at the end of the marketing brainstorm session. Nothing below is started.

**Who this is for: implementation sessions** — anyone building product, docs or tests toward the launch. It says
what the launch needs from the product and in what order. **Marketing sessions: this isn't yours.** The marketing
plan (positioning, channels, video, landing page copy, community, measurement) is `marketing-plan.md` in the
separate ThingStudioMarketing repo (`~/Src/ThingStudioMarketing`). Don't take marketing decisions from this file,
and don't put marketing copy, channel plans or launch messaging into the product repo.

Decisions this briefing rests on: `decisions/launch-scope.md`. Earlier MVP scope it extends:
`road-to-mvp.md` (project doc; also `docs/road-to-mvp.md`) and `mvp-remaining-work-briefing.md`.

## What changed

Mike's calls, 2026-10-05:

- **One public launch, not a soft preview then a big one.** It happens once the items below are done.
- **The launch needs a headliner flow** (spec below) that shows display, touch input, a sensor and the
  network in one flow, on hardware viewers can buy.
- **The GUI templating system moves from POST-MVP onto the launch path.** It must be built properly, not
  as a stop-gap: Mike's words, "a half-assed implementation for a headliner would turn into a millstone".
- **Headless compile/validate goes up in priority.** AI authoring of flows and add-ons is now part of the
  pitch, and an agent can only check its own work if the compiler runs outside the browser. This also
  supports Mike's earlier idea of moving the compiler to the backend.

The `road-to-mvp.md` finish line (a newcomer reaches a working flow from the docs alone, no silent failure,
blink in 15 minutes) still stands. These items are added to it.

## Launch gates (in order)

1. The GUI system built properly, and the headliner working on the Freenove board (items 1–4 below).
2. A newcomer test passes, with a tester from the target group: a maker who knows MicroPython exists. (The
   2026-09-30 tester was an enterprise programmer who had never heard of MicroPython, so outside that group.)
3. Homebrew and Windows on real hardware (packaging, already tracked).
4. Pico W WiFi-password bug: Mike thinks it's resolved — confirm on hardware.

## The headliner flow — functional spec

**"A touch panel for the things you already own."**

**Hardware (changed 2026-10-09: the 4.0" FNK0104S, ST7796 320x480, replaces the FNK0104B below; `decisions/launch-scope.md`):** Freenove FNK0104B (ESP32-S3, 2.8" 240×320 touch display) plus a BME280 on I2C, an MQTT broker,
and a Tasmota plug or WLED strip that speaks MQTT. Chosen over the classic CYD because viewers can buy the
same board with published schematics; the classic CYD ships in several display variants with no visible
difference (Mike's unit is ST7789 despite ILI9341 docs). The classic CYD stays a supported board.

**What it does:**

1. **Senses:** shows temperature, humidity and pressure from the BME280, and publishes them over MQTT.
2. **Listens:** subscribes to the plug's or strip's state topic and shows its state.
3. **Acts:** an on-screen button toggles the plug or strip over MQTT.
4. **Fails clearly:** values show as *unknown* until they first arrive and as *stale* when updates stop or
   the broker drops. Pulling the WiFi visibly changes the screen to say so.

**Split, 2026-10-10 (Mike): the showreel and the external-controls flow are two flows.** The toggle is not much use
in a showreel video. The **headliner** is now parts 1 and the trends: BME280 readings, their history (journal and
trend widgets), and publishing over MQTT (`test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json`; hardware-checked
2026-10-10, including the MQTT publish). A separate **external controls flow** carries parts 2 to 4 (listen, act, fail clearly: a Tasmota/WLED
state shown, a toggle, unknown and stale values, WiFi pulled). It stays a launch item, because the acceptance below
(touch, MQTT both ways, unknown/stale on real hardware) is tested by it, not by the showreel. Mike picks the device.

**Acceptance:** built entirely on the canvas and in the GUI view, with no function node needed for drawing
or layout; deploys and runs on the Freenove board; touch, MQTT both ways, and the unknown/stale states all
work on real hardware; ships as an example flow plus a task guide in the user docs.

**Board facts, from Freenove's docs and two GitHub threads (verify on Mike's unit):**

- Display: ILI9341 on SPI — MOSI 11, SCLK 12, MISO 13, CS 10, DC 46, backlight 45, no reset pin.
- Touch: FT6336U capacitive, on I2C (pins and address not yet confirmed).
- Also: ES8311 audio codec (speaker and microphone), WS2812 RGB LED on GPIO42, BOOT button, SD card slot,
  battery connector, battery gauge on GPIO9.
- PSRAM: not confirmed. Freenove's S3 boards are usually 8 MB octal PSRAM — check.
- Unknown: whether an I2C header is exposed for the BME280.
- Sources: https://github.com/Freenove/Freenove_ESP32_S3_Display ,
  https://docs.freenove.com/projects/fnk0104/en/latest/fnk0104/codes/MAIN/Freenove_ESP32S3_Display.html ,
  https://github.com/facebookincubator/muse-gadget-sdk/pull/49 ,
  https://github.com/BruceDevices/firmware/issues/2432

## Work items, suggested order

### 1. The GUI system (critical path)

Design so far: `decisions/gui-layout.md` and `gui-layout-widget-system-scoping.md`. Already decided:

- Container-based layout, no absolute coordinates — like CSS flexbox, or X Intrinsics' constraint widgets
  (Mike's strong requirement).
- The layout engine runs in the editor at compile time; the device gets a flat table of resolved
  rectangles. Overflow is a build error with attribution, not a visual bug found on hardware.
- A separate GUI view, parallel to the flow view; GUI nodes are two-faced (data face in the flow view,
  presentation face in the GUI view); container trees in a new `screens` section of the flow file.
- Unknown is a first-class value state in the visual language.

Still recommendations, not decisions (settle with Mike at the start): the MVC split and the two-call device
boundary (`set_value` in, `event` out); the wider value-state set (unknown / known / stale / pending / error)
and `payload: None` as the unknown signal.

**Scope rule: cut widgets, not the layout model.** Build properly from the start: containers, the
measure/arrange passes, constraints, the `screens` section, the GUI view, and the value states — the parts
that are expensive to change later. Keep the widget set to what the headliner needs: **label, value,
button, status.** More widgets later should be additions, not redesigns.

The old `[POST-MVP]` "Templating UI nodes for displays" item in `outstanding-items.md` is superseded by this.

### 2. Freenove FNK0104B board support

*2026-10-09: superseded by the FNK0104S (4.0", ST7796), already supported (`freenove-s3-4in`, `vendor/st7796py/`).
ILI9341 is no longer launch work.*

- A board definition (`definitions/boards/`), processor `esp32-s3`.
- Verify PSRAM on Mike's unit. With PSRAM, a full RGB565 240×320 frame (153,600 bytes) should fit, so the
  headliner can be full colour.
- **ILI9341 in `display_spi`.** Today `controller` only accepts `st7789`, and `codegenSink` hardcodes the
  `st7789py` import and constructor (`cyd-touch-gui-flash-budget-briefing.md` item 1). A second controller
  needs real per-controller codegen branching. A third vendored driver also makes the "vendor files pushed
  to every board" item (`[P4]`, `deploy_runtime.py`'s `VENDOR_FILES`) worth fixing at the same time.
- Install docs must point at the right MicroPython firmware (the ESP32-S3 build with octal SPIRAM), or PSRAM
  won't appear. Follow `CLAUDE.md`'s "Unsupported boards" rule for everything else.

### 3. `touch_i2c` (FT6336U)

The first touch node is now the I2C one, not `touch_spi` (XPT2046). Research and architecture:
`touch-input-briefing.md` (an event source, built from `interrupt.ts`/`ebutton.ts`, not from the display
nodes). Design it for the controller family (GT911/FT6236/CST820 class), not one chip. `touch_spi` for the
classic CYD can follow.

### 4. Sensor wiring and the example flow

Confirm how the BME280 connects (I2C header, or a shared bus with touch). Build the headliner as an example
flow, plus a user-docs task guide ("Make a touch panel for an MQTT plug"). The existing `bme280`, MQTT and
WiFi nodes should cover the rest.

### 5. Headless compile/validate

A command that compiles and validates a flow file outside the browser, with the same errors the editor
gives. Check the cheap option first: run the existing TypeScript compiler under Node as a CLI. Moving the
compiler into the Python backend is a bigger design call for its own session, and the CLI shouldn't
foreclose it (`CLAUDE.md`, "don't paint into an architectural dead end"). Remember the npm rules in
`CLAUDE.md` before adding anything.

### 6. AI-authoring doc

A user-facing briefing for an AI agent writing flows and add-ons in the *user's* folder (not the repo-root
`AGENTS.md`, which is for agents working on Thingstudio itself — and is currently empty, 0 lines, although
`CLAUDE.md` imports it). Content: flow JSON format, the `msg`/`payload`/`topic` convention, custom node and
board/processor definition formats, "take pins from the board definition, never guess", unsupported boards,
and worked examples from `test-flows/`. Where it lives is open: an `AGENTS.md` the app writes into the user's
workspace on first run; a docs page plus `llms.txt`; a packaged skill — possibly one source for all three.
Its value depends on item 5.

**Test it like a newcomer test:** a fresh agent session with only this doc and a task (e.g. "read a BME280
and publish to MQTT on an ESP32"); measure how often the result validates, deploys and runs first time.

### 7. Download the generated Python

Viewing the generated code already works; add a way to download it. Small.

### Nice to have, not gates

- A WS2812 node and a speaker/tone node (the Freenove board has both; good "acts" outputs).
- An analog-input node (backlight from a light sensor; the classic CYD's LDR on GPIO34).

## Not for implementation sessions

Landing page copy, README marketing copy, the AI declaration wording, channels, video, community setup and
measurement belong to marketing sessions. Where those need something from the product, it's listed above or
gets added to `outstanding-items.md`'s "Launch MVP" section.
