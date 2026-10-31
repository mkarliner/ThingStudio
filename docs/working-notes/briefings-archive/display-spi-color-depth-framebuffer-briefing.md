# `display_spi` color depth / framebuffer memory — briefing, scoping only, not started

Written 2026-09-18, same day as the CYD real-hardware session and the node-properties work that
followed it. Nothing below is started -- this is the scoping pass Mike asked for ("scope a solution
for the framebuffer size in these kind of cases"), turned into a proper next-session briefing so
whoever picks it up doesn't have to reconstruct context from the outstanding-items backlog. As of this
writing, HEAD is `7df476d` ("display_spi: add colorOrder/invertColors/dataLatchOrder node properties,
CYD-defaulted") on `main`, with further uncommitted doc-only changes on top (the corroboration section
below, and this file) -- `git status` yourself before assuming anything about repo state.

Read `CLAUDE.md` in full first, as always. Then read
`docs/working-notes/outstanding-items/display-spi-framebuffer-memory.md` in full -- it has the real
memory math, the external corroboration, and the open architectural fork, and this briefing summarizes
rather than duplicates it. This doc's job is to turn that scoping note into something a session can
actually start building from.

## Where things stand

`display_spi` just got real node properties for panel-variant config
(`decisions/node-authoring.md`'s 2026-09-18 entry, `outstanding-items.md`'s "Resolved" section) --
CYD's controller variant, MADCTL bits, and inversion are all real properties now, not scratch-script
guesswork. Separately, the same CYD bring-up session hit a hard `MemoryError` trying to allocate a
full-resolution RGB565 frame on a classic ESP32 (`learnings/hardware-bringup-hil-rig.md`) -- worked
around only inside a one-off test script, not solved at the node or flow-authoring level. Mike then
found and shared a real-world account of exactly the fix he'd suggested (a 4-bit/GS4 indexed
framebuffer, expanded to RGB565 only when pushed to the display), with concrete numbers that
substantially de-risk the approach. That's now folded into the scoping note. Nothing has been built.

## The problem, briefly (full math in the scoping note)

A full 240x320 RGB565 frame is 153,600 bytes -- too big for a classic ESP32's heap in this session's
real testing, and a real risk on any board with less free RAM or other memory pressure (WiFi, MQTT,
other nodes in the same flow). `display_spi` itself doesn't allocate this buffer -- the flow author's
own `function` node does, typically via `framebuf.FrameBuffer(bytearray(w*h*2), w, h,
framebuf.RGB565)` -- so today nothing in this project stops a new flow from hitting the identical
crash CYD bring-up did.

## The proposed fix, with real-world backing

Build the frame as a 4-bit indexed buffer (`framebuf.GS4_HMSB`, MicroPython's own built-in format --
16 palette slots, a quarter the memory of RGB565) instead of full RGB565, and expand each pixel to
real color only at the point it's pushed to the display, not when it's stored. A real, independently
built driver doing exactly this (Mike's source) reports: a full 240x320 frame sent in **under 100ms**
using MicroPython's `@micropython.viper` code emitter for the row-expansion loop, no SPIRAM required,
2 rows expanded and sent per SPI transaction, and a real ~11-color palette (Material Design-inspired)
covering an actual UI's needs with a few slots left over. Scales to larger panels too (~150-170ms for
a 320x480 4" ili9486). Stated limitation: not useful for photos/arbitrary images -- a fixed small
palette, not a general-purpose framebuffer replacement, which is fine for this node's current
control-panel/status-display audience. Full detail: the "External corroboration" section of
`outstanding-items/display-spi-framebuffer-memory.md`.

## The decision this session needs to make (not made yet)

Two shapes, laid out in full in the scoping note's "open architectural fork" section:

1. **`display_spi` grows a `frameFormat`/`palette` property pair** and does the GS4-to-RGB565
   expand-and-push internally, as part of its own SPI-push codegen. Every flow author gets the memory
   saving automatically. Bigger surface area for the node -- real format-conversion logic and a
   palette concept, a step toward the drawing-primitives territory the design has deliberately kept
   out of `display_spi` so far (the POST-MVP templating item, `outstanding-items.md`).
2. **`display_spi` stays exactly as dumb as it is today** ("push these bytes as-is"), and the
   GS4-plus-expand-on-blit technique becomes a documented pattern -- a `function`-node code snippet in
   `docs/user-guide/nodes/display-spi.md`, or a worked example flow -- the same way the RGB565
   byte-swap gotcha is already handled. Cheap, no node-shape change, but nothing enforces it: a new
   flow author can still hit the exact `MemoryError` CYD bring-up did, unless they find the doc.

This needs Mike's call before any code gets written -- flag it with `AskUserQuestion` at the start of
whichever session picks this up, don't default to either shape. Per this project's own "don't paint
into an architectural dead end" habit: option 1 is more consistent with how `xstart`/`ystart` and the
`colorOrder`-family properties just landed (real properties, not documentation), but commits
`display_spi` to more scope than it's taken on so far; option 2 is cheap now but leaves every future
large-panel flow exposed to the same failure by default unless the doc is actually found and followed.

## If option 1 is chosen -- a starting shape (not designed in detail)

- A `frameFormat` property: `"rgb565"` (today's only behavior, stays the default -- no breaking
  change for TiDAL/CYD's already-working flows) vs. `"gs4"`.
- A `palette` property: 16 RGB565 entries. Worth seeding the default from Mike's source's own
  ~11-color Material-inspired set rather than inventing one -- concrete starting point, not a guess.
- Expansion happens inside `display_spi`'s own SPI-push codegen, matching the source's proven
  granularity (2 rows expanded to RGB565 at a time, one SPI transaction per pair) rather than the
  cruder ~25KB-strip approach this session's CYD scratch script used.
- `@micropython.viper` for the expansion loop's inner pixel-lookup, per the source -- this is the
  detail that got the real-world driver under 100ms; a plain Python loop almost certainly won't hit
  that, and hasn't been measured on this project's own hardware yet (real gap, see "Open questions").
- Input contract: today `display_spi`'s single `bytes` input is already-rendered pixel bytes for
  whatever `controller`/format it's configured for -- a GS4 buffer built via `framebuf.FrameBuffer`
  upstream (drawing primitives work identically, just against `GS4_HMSB` instead of `RGB565`) would
  still arrive as one `bytes` payload, so the wire-type contract itself likely doesn't need to change,
  only what `display_spi` does with those bytes once `frameFormat` says `"gs4"`. Confirm this rather
  than assume it once actually designing the codegen.

## If option 2 is chosen -- a starting shape (not designed in detail)

- A worked example flow (a new `test-flows/*.flow.json`, matching the existing precedent of
  `display-spi-tidal-test.flow.json`) whose `function` node builds a `GS4_HMSB` buffer, a 16-entry
  palette, and does the 2-row expand-and-push loop by hand in the flow's own Python, with
  `@micropython.viper` if it's confirmed to work from within a flow's `function`-node code (untested
  assumption -- MicroPython decorators inside dynamically-assembled function-node source may or may
  not behave the same as in a normal module; check before assuming).
- A new "Known limits" or "Large-frame memory" subsection in `docs/user-guide/nodes/display-spi.md`,
  same style as the existing RGB565 byte-swap gotcha, pointing a flow author at the example rather than
  leaving them to discover the `MemoryError` themselves.

## Open questions for next session (not resolved here)

- **Not yet measured on this project's own hardware**: whether `@micropython.viper` actually gets a
  GS4-to-RGB565 expansion loop under some usable threshold on the CYD's classic ESP32 (or TiDAL's
  ESP32-S3) -- Mike's source reports real numbers on their own hardware/driver, not this project's.
  Worth a real measurement before committing to either architectural shape, since the whole point of
  the fix is speed as well as memory.
- Whether `@micropython.viper` is usable from inside a `function` node's dynamically-generated source
  at all (relevant to option 2 above) or only from a real vendored/compiled module (relevant to option
  1, where the expansion loop would live in a vendored or codegen-emitted file, not user-typed flow
  code).
- Whether a default 16-color palette should be standardized project-wide (shared across `display_spi`
  flows) or per-flow/per-property with no shared default -- affects how much of Mike's source's own
  ~11-color Material set to bake in vs. leave fully open.
- Whether this interacts at all with `cyd-touch-gui-flash-budget-briefing.md`'s item 4 (loading only
  the vendor code a flow actually uses) -- almost certainly not directly (that's a flash/deploy-time
  concern, this is a RAM/runtime concern), but worth a moment's thought if option 1 ends up vendoring
  a new expansion helper module, since that module would then need a `VENDOR_FILES` entry subject to
  the same unconditional-push problem item 4 describes.

## Relationship to already-tracked items -- don't re-derive, don't conflate

- **`outstanding-items.md`'s POST-MVP templating item** ("Templating UI nodes for displays") -- stays
  exactly where it is, untouched. A palette/GS4 property is a memory optimization for an already-
  rendered frame, not a drawing/layout framework -- same "push an already-rendered frame" scope
  `display_spi` has held since it was built.
- **`outstanding-items.md`'s POST-MVP preset-dropdown item** -- unrelated axis (panel-variant config
  presets like "TiDAL badge"/"CYD 2-USB"), not affected by whichever framebuffer-format shape gets
  picked here.
- **`cyd-touch-gui-flash-budget-briefing.md`'s item 3** (GUI framework selection, LVGL/nanogui/
  microgui) -- worth a glance if picked up around the same time: LVGL's own partial-dirty-rect flush
  model is a different contract question from GS4-vs-RGB565's full-frame-memory question, but both
  touch "does `display_spi`'s current one-`bytes`-port-full-frame contract need to change," so
  whoever designs one should at least skim the other rather than design in isolation.

## Conventions to keep following (all established, don't relitigate)

- Confirm with Mike via `AskUserQuestion` before picking option 1 vs. option 2 -- not a call to make
  unilaterally, per his own explicit framing of this as something needing his decision.
- Off-device test first (pymock, extended if a new fixture is needed for `framebuf.GS4_HMSB` -- check
  `editor/test/fixtures/pymock/framebuf.py`, added for the `display_i2c`/`display_spi` work, for
  whether it already models GS4 or only the formats used so far), then a real-hardware pass -- same
  bar every prior display/touch node work has held itself to.
- If a new vendored module is needed for option 1's expansion helper: pinned commit SHA, before/after
  SHA-256 hashes, per-directory README, `docs/third-party-licenses.md` row -- the same template
  `primitives_events/README.md` and `st7789py_mpy`'s own vendoring already set.
- User-guide update in the same change as whichever shape lands, concise style
  (`docs/user-guide/nodes/display-spi.md`'s existing entries are the bar).
- Log the outcome in `decisions/node-authoring.md` (or a new decisions file if this grows into its own
  topic) the same way every other real decision this project makes gets logged -- not just left in this
  briefing.

## Not in scope for this chat

- Actually building either option -- this is scoping only, per Mike's explicit "scope a solution" ask
  and his own priority call this session ("lets get node properties in" came first).
- The GUI-framework selection or touch-driver work from `cyd-touch-gui-flash-budget-briefing.md` --
  related, not this doc's job.
- Re-litigating whether CYD's confirmed MADCTL/inversion config is correct -- that's settled
  (`decisions/node-authoring.md`'s 2026-09-18 entries), not part of this topic.

## Git

Before handing Mike any `git add`/`git commit` sequence, also tell him to run `rm -f .git/index.lock`
first, regardless of what ran in the sandbox before it -- confirmed this same session that a lock file
can appear from sandbox-side read-only commands too, not just writes (`CLAUDE.md`'s "Git writes from
the agent sandbox" section has the full incident). Never run `git commit` from the agent sandbox itself.
