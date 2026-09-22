# `display_spi` framebuffer construction can exceed available heap — all three indexed depths (gs4/gs2/mono) confirmed on real CYD hardware

Status: scoped 2026-09-18 (Mike's request after the CYD real-hardware bring-up session hit a real
`MemoryError`), decided the same day, and `frameFormat: "gs4"` implemented the same day (`display-
spi.ts`, `nodes.ts`, `PropertyPanel.vue`, `node-display-spi.test.ts`, `docs/user-guide/nodes/
display-spi.md` -- see `decisions/node-authoring.md`'s later 2026-09-18 entry for the implementation
itself). **Verified the same day** by a real `tsc --noEmit` (clean, apart from a pre-existing unrelated
`node-startup.test.ts` gap) and a real `vitest run` against an isolated extracted copy, per
`CLAUDE.md`'s mandated fallback for not running these against the live-mounted `editor/` directly --
`node-display-spi.test.ts` is 27/27 passing. That pass caught and fixed 4 real TypeScript strict-null
errors (`?.[1].trim()` needed `?.[1]?.trim()`), and separately surfaced that an earlier
`device_commit_files` push of the corrected expansion function had silently not landed on the actual
device file -- the file kept the old, buggy flat-byte expansion until a second push, re-verified
on-device by grep immediately after, actually took. Worth remembering: `device_commit_files` returning
success is not sufficient confirmation the content landed -- re-read the on-device file after a push
before trusting it, especially before a verification pass that will be graded against that push. `gs2`/
`mono` were built later the same day and are now also confirmed on real hardware (see the dedicated
section below).

**A real-hardware test flow for `gs4` now exists, not yet run:**
`test-flows/display-spi-gs4-cyd-test.flow.json`, targeting the same CYD unit whose classic-ESP32
`MemoryError` motivated this whole fix, at its full native 240x320 resolution -- the direct test of
whether the fix actually works, not just memory math on paper. Verified via `verify-flow-file.ts` and a
`compile()` dry run (confirms the 38,400-byte frame -- a quarter of the 153,600 bytes that failed --
correct MADCTL/inversion matching CYD's already-confirmed RGB565 config, and the corrected
stride-aware expansion function). See `test-flows/README.md`'s own entry for the full flow description
and what to watch for. Deploying it needs a real Terminal on Mike's machine with the board attached --
not something this session can do itself.

**Deployed for real, 2026-09-18 -- confirmed working end to end, including real viper.** The first
real deploy attempt boot-looped (`SW_CPU_RESET`) -- not a gs4/viper bug, root-caused via a standalone
step-by-step probe script (`test-flows/cyd-display-spi-init-probe.py`) to `display_spi`'s own 40MHz
default SPI baudrate exceeding what this CYD's specific (GPIO-matrix-routed) pins can sustain: ESP-IDF
silently created an invalid SPI device handle, which then hard-crashed (`Guru Meditation Error:
LoadProhibited`) on the first real transaction. Fixed by pinning the test flow's own `baudrate:
27000000` (matching every prior CYD script) -- no codegen change. Full incident:
`decisions/node-authoring.md`'s "CYD `display_spi` real hard-crash root-caused" entry,
`learnings/hardware-bringup-hil-rig.md`. Redeployed with the fix and **rendered correctly** -- first
with `@micropython.viper` temporarily disabled (a diagnostic-only flag, to isolate the crash from
viper while both were still unknowns), then again with real viper re-enabled: **also rendered
correctly**. That second run is this project's first-ever real-hardware execution of
`@micropython.viper`-compiled code on Xtensa/ESP32 -- the one piece of the whole gs4 feature that
hadn't been proven on real silicon before now (the off-device spike below used a unix-port interpreter,
different CPU entirely). This closes out `gs4` end to end: built, statically verified, and now
confirmed live on the actual hardware and code path (real viper, real mpy-cross `-march`, real SPI
timing) it was designed for.

A same-day `test-flows/display-spi-gs4-cyd-animation.flow.json` drives the same confirmed pipeline
continuously (timer-driven, not single-inject) as a rough visual/refresh-rate demo -- not a timing
measurement, no on-device instrumentation added; per-frame timing on real hardware (viper expansion +
SPI transfer together) is still unmeasured, see the off-device-spike caveat below.

**A second, more fundamental bug found and fixed during that first real deploy attempt, 2026-09-18:**
the editor's own browser Deploy pipeline (`editor/src/app/main.ts`'s `compileToMpy()`) calls the
vendored `mpy-cross` WASM build with no `-march=<arch>` flag at all -- harmless for ordinary bytecode
(architecture-independent), but `@micropython.viper` needs the native-code emitter, which requires an
explicit target architecture. First real attempt to Deploy the gs4 CYD flow failed with
`SyntaxError: invalid arch` from mpy-cross itself -- not a viper/gs4 code bug, a gap in the deploy
pipeline that was simply never exercised before (the earlier off-device viper spike used a from-scratch
native `mpy-cross` build with an explicit `-march`, never this WASM path; the vitest suite's own
pymock `viper` stub never invokes mpy-cross at all). Confirmed by reading the actual arch list embedded
in `editor/public/vendor/mpy-cross/mpy-cross.wasm` directly (`strings` on the binary), and reproduced +
fixed + verified against the real WASM module run directly under Node (not guessed): passing
`-march=xtensawin` compiles the exact gs4-generated source cleanly (2615-byte `.mpy` output), and
produces byte-identical bytecode output for a plain non-viper snippet with or without the flag (SHA-256
match) -- confirms zero regression risk for every other flow type. Fixed in `main.ts` (a single named
`MPY_CROSS_MARCH = "xtensawin"` constant, correct for every board this project currently targets --
ESP32/ESP32-C3/ESP32-S3 are all Xtensa). **Real gap not closed by this fix, flagged not solved**: no
board/architecture concept exists anywhere in the compile pipeline to pick a different arch from --
fine today (no ARM-family board, e.g. the RP2040/RP2350 boards this project's `interrupt-basic.pico-
*.flow.json` flows already target, uses viper/native code anywhere yet), a real landmine whenever one
does. Logged in `learnings/editor-build-tooling.md`; verified clean `tsc --noEmit` after the fix
(same pre-existing unrelated `node-startup.test.ts` gap, nothing new).

**Gap closed, 2026-09-22 -- MVP item 3 (`mvp-kickoff-brief.md`), board-aware compile.** New
`editor/src/app/native-arch.ts` (`inferNativeArch()`) replaces the single `MPY_CROSS_MARCH` constant
with a per-board mapping, inferred from HELLO's `chipType` string with a manual-override dropdown
(`nativeArchSelect`, `index.html`) for when Auto guesses wrong or no board is connected yet.

**A second wrong assumption found while building this, distinct from the RP2040/RP2350 gap already
flagged above:** the single-constant fix's own reasoning -- "ESP32/ESP32-C3/ESP32-S3 are all Xtensa" --
was itself incorrect. ESP32-C3 (and C6) is a RISC-V core, not Xtensa, confirmed against MicroPython's
own docs (`docs.micropython.org/en/latest/develop/natmod.html`'s arch table: `rv32imc -- eg ESP32C3,
ESP32C6`) and independently by Espressif's own chip documentation -- `xtensawin` was silently wrong for
every C3 board this project has (the LuatOS CORE-ESP32-C3 hardware used for ebutton/eswitch/interrupt
work), just never caught because no viper-using flow had ever been deployed to one -- `gs4`'s own
real-hardware proof above used a CYD (ESP32-WROOM, genuinely Xtensa), not a C3 board.

Full mapping, with confidence noted (`native-arch.ts`'s own header has the sourcing detail for each):
ESP32/ESP32-S3 -> `xtensawin` (confirmed, unchanged); ESP32-C3/C6 -> `rv32imc` (confirmed, the
correction above); RP2040 -> `armv6m` (confirmed -- Cortex-M0+, MicroPython's own docs table: "eg
Cortex-M0"); RP2350 -> `armv7emsp` (**not confirmed** -- community-sourced from a MicroPython
maintainer discussion, `github.com/orgs/micropython/discussions/16538`, no real-hardware verification
by this project; `armv7m` offered as a no-FPU fallback in the same thread, also selectable via the
manual override). An unrecognized board falls back to `xtensawin`, also unconfirmed, same "harmless
unless the flow uses viper" reasoning as the original single-constant default.

Verified: 11 new cases in `editor/test/native-arch.test.ts` (against real observed `chipType` strings,
e.g. `"Raspberry Pi Pico W with RP2040"` from `protocol.roundtrip.test.ts`'s own test data, not
invented ones), isolated `tsc --noEmit` (clean, same pre-existing unrelated `node-startup.test.ts`
gap) and `vitest run` (full suite, 558/561 passing -- the 3 failures are the same pre-existing/
environmental ones already tracked elsewhere, none touching this change). **Not done: any
real-hardware pass** -- no board was available this session (same constraint as the runtime-install
work landed the same day, `decisions/runtime-install-from-editor.md`). RP2350's guessed arch in
particular needs a real board to confirm or correct.

## The problem, with real numbers

`display_spi` takes one already-rendered `bytes` frame as its single input -- by design, it doesn't
know about `framebuf` drawing primitives, just raw pixel bytes to push over SPI
(`outstanding-items.md`'s "Resolved" entry for the node explains why: bus-family-generic, graphics-
framework-agnostic). The flow author is the one who allocates the frame buffer, typically via
`framebuf.FrameBuffer(bytearray(w*h*2), w, h, framebuf.RGB565)`.

For CYD's native 240x320 panel that's `240 * 320 * 2 = 153,600` bytes in one contiguous allocation.
This session's CYD bring-up hit exactly this as a hard `MemoryError: memory allocation failed,
allocating 153600 bytes` on a classic ESP32 (dual-core, ~320KB usable RAM, already carrying MicroPython
runtime + `mqtt_as` + whatever else the flow needs). The workaround used to get bring-up unblocked
(`test-flows/cyd-display-test-pattern.py`'s rewritten version) was to build and push the frame one
~25KB horizontal strip at a time with `gc.collect()` between strips -- real, but a one-off script's
workaround, not anything `display_spi` or the flow-authoring contract does for a real user today.
Classic ESP32-S/original ESP32 boards with less free heap (or a flow already carrying other memory
pressure -- WiFi, MQTT, other nodes) are the boards most exposed; RP2350/ESP32-S3-class boards with
more RAM are less likely to hit this at 240x320, but the ceiling still exists at larger panel sizes.

## Mike's suggested shape: declare a lower bit depth, expand on the fly

Build the frame as a 4-bit indexed/palette buffer instead of full RGB565, then expand each pixel to
real 16-bit color only when it's actually pushed to the display, not when it's stored.

Memory math for CYD's 240x320: a 4-bit (16-color) indexed frame is `240 * 320 / 2 = 38,400` bytes --
a quarter of the RGB565 frame's 153,600 bytes, comfortably inside a classic ESP32's free heap as one
contiguous allocation (no strip-juggling needed just to hold it). MicroPython's own `framebuf` module
already has a matching built-in format, `framebuf.GS4_HMSB` (4 bits per pixel, 2 pixels per byte,
values 0-15) -- so the *drawing* side (text, shapes, fills) would work against a real
`framebuf.FrameBuffer` object exactly like today, just built with `GS4_HMSB` instead of `RGB565`, using
pixel values 0-15 as palette indices rather than direct colors.

Expansion happens at push time: for each 4-bit index, look it up in a small 16-entry palette (index ->
RGB565 value) and write out the real 2-byte pixel. That expansion still needs somewhere to land -- the
natural fit is the same per-strip approach the CYD bring-up script already proved works (expand one
strip's worth of indices to RGB565 in a small scratch buffer, push that strip, move on), so the *peak*
memory for one strip stays small regardless of full-frame size, and the indexed source buffer itself is
already a quarter the size to begin with. MicroPython has no vectorized array-expand primitive for
this, so the expansion loop is a plain per-pixel Python loop -- a real CPU/time cost per frame, worth
measuring on real hardware before assuming it's fast enough for any given flow's update rate; not
measured here.

## External corroboration: a real-world GS4 UI-display driver (source Mike found)

A practitioner's own account of building exactly this design point, independently, confirms the
approach is real and describes it in more concrete detail than either the CYD `MemoryError` this
session hit or the general math above:

- **Palette size confirmed practical, not just theoretical**: ~11 colors, chosen from Google's
  Material Design color picker, covering the actual needs of a real UI -- leaving a handful of the
  remaining GS4 slots (16 total) free for "arbitrary use / not decided yet." A concrete starting
  point for this project's own default palette, if/when one gets built, rather than inventing one
  from scratch.
- **No SPIRAM required** -- relevant here specifically because the CYD's classic ESP32 (and other
  classic-ESP32 boards without PSRAM) is exactly the case this session's `MemoryError` hit; GS4's
  smaller footprint means it doesn't need to fall back to slower/optional PSRAM the way a full
  RGB565 buffer might on a PSRAM-equipped board.
- **Real timing numbers, not a guess**: full 240x320 frame sent in **under 100ms**, in "pure"
  MicroPython using the `@micropython.viper` code emitter for the row-expansion inner loop -- this
  is the detail this scoping note was originally missing (it only flagged "a plain per-pixel Python
  loop... a real CPU/time cost... not measured here"). `viper` is MicroPython's near-native-speed
  typed-subset emitter, exactly the tool for a tight per-pixel expand loop like this -- worth
  reaching for directly rather than re-discovering the need for it through a slow first attempt.
- **Expansion granularity**: 2 rows at a time, each expanded to RGB565 then sent as one SPI
  transaction -- finer-grained than the ~25KB-strip approach this session's CYD scratch script
  used, and the granularity that got to <100ms.
- **Scales to a larger panel too**: the same driver adapted to a 320x480 ili9486 4" display takes
  ~150-170ms per frame -- a useful reference point if a future board needs a bigger display than
  CYD's 240x320.
- **Known limitation, stated plainly by the source**: not useful for photos/arbitrary images -- a
  fixed ~11-16 color palette is a UI/graphics tool, not a general-purpose framebuffer replacement.
  Consistent with this node's own current audience (control-panel/status-display UIs, not photo
  viewers).
- A further speed-up path the source identifies but didn't need: writing the expansion in C, or
  going further and queueing SPI transactions directly via esp-idf calls (bypassing MicroPython's
  own SPI driver, which the source characterizes as slow) -- not needed to hit "fast enough," and
  not something to chase here without a concrete reason to.

This substantially de-risks Mike's suggested shape above: it's a proven, shipped technique
elsewhere, with real numbers, not just plausible math. It doesn't resolve the architectural fork
below on its own -- that's still whether `display_spi` should own this internally or stay dumb and
document the pattern -- but it does mean either path now has a validated implementation to follow
rather than a from-scratch design.

## The architectural fork -- RESOLVED, 2026-09-18 (Mike's call, via `AskUserQuestion`)

**Option 1, extended.** `display_spi` grows real properties and does the expansion internally.
Extended beyond the two shapes below (Mike's own ask, same session): support four frame depths, not
two -- `frameFormat`: `"rgb565"` (default, unchanged), `"gs4"` (4bpp), `"gs2"` (2bpp), `"mono"` (1bpp)
-- mapping directly onto MicroPython's own `framebuf` formats (`RGB565`/`GS4_HMSB`/`GS2_HMSB`/a
`MONO_*` variant). All three reduced depths are palette-driven (one 16-entry RGB565 `palette`
property used regardless of `frameFormat`, not hardcoded gray/black-white ramps for the low depths).
Full decision write-up, including what's still open (default `gs2`/`mono` palette seeding, exact
`MONO_*` variant, phasing/sequencing, row-batching size per depth): Claude-project doc
`display-spi-framebuffer-format-decision.md` (ThingStudio project -- transcribe into this repo's own
`decisions/node-authoring.md` in full once implementation starts; a short pointer entry already
exists there as of 2026-09-18). Not built yet. The two shapes below are kept as-is for the historical
record of what was being decided between -- option 1 (extended) is what's actually happening now.

### The two shapes that were on the table

Two real shapes this could take, and they commit the project to different things:

1. **`display_spi` grows this itself.** The node gains an input-format property (e.g. `frameFormat`:
   `"rgb565"` (today's only option) vs `"gs4"`) and a `palette` property (16 RGB565 entries, with a
   sensible default), and does the expand-and-strip-push internally as part of its own SPI-push
   codegen. Upside: every flow author gets the memory saving for free, enforced rather than opt-in.
   Downside: the node stops being purely "push these bytes as-is" -- it now has real format-conversion
   logic and a palette concept, which is more surface area and moves it a step toward the
   templating/drawing-primitives territory the design has deliberately kept out of this node so far
   (`outstanding-items.md`'s POST-MVP templating item).
2. **`display_spi` stays exactly as dumb as it is today**, and the 4-bit-indexed-plus-expand-on-blit
   technique becomes a documented pattern (a `function`-node code snippet in
   `docs/user-guide/nodes/display-spi.md`, or a worked example flow) that a flow author copies and
   adapts, the same way today's byte-swap-for-RGB565 gotcha is already documented rather than fixed
   inside the node. Upside: no node-shape change, no new properties, keeps the "just bytes" contract
   simple. Downside: nothing enforces it -- a new flow author hits the exact same `MemoryError` CYD
   bring-up hit, unless they find and follow the doc.

Per this project's own "don't paint into an architectural dead end" habit, this fork is flagged rather
than picked here -- (1) is more node-authoring-consistent with how `xstart`/`ystart`/the new
colorOrder-family properties just landed (real properties, not documentation), but is a bigger scope
increase for `display_spi` than anything it's taken on so far; (2) is cheap now but leaves every future
large-panel flow exposed to the same failure by default. Needs Mike's call before any of this is built.

## Built, 2026-09-18 -- `gs4` only

`frameFormat: "rgb565" | "gs4"` and a `palette` property (16 RGB565 entries) landed in `display-
spi.ts`, mirrored into `nodes.ts`'s typed defaults and `PropertyPanel.vue`'s form (frame-format
dropdown; palette is flow-file-only for now, no color-picker UI, same gap `colorOrder`/`invertColors`/
`dataLatchOrder` already have). In `"gs4"` mode, expansion happens inside this node's own generated
code via a per-instance `@micropython.viper`-decorated helper, streamed out 2 rows/transaction through
the vendored driver's own `set_window()` + `write(None, ...)` primitives (not `blit_buffer()`, which
assumes RGB565).

**A real correctness bug found and fixed before landing, not just theoretical:** the first draft of
the expansion loop treated the source buffer as a flat sequence of nibbles (n whole bytes in, n*4 bytes
out). That's wrong for an odd-width panel -- GS4_HMSB pads each row to a whole byte (confirmed by
reading MicroPython's own `extmod/modframebuf.c` directly, not assumed), so a flat expansion would
expand the trailing pad nibble on an odd-width row into a phantom extra pixel, shifting every
subsequent pixel out of alignment for the rest of the frame -- exactly the kind of "silently wrong
beats loudly right" failure this project's own fault-handling priority exists to catch. Fixed: the
expansion loop is pixel-count-aware per row (expands exactly `width` real pixels, discards any
trailing pad nibble), not byte-count-aware. Verified end-to-end twice, by hand, against the real
vendored driver + pymock harness before writing the vitest test cases from the same numbers (not
from the codegen's own output, to avoid a test that just re-asserts a bug) -- an odd-width case
(3x2) and a multi-row-batch case (2x3, split across 2 SPI transactions) both match hand-derived
expected bytes exactly. `expectedBytes` for `"gs4"` mode is `Math.ceil(width / 2) * height`, not a
flat `Math.ceil((width * height) / 2)` -- the two agree for CYD's even 240 width and disagree for
TiDAL's odd 135 (68 bytes/row, not 67.5), which is exactly why this was easy to miss testing only
against CYD's panel.

`test-flows/cyd-display-test-pattern.py`'s per-strip RGB565 approach is superseded by `gs4` mode for
any new flow that wants the memory saving, though it isn't removed. No worked example/test flow using
`gs4` exists yet in `test-flows/` -- a real on-device pass (CYD or TiDAL) is still the actual gate,
not this off-device work.

**`@micropython.viper` mechanism spiked off-device, 2026-09-18 -- not yet on this project's own
hardware.** Before committing to the codegen above, a standalone spike (not checked into this repo)
ran `@micropython.viper`-typed gs4/gs2/mono expansion loops against a freshly-built MicroPython
unix-port interpreter: correctness-checked, then timed at 0.25ms/0.23ms/0.38ms per 240x320 frame on
that (x86) dev machine -- confirms the mechanism itself works with no syntax/semantic surprises and
that the loop is very unlikely to be the CPU bottleneck relative to SPI transfer time. This is NOT a
real-hardware result (different CPU entirely, and MicroPython's own SPI driver -- the actual
bottleneck per the corroborating GS4 account above -- isn't exercised by this spike at all). The
2-row expansion granularity and the ~11-color Material palette are also still to be tried on real
hardware. Full method + numbers: `docs/working-notes/learnings/micropython-device-runtime.md`.

## `gs2`/`mono` built and confirmed on real CYD hardware, 2026-09-18 -- same day as gs4's own confirmation

The two remaining depths this doc originally scoped alongside gs4 (`gs2`: `framebuf.GS2_HMSB`, 2bpp,
an eighth of RGB565's memory; `mono`: `framebuf.MONO_HMSB`, 1bpp, a sixteenth) are now built --
`display-spi.ts`/`nodes.ts`/`PropertyPanel.vue`/user-guide doc/tests, same `palette` property shape
as gs4 (always 16 entries, gs2 reads the first 4, mono the first 2).

**A real finding, not just an extension**: gs4's own bit-packing order inside a byte does not
generalize to gs2/mono. Confirmed by reading MicroPython's real `extmod/modframebuf.c` setpixel/
getpixel source for each format directly (not assumed from gs4's already-working loop): `GS4_HMSB`
packs its first (leftmost) pixel of a pair into the HIGH nibble -- descending. `GS2_HMSB` and
`MONO_HMSB` are the opposite -- each format's first pixel occupies the LOWEST bits -- ascending. (Also
found in passing: MicroPython's other 1-bit format, `MONO_HLSB`, is actually the descending one
despite its "LSB" name, matching gs4's order rather than its own `HMSB`-suffixed sibling's --
`MONO_HMSB` was picked for `"mono"` for naming consistency with gs4/gs2, a real judgment call, not
because its bit order matches theirs.) Each new expansion loop was written and independently
hand-verified against its own format's real source, not derived by analogy from gs4's.

Same stride-padding rule as gs4 (round the per-row byte count UP to a whole byte before dividing by
pixels-per-byte -- `Math.ceil(width / N)`, not a flat formula) applied to gs2/mono from the start,
rather than re-discovered per format.

Verified via `tsc --noEmit` (clean, same pre-existing unrelated gap) and `vitest run` (37/37
`node-display-spi.test.ts` -- 6 new gs2 cases, 5 new mono cases, hand-derived from the real bit
formulas above and independently script-verified before being written into the suite, not backed out
of the codegen's own output; 531/540 full suite, remaining 9 failures confirmed pre-existing/
environmental, unrelated). Two new real-hardware test flows written (`test-flows/display-spi-gs2-cyd-
test.flow.json`, `display-spi-mono-cyd-test.flow.json`), and **both confirmed working on real CYD
hardware, 2026-09-18** -- Mike deployed and ran both, correct rendering, no `MemoryError`, no
bit-order corruption. All three indexed depths (`gs4`, `gs2`, `mono`) are now confirmed working on
real silicon, closing this item out end to end. Full incident: `decisions/node-authoring.md`'s
2026-09-18 "gs2/mono frame formats built" entry.
