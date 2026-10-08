// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/display-spi.ts
//
// framebuffer-display-node-scoping.md's converged design (Mike's steer,
// 2026-09-17): "generic" means the framebuffer wire contract, not one
// universal display node -- hardware specifics differ enough per display
// that separate node types are the right call, held to the two bus
// families (SPI/I2C) rather than one node per exact chip where the
// per-bus property shape is close enough to share. This is the SPI half:
// SPI color TFTs (ST7789 today; ILI9341/ILI9342/GC9A01 etc. are real
// future candidates, same ST77xx-adjacent shape -- see this node's
// `controller` property).
//
// Sink kind, one input -- same "push an already-rendered frame to
// hardware, on every message" shape as the original framebuffer-st7789-
// display-briefing.md's proposed node, matching gpio_out/pwm_out's own
// minimal-sink precedent. No drawing primitives here on purpose -- that's
// exactly the deferred POST-MVP "templating UI nodes for displays" item
// (outstanding-items.md); msg.payload is expected to already be a
// framebuf-rendered buffer, built upstream (e.g. a `function` node
// using `framebuf.FrameBuffer` directly, or eventually an LVGL-style
// graphics-framework node -- framebuffer-display-node-scoping.md's own
// forward-looking note on why a future partial-rect input contract might
// be needed there, deliberately NOT built here, v1 stays full-frame-only).
//
// Vendored driver: device-runtime/src/vendor/st7789py_mpy/ (devbis/
// st7789py_mpy, MIT, no local patches needed -- see that directory's own
// README.md for the full provenance/hash story). Chosen over russhughes/
// st7789_mpy specifically because that one needs a custom-compiled
// MicroPython firmware build, a hard incompatibility with this project's
// stock-MicroPython + `mpremote cp` deployment model -- same reasoning
// the original briefing already worked through.
//
// `controller` is a real property (not hardcoded away) even though only
// "st7789" is wired up this session -- deliberately leaves room for
// ILI9341/ILI9342/GC9A01/etc. later without a breaking property-shape
// change, cheap to keep open now per CLAUDE.md's "don't paint into an
// architectural dead end" principle. Each additional controller is its
// own small vendored file, never merged into one "display" blob -- see
// outstanding-items.md's vendor-file-growth tracking item for why this
// matters: `test-flows/deploy_runtime.py`'s VENDOR_FILES push is
// unconditional (every file in it lands on every board on every
// bootstrap, not scoped per-flow), so an unbounded number of controller
// drivers there would cost every board flash space regardless of whether
// that board has a display at all. Tracked, not solved here -- see that
// item for the real fix (a selective/opt-in vendor push).
//
// Pins/bus id are node properties, not defaults baked into the node type
// -- framebuffer-display-node-scoping.md's own hardware survey found the
// SPI pin assignments genuinely differ board to board (TiDAL: CS=10,
// CLK=12, DIN=11, RESET=14, DC=13, SPI bus 2; M5StickC Plus vs Plus2:
// same MOSI/SCK but different DC/RST; the "Cheap Yellow Display" family:
// RST tied high with no GPIO at all) -- no default here would be right
// for more than one board.
//
// `cs`/`reset`/`backlight` are optional pins, sentinel -1 for "not wired"
// (matching st7789py_mpy's own `xstart=-1, ystart=-1` "no override"
// convention, not a Thingstudio-specific choice) -- resolved at CODEGEN
// time into a literal `machine.Pin(...)` expression or a literal `None`,
// not a runtime conditional in generated Python (same "branch in
// TypeScript, not in the generated code" style eswitch.ts's `pullArg`
// already uses for its own optional pull-config string).
//
// `xstart`/`ystart` are real node properties now, default -1 (st7789py_mpy's
// own "not overridden, use the built-in 240x240/135x240 offset table"
// sentinel -- same convention `cs`/`reset`/`backlight` already use for
// "not wired," reused here for "not overridden" instead).
//
// **Self-correction, 2026-09-17, found on real TiDAL hardware, not
// reasoned into place:** this used to hardcode `xstart=0, ystart=0`
// unconditionally, deliberately bypassing st7789py_mpy's own offset
// table -- reasoned at the time as "the common case for a panel with no
// offset," covering an arbitrary-resolution panel that the vendored
// table doesn't know about. That reasoning missed that TiDAL's own panel
// -- 135x240, this project's one actual piece of display hardware, and
// the vendor README's own "explicitly supports... 135x240 panels (the
// TiDAL badge's own panel)" selling point for choosing this driver in
// the first place -- needs `xstart=52, ystart=40`, not `0, 0`. Hardcoding
// 0/0 silently fed every 135x240 blit the wrong GRAM window: content
// landed clipped/offset and the visible glass showed whatever stale
// pixels already sat in the uncovered part of GRAM (looks exactly like
// "random bytes," because it more or less is) -- with no error at all,
// the same "silently wrong beats loudly right" failure mode this file's
// own length-check comment below already argues against. Mike's own
// `display-spi-tidal-test.flow.json` first real-hardware deploy caught
// this live (`test-flows/README.md` has the full story). Fixed by
// exposing `xstart`/`ystart` as real properties defaulting to -1 -- the
// default now lets st7789py_mpy's own table do the right thing for
// TiDAL's 135x240 (and 240x240) automatically, and an arbitrary-
// resolution panel that isn't in that table gets a clear `ValueError`
// from the vendored driver's own `__init__` at flow-boot time instead of
// a silent wrong offset -- a real error to debug, not a coincidentally-
// working one.
//
// **Second self-correction, 2026-09-18, found bringing up a real CYD
// (ESP32-2432S028) board -- see `docs/working-notes/decisions/
// node-authoring.md`'s 2026-09-18 entry for the full real-hardware story.**
// `rotation` alone (calling the vendored driver's `_set_mem_access_mode()`
// a second time after `.init()`, overriding its own hardcoded
// `_set_mem_access_mode(4, True, True, False)` call) was never enough: two
// more real per-panel differences surfaced getting CYD's screen to render
// correctly, and CYD needed a MADCTL bit (`MH`, Display Data Latch Order)
// that `_set_mem_access_mode()`'s own rotation table never exercises at
// all (it only ever combines `MY`/`MX`/`MV` -- confirmed by reading the
// vendored driver directly). Colors were also wrong (BGR channel order,
// and `ST7789.init()`'s own hardcoded `inversion_mode(True)`, both tuned
// for TiDAL's specific panel). Fixed by adding three more real properties
// -- `colorOrder` ("rgb"/"bgr"), `invertColors` (bool), `dataLatchOrder`
// (bool, the MH bit) -- and, since no combination of `_set_mem_access_
// mode()`'s own vert_mirror/horz_mirror/rotation arguments can express
// "rotation bits AND the MH bit at once" (its own if/elif logic is
// mutually exclusive between them), codegen now computes the full MADCTL
// byte itself (in TypeScript, from `rotation`/`dataLatchOrder`/
// `colorOrder` together) and writes it directly via
// `display.write(ST7789_MADCTL, ...)`, bypassing `_set_mem_access_mode()`
// entirely rather than trying to coax three interacting properties through
// a helper that can't actually express their combination. Same "reaching
// into a vendored driver's internals has precedent" reasoning the old
// `_set_mem_access_mode()`-after-`init()` call already established
// (eswitch.ts's `ESwitch.debounce_ms` class-attribute manipulation is the
// original precedent) -- this just reaches one level deeper (the MADCTL
// register directly) because the driver's own convenience wrapper turned
// out not to cover a real, confirmed-needed case.
//
// **Defaults changed to CYD's confirmed real-hardware values, 2026-09-18,
// Mike's explicit call** (`colorOrder: "bgr"`, `invertColors: false`,
// `dataLatchOrder: true`, `rotation: 1` -- previously `rotation` defaulted
// to `0`) -- CYD, not TiDAL, is now the node type's own default target.
// TiDAL's own already-confirmed-working flow (`test-flows/display-spi-
// tidal-test.flow.json`) is pinned with its own explicit `colorOrder:
// "rgb"`, `invertColors: true`, `dataLatchOrder: false`, `rotation: 0` so
// this default change doesn't silently break what's already verified on
// real hardware -- same "properties, not defaults baked into the node
// type" convention `xstart`/`ystart` already established above: a real
// flow targeting real hardware pins its own real values explicitly,
// defaults are a starting point for a new flow being authored, not a
// promise that any given board matches them.
//
// **Still scoped to one confirmed CYD unit, not a general "pick your
// panel" UI.** A POST-MVP outstanding item (`outstanding-items.md`)
// tracks a future preset dropdown (named, known-good combinations of
// these properties -- "TiDAL badge," "CYD 2-USB," etc. -- alongside the
// still-available roll-your-own raw properties) once more real panels
// have been confirmed this way; not built now, four raw properties is
// the whole of today's UI for this.
//
// A length check against the expected buffer size (format-dependent, see
// `frameFormat` below) runs before every blit -- CLAUDE.md's fault-
// handling-over-happy-path priority: `blit_buffer`/`write` themselves
// would just SPI-write whatever length they're given (no internal
// validation), silently desyncing the panel's own address window on a
// wrong-sized buffer rather than failing loudly. A clear NODE_ERROR here
// (design doc §5) is much easier to debug than a garbled screen with no
// error at all.
//
// **Framebuffer-memory fix landed, 2026-09-18 (`outstanding-items/display-
// spi-framebuffer-memory.md`, `decisions/node-authoring.md`'s 2026-09-18
// entries).** A full-frame RGB565 buffer this node's own upstream
// `function` node builds could previously `MemoryError` on a classic
// ESP32 for a large panel (CYD's 240x320 = 153600 bytes failed as one
// contiguous allocation on real hardware, even though TiDAL's smaller
// 135x240 = 64800 bytes never hit this -- `learnings/hardware-bringup-
// hil-rig.md`'s 2026-09-18 entry). Now avoidable via a new `frameFormat`
// property: `"rgb565"` (default, today's existing behavior, unchanged),
// `"gs4"` (MicroPython's own `framebuf.GS4_HMSB`, 4 bits/pixel, a
// quarter the RGB565 memory footprint), `"gs2"` (`framebuf.GS2_HMSB`,
// 2 bits/pixel, an eighth), or `"mono"` (`framebuf.MONO_HMSB`, 1 bit/
// pixel, a sixteenth). In any non-`"rgb565"` mode, `msg.payload` is a
// palette-indexed buffer (built upstream via `framebuf.FrameBuffer(...,
// framebuf.<FORMAT>)`, pixel values as palette indices, not literal
// color) instead of a full RGB565 buffer. A `palette` property (always
// exactly 16 RGB565 entries -- `DEFAULT_PALETTE_GS4` below is a
// placeholder pending Mike's own values, see that const's own comment)
// maps each index to a real color: `gs4` reads all 16 entries (4-bit
// indices), `gs2` reads only the first 4 (2-bit indices), `mono` reads
// only the first 2 (1-bit indices) -- one property, one consistent
// codegen path, across all three depths.
//
// Expansion happens inside this node's own generated code, not the
// vendored driver: a `@micropython.viper`-decorated per-instance helper
// (typed `ptr8`/`ptr16` params) unpacks packed indices to real RGB565
// bytes two rows at a time -- pixel-count-aware, not a flat byte count,
// so an odd-width row's trailing pad bits (see the correctness subtlety
// below) are discarded rather than expanded into phantom extra pixels
// that would shift every subsequent pixel out of alignment -- streamed
// out via the vendored driver's own `set_window()` + `write(None, ...)`
// primitives -- the same two calls
// `blit_buffer()` itself makes internally, just split apart so several
// smaller writes can share one open address window (confirmed by reading
// `st7789py.py` directly: `write()` toggles `cs_low()`/`cs_high()` around
// every call, so each row-batch is its own complete, correctly-framed SPI
// transaction, not a half-open window between calls). This granularity
// (2 rows/transaction, `INDEXED_ROWS_PER_BATCH` below, shared by all
// three indexed formats -- it only bounds the OUTPUT scratch buffer size,
// which is always RGB565 regardless of source depth) matches the
// corroborating real-world GS4 driver account's own proven shape
// (`outstanding-items/display-spi-framebuffer-memory.md`'s "External
// corroboration" section), which hit <100ms/frame at 240x320 this way.
// The `@micropython.viper` mechanism itself was spiked off-device against
// a real MicroPython unix-port build before `gs4` landed -- works, ~42x
// over plain Python for the same loop shape on an x86 dev machine
// (`learnings/micropython-device-runtime.md`'s 2026-09-18 entry) -- and
// has since been confirmed on real Xtensa/ESP32 hardware too, for `gs4`
// specifically (`decisions/node-authoring.md`'s 2026-09-18 entries); real
// per-frame timing on real hardware is still unmeasured for any format,
// gs4 included.
//
// **Real correctness subtlety, found reading MicroPython's own
// `extmod/modframebuf.c` directly rather than assuming flat packing:**
// every one of these formats rounds its per-row byte stride UP to a
// whole byte before dividing by the format's pixels-per-byte -- `(width
// + (ppb - 1)) & ~(ppb - 1)` in the real C source, `ppb` pixels per byte
// (2 for gs4, 4 for gs2, 8 for mono) -- so `Math.ceil(width / ppb)` is
// the right per-row byte count, not a flat `Math.ceil((width * height) /
// ppb)`. For an EVEN-enough width (CYD's 240, divisible by all three
// `ppb` values) this happens to agree with the flat formula, but for an
// odd or non-multiple width (TiDAL's 135: not a multiple of 4 or 8
// either) it doesn't -- this is exactly the bug `gs4`'s own first draft
// hit and fixed (see `decisions/node-authoring.md`), generalized here to
// `gs2`/`mono` from the start rather than re-discovered per format.
//
// **A second, more subtle correctness fact, found the same way (reading
// `gs4_hmsb_setpixel`/`gs2_hmsb_setpixel`/`mono_horiz_setpixel` in
// `extmod/modframebuf.c` directly) and NOT assumed to generalize from
// `gs4`:** the three formats pack pixels into a byte in OPPOSITE bit
// orders from each other. `GS4_HMSB`'s first (leftmost) pixel of a pair
// occupies the HIGH nibble, its second pixel the LOW nibble --
// descending, high-to-low. `GS2_HMSB` and `MONO_HMSB` are the other way
// around: each format's first (leftmost) pixel of its group occupies the
// LOWEST bits, its last pixel the HIGHEST -- ascending, low-to-high.
// (MicroPython also has `MONO_HLSB`, confusingly the one whose bit order
// -- high-to-low -- matches `GS4_HMSB`'s rather than its own `HMSB`-
// suffixed sibling's; picked `MONO_HMSB` for `"mono"` specifically for
// naming consistency with `GS4_HMSB`/`GS2_HMSB` above, a real judgment
// call flagged to Mike, not because its bit order matches theirs -- it
// doesn't.) Each expansion loop below was written and hand-verified
// against its own format's real setpixel/getpixel source, not derived by
// analogy from `gs4`'s already-working loop -- the bit-order difference
// is exactly the kind of thing an analogy would get wrong silently.

import { CompileError } from "../compiler/errors.js";
import { checkOptionalPin, checkPin, checkSpi } from "../definitions/pin-check.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

const CONTROLLERS = ["st7789"] as const;
type Controller = (typeof CONTROLLERS)[number];

const FRAME_FORMATS = ["rgb565", "gs4", "gs2", "mono"] as const;
type FrameFormat = (typeof FRAME_FORMATS)[number];
type IndexedFrameFormat = Exclude<FrameFormat, "rgb565">;

// framebuf format name + pixels-per-byte for each indexed format --
// `PIXELS_PER_BYTE` alone drives `strideBytes`/`expectedBytes` below
// (`Math.ceil(width / ppb) * height`, this file's header has the real-
// source citation for why it's ceil-per-row, not a flat formula).
// `FRAMEBUF_ATTR` is purely documentation here (the actual upstream
// `framebuf.GS4_HMSB`/etc. constant a flow author's own `function` node
// needs to build the source buffer with -- this node never imports
// `framebuf` itself, it only consumes already-packed bytes).
const PIXELS_PER_BYTE: Record<IndexedFrameFormat, number> = { gs4: 2, gs2: 4, mono: 8 };
const FRAMEBUF_ATTR: Record<IndexedFrameFormat, string> = { gs4: "GS4_HMSB", gs2: "GS2_HMSB", mono: "MONO_HMSB" };
const BITS_PER_PIXEL: Record<IndexedFrameFormat, number> = { gs4: 4, gs2: 2, mono: 1 };
// How many palette entries each depth actually reads out of the shared
// 16-entry `palette` property (`requirePalette` below always requires
// all 16 regardless of format -- one property, one shape, across every
// depth, per this file's header) -- also how many entries actually get
// baked into the generated `array.array('H', ...)` literal: no point
// carrying 14 unread halfwords in RAM for a `mono` node that only ever
// indexes `pal[0]`/`pal[1]`.
export const PALETTE_ENTRIES_USED: Record<IndexedFrameFormat, number> = { gs4: 16, gs2: 4, mono: 2 };

// How many expanded rows go out per SPI transaction in any indexed
// ("gs4"/"gs2"/"mono") mode -- matches the corroborating GS4 driver
// account's own proven granularity (outstanding-items/display-spi-
// framebuffer-memory.md's "External corroboration" section), not an
// arbitrary choice. Named generically (not `GS4_...`) since it only
// bounds the OUTPUT scratch buffer, which is always RGB565 regardless of
// source depth -- shared unchanged across all three formats.
const INDEXED_ROWS_PER_BATCH = 2;

// **Diagnostic flag, 2026-09-18 -- reverted to false, real viper.** Added
// when a first real gs4 deploy boot-looped (SW_CPU_RESET) on a CYD, to
// isolate whether @micropython.viper's native codegen was the cause --
// neither the off-device spike (x86 native code, not Xtensa) nor the
// vitest/pymock suite (viper stubbed to a no-op decorator, never real
// native codegen) had ever exercised real compiled Xtensa machine code
// before this. Setting this true for a redeploy proved the crash was
// NOT viper -- the flow only fires on a manual inject click, so the
// crash (happening on every boot with nothing clicked) had to be in the
// unconditional SETUP code, and was root-caused separately to a 40MHz
// SPI baudrate this CYD's specific pins can't sustain (`decisions/
// node-authoring.md`'s 2026-09-18 entries have the full incident). Once
// that was fixed and a plain-Python gs4 render was confirmed correct on
// real hardware, this flipped back to false to get the actual first-ever
// real validation of @micropython.viper on Xtensa -- since confirmed
// working, including under sustained continuous redraw (same 2026-09-18
// entries). Kept as a named constant (not deleted) in case a future
// board/driver-interaction regression ever needs this same isolation
// technique again -- flip to true, redeploy, compare; it costs nothing
// to leave in place. Applies uniformly to whichever indexed format's
// expand function this node generates (gs4/gs2/mono alike), not just gs4
// -- the isolation trick is format-agnostic.
const DIAGNOSTIC_PLAIN_PYTHON = false;

// A placeholder starting palette -- NOT the exact ~11-color Material-
// Design-inspired set the corroborating GS4 driver account describes
// (outstanding-items/display-spi-framebuffer-memory.md); that source's
// exact swatch hex values were never captured in this repo, only its
// existence and color count. This is a hand-verified, clean-bit-math
// 16-entry RGB565 palette instead (pure/mixed primaries, a 4-step gray
// ramp, plus a few darker accents) -- flagged for Mike to swap for the
// real reference values, or his own, rather than silently treated as
// authoritative. Any flow can override this via its own `palette`
// property regardless. Shared across gs4/gs2/mono -- gs2 reads indices
// 0-3 (black/white/red/green here), mono reads indices 0-1 (black/
// white) -- a flow wanting different low-depth colors overrides
// `palette` directly, same as gs4 already can.
export const DEFAULT_PALETTE_GS4: readonly number[] = [
  0x0000, // 0  black        (0, 0, 0)
  0xffff, // 1  white        (255, 255, 255)
  0xf800, // 2  red          (248, 0, 0)
  0x07e0, // 3  green        (0, 252, 0)
  0x001f, // 4  blue         (0, 0, 248)
  0xffe0, // 5  yellow       red | green
  0x07ff, // 6  cyan         green | blue
  0xf81f, // 7  magenta      red | blue
  0x8410, // 8  gray 50%     (128, 128, 128)
  0x4208, // 9  gray 25%     (64, 64, 64)
  0xc618, // 10 gray 75%     (192, 192, 192)
  0xfd20, // 11 orange       (255, 165, 0)
  0x8000, // 12 dark red     (128, 0, 0)
  0x0400, // 13 dark green   (0, 128, 0)
  0x0010, // 14 dark blue    (0, 0, 128)
  0x0410, // 15 dark cyan    (0, 128, 128)
];

// MADCTL bits (st7789py_mpy's own constants, mirrored here in TypeScript
// -- rotation/colorOrder/dataLatchOrder are all compile-time properties,
// not runtime data, so the whole MADCTL byte is computed once here rather
// than at runtime, same "branch in TypeScript, not generated code" style
// eswitch.ts's pullArg already uses).
const MADCTL_MY = 0x80;
const MADCTL_MX = 0x40;
const MADCTL_MV = 0x20;
const MADCTL_BGR = 0x08;
const MADCTL_MH = 0x04;

// st7789py_mpy's own `_set_mem_access_mode()` rotation table (MY/MX/MV
// combinations only -- it never exercises MH, see this file's header for
// why that matters). Reproduced here rather than called at codegen time
// because this node now writes MADCTL directly instead of going through
// that helper (see header).
const ROTATION_BITS: Record<number, number> = {
  0: 0,
  1: MADCTL_MX,
  2: MADCTL_MY,
  3: MADCTL_MX | MADCTL_MY,
  4: MADCTL_MV,
  5: MADCTL_MV | MADCTL_MX,
  6: MADCTL_MV | MADCTL_MY,
  7: MADCTL_MV | MADCTL_MX | MADCTL_MY,
};

/** -1 (st7789py_mpy's own "not overridden" sentinel, same convention as the optional pins but for a GRAM offset, not a pin -- no pin range, just >= -1) means "let st7789py_mpy's own 240x240/135x240 offset table decide," passed through as a literal `-1` at codegen time rather than resolved away, so the vendored driver's own `__init__` logic (not a TypeScript re-implementation of its lookup table) is what actually runs at flow-boot time. */
function optionalOffset(value: unknown, label: string): number {
  const raw = Math.round(Number(value ?? -1));
  if (!Number.isFinite(raw) || raw < -1) {
    throw new CompileError(`display_spi ${label} "${String(value)}" must be a non-negative integer, or -1 to use st7789py_mpy's own built-in offset table`);
  }
  return raw;
}

/** Exactly 16 raw RGB565 values (0-65535), same "compile-time property, not a runtime object" convention as everything else in this file -- edited in the property panel via PaletteField.vue (2026-09-24, the last display_spi property to get a form field). Always 16 regardless of format (gs4/gs2/mono all read from the same shape, just a different prefix of it -- this file's header). */
function requirePalette(value: unknown): number[] {
  if (value === undefined) return [...DEFAULT_PALETTE_GS4];
  if (!Array.isArray(value) || value.length !== 16) {
    throw new CompileError(`display_spi palette must be an array of exactly 16 RGB565 values (0-65535)`);
  }
  return value.map((entry, i) => {
    const n = Math.round(Number(entry));
    if (!Number.isFinite(n) || n < 0 || n > 0xffff) {
      throw new CompileError(`display_spi palette[${i}] "${String(entry)}" must be an integer 0-65535 (a raw RGB565 value)`);
    }
    return n;
  });
}

/**
 * Builds the body (as an array of source lines, decorator line excluded --
 * the caller prepends `@micropython.viper` unless `DIAGNOSTIC_PLAIN_PYTHON`)
 * of the per-format expansion function: `def NAME(src, off, stride, dst,
 * width, rows, pal)`, unpacking `rows` rows of packed indices starting at
 * source byte offset `off` (row stride `stride` bytes) into `dst` as
 * RGB565 bytes, `width` real pixels per row (pixel-count-aware, not a
 * flat byte count -- discards any trailing pad bits in the source rather
 * than expanding them, see this file's header). Each format's bit-
 * unpacking logic is hand-written and independently verified against its
 * own real MicroPython C source (this file's header's second
 * correctness-subtlety note) -- deliberately NOT derived from `gs4`'s by
 * analogy or by a shared "generic N-bit unpack" abstraction, since the
 * three formats' bit orders actually differ from each other (gs4
 * descending, gs2/mono ascending) and a clever unified formula is exactly
 * the kind of thing that would get that silently wrong.
 */
function expandFunctionBody(format: IndexedFrameFormat): string[] {
  if (format === "gs4") {
    // 2 px/byte, DESCENDING bit order (confirmed against the real
    // `gs4_hmsb_setpixel`/`getpixel` in `extmod/modframebuf.c`): the
    // first (even-x) pixel of a pair is the HIGH nibble, the second
    // (odd-x) pixel the LOW nibble. Unrolled by hand (not a `for k in
    // range(2)` loop) -- this is the original, already real-hardware-
    // confirmed gs4 loop (`decisions/node-authoring.md`'s 2026-09-18
    // entries), left exactly as shipped rather than rewritten to match
    // gs2/mono's newer loop-based style below, so nothing proven working
    // on real Xtensa hardware is disturbed for the sake of uniformity.
    return [
      `    full = width >> 1`,
      `    odd = width & 1`,
      `    row_dst_bytes = width * 2`,
      `    for r in range(rows):`,
      `        s = off + r * stride`,
      `        d = r * row_dst_bytes`,
      `        for i in range(full):`,
      `            b = int(src[s + i])`,
      `            hi = b >> 4`,
      `            lo = b & 0x0F`,
      `            c0 = int(pal[hi])`,
      `            c1 = int(pal[lo])`,
      `            j = d + i * 4`,
      `            dst[j] = c0 >> 8`,
      `            dst[j + 1] = c0 & 0xFF`,
      `            dst[j + 2] = c1 >> 8`,
      `            dst[j + 3] = c1 & 0xFF`,
      `        if odd:`,
      `            b = int(src[s + full])`,
      `            hi = b >> 4`,
      `            c0 = int(pal[hi])`,
      `            j = d + full * 4`,
      `            dst[j] = c0 >> 8`,
      `            dst[j + 1] = c0 & 0xFF`,
    ];
  }
  if (format === "gs2") {
    // 4 px/byte, ASCENDING bit order (confirmed against the real
    // `gs2_hmsb_setpixel`/`getpixel`: `shift = (x & 0x3) << 1`) -- pixel
    // 0 of each group of 4 occupies bits 0-1 (lowest), pixel 3 occupies
    // bits 6-7 (highest). A small `for k in range(4)` inner loop, not
    // hand-unrolled like gs4 -- new code, favoring clarity/correctness
    // over the marginal native-code saving a manual unroll might buy;
    // viper compiles fixed-bound loops to native code, so this is not
    // expected to be the bottleneck (same reasoning gs4's own header
    // already makes about the loop vs. SPI transfer time), but real
    // per-frame timing on hardware is still unmeasured either way.
    return [
      `    full = width >> 2`,
      `    rem = width & 3`,
      `    row_dst_bytes = width * 2`,
      `    for r in range(rows):`,
      `        s = off + r * stride`,
      `        d = r * row_dst_bytes`,
      `        for i in range(full):`,
      `            b = int(src[s + i])`,
      `            j = d + i * 8`,
      `            for k in range(4):`,
      `                c = int(pal[(b >> (k * 2)) & 0x3])`,
      `                dst[j + k * 2] = c >> 8`,
      `                dst[j + k * 2 + 1] = c & 0xFF`,
      `        if rem:`,
      `            b = int(src[s + full])`,
      `            j = d + full * 8`,
      `            for k in range(rem):`,
      `                c = int(pal[(b >> (k * 2)) & 0x3])`,
      `                dst[j + k * 2] = c >> 8`,
      `                dst[j + k * 2 + 1] = c & 0xFF`,
    ];
  }
  // format === "mono": 8 px/byte, ASCENDING bit order -- MicroPython's
  // MONO_HMSB (`mono_horiz_setpixel`/`getpixel` with `fb->format ==
  // FRAMEBUF_MHMSB`: `offset = x & 0x07`), NOT the other mono format
  // MicroPython also has, MONO_HLSB (`offset = 7 - (x & 0x07)`, actually
  // the DESCENDING one despite its "LSB" name -- confirmed directly from
  // source, not assumed from either name; the two names don't describe
  // what "MSB"/"LSB" might suggest at a glance). `MONO_HMSB` picked for
  // `"mono"` specifically for naming consistency with `GS4_HMSB`/
  // `GS2_HMSB` above (this file's header) -- pixel 0 of each group of 8
  // occupies bit 0 (lowest), pixel 7 occupies bit 7 (highest).
  return [
    `    full = width >> 3`,
    `    rem = width & 7`,
    `    row_dst_bytes = width * 2`,
    `    for r in range(rows):`,
    `        s = off + r * stride`,
    `        d = r * row_dst_bytes`,
    `        for i in range(full):`,
    `            b = int(src[s + i])`,
    `            j = d + i * 16`,
    `            for k in range(8):`,
    `                c = int(pal[(b >> k) & 0x1])`,
    `                dst[j + k * 2] = c >> 8`,
    `                dst[j + k * 2 + 1] = c & 0xFF`,
    `        if rem:`,
    `            b = int(src[s + full])`,
    `            j = d + full * 16`,
    `            for k in range(rem):`,
    `                c = int(pal[(b >> k) & 0x1])`,
    `                dst[j + k * 2] = c >> 8`,
    `                dst[j + k * 2 + 1] = c & 0xFF`,
  ];
}

function indent4(line: string): string {
  return `    ${line}`;
}

export const displaySpiNode: NodeDefinition = {
  type: "thingstudio/display_spi",
  kind: "sink",
  ports: {
    inputs: [{ name: "frame", type: "bytes" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const controller = String(node.properties.controller ?? "st7789") as Controller;
    if (!CONTROLLERS.includes(controller)) {
      throw new CompileError(`display_spi controller "${String(node.properties.controller)}" must be one of: ${CONTROLLERS.join(", ")}`);
    }

    const frameFormat = String(node.properties.frameFormat ?? "rgb565") as FrameFormat;
    if (!FRAME_FORMATS.includes(frameFormat)) {
      throw new CompileError(`display_spi frameFormat "${String(node.properties.frameFormat)}" must be one of: ${FRAME_FORMATS.join(", ")}`);
    }
    const isIndexed = frameFormat !== "rgb565";
    const palette = isIndexed ? requirePalette(node.properties.palette) : null;

    const spiBus = Math.round(Number(node.properties.spiBus ?? 2));
    if (!Number.isFinite(spiBus) || spiBus < 0) {
      throw new CompileError(`display_spi spiBus "${String(node.properties.spiBus)}" must be a non-negative integer`);
    }
    const baudrate = Math.round(Number(node.properties.baudrate ?? 40000000));
    if (!Number.isFinite(baudrate) || baudrate <= 0) {
      throw new CompileError(`display_spi baudrate "${String(node.properties.baudrate)}" must be a positive number`);
    }

    const sck = checkPin(ctx, "display_spi sck pin", node.properties.sck, "output");
    const mosi = checkPin(ctx, "display_spi mosi pin", node.properties.mosi, "output");
    const dc = checkPin(ctx, "display_spi dc pin", node.properties.dc, "output");
    const cs = checkOptionalPin(ctx, "display_spi cs pin", node.properties.cs, "output");
    const reset = checkOptionalPin(ctx, "display_spi reset pin", node.properties.reset, "output");
    const backlight = checkOptionalPin(ctx, "display_spi backlight pin", node.properties.backlight, "output");
    checkSpi(ctx, "display_spi", spiBus, { sck, mosi }, baudrate);

    const width = Math.round(Number(node.properties.width ?? 135));
    const height = Math.round(Number(node.properties.height ?? 240));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new CompileError(`display_spi width/height "${String(node.properties.width)}x${String(node.properties.height)}" must be positive integers`);
    }

    // Default 1 (CYD's confirmed real-hardware config -- see this file's
    // header) -- was 0 before 2026-09-18. TiDAL's own flow pins 0
    // explicitly, unaffected by this default change.
    const rotation = Math.round(Number(node.properties.rotation ?? 1));
    if (!Number.isFinite(rotation) || rotation < 0 || rotation > 7) {
      throw new CompileError(`display_spi rotation "${String(node.properties.rotation)}" must be an integer 0-7`);
    }

    const colorOrder = String(node.properties.colorOrder ?? "bgr");
    if (colorOrder !== "rgb" && colorOrder !== "bgr") {
      throw new CompileError(`display_spi colorOrder "${colorOrder}" must be "rgb" or "bgr"`);
    }
    const bgr = colorOrder === "bgr";

    // Real booleans, not sentinel-encoded -- unlike the pin/offset
    // properties above, "not set" and "explicitly false" aren't
    // distinguishable needs here, so a plain default is enough.
    const invertColors = node.properties.invertColors === undefined ? false : Boolean(node.properties.invertColors);
    const dataLatchOrder = node.properties.dataLatchOrder === undefined ? true : Boolean(node.properties.dataLatchOrder);

    // rotation is already range-checked to 0-7 above, so this lookup always
    // hits -- the non-null assertion is for TypeScript's indexed-access typing,
    // not a runtime possibility.
    const madctl = ROTATION_BITS[rotation]! | (dataLatchOrder ? MADCTL_MH : 0) | (bgr ? MADCTL_BGR : 0);

    const xstart = optionalOffset(node.properties.xstart, "xstart");
    const ystart = optionalOffset(node.properties.ystart, "ystart");

    const base = ctx.uniqueName("display_spi");
    const spiVar = `${base}_spi`;
    const csVar = `${base}_cs`;
    const dcVar = `${base}_dc`;
    const resetVar = `${base}_reset`;
    const blVar = `${base}_bl`;
    const dispVar = `${base}_disp`;
    const palVar = `${base}_pal`;
    const expandVar = `${base}_expand`;
    const scratchVar = `${base}_scratch`;

    const csExpr = cs === null ? "None" : `machine.Pin(${cs}, machine.Pin.OUT)`;
    const resetExpr = reset === null ? "None" : `machine.Pin(${reset}, machine.Pin.OUT)`;
    const blExpr = backlight === null ? "None" : `machine.Pin(${backlight}, machine.Pin.OUT)`;

    // Every indexed format pads its per-row byte stride UP to a whole
    // byte -- Math.ceil(width / pixelsPerByte) is that padded per-row
    // byte count, NOT Math.ceil((width * height) / pixelsPerByte) -- see
    // this file's header for why the difference matters on a width
    // that's not a multiple of the format's pixels-per-byte (TiDAL's 135
    // isn't a multiple of 2, 4, or 8).
    const strideBytes = isIndexed ? Math.ceil(width / PIXELS_PER_BYTE[frameFormat as IndexedFrameFormat]) : null;
    const expectedBytes = isIndexed ? strideBytes! * height : width * height * 2; // RGB565

    const imports = ["import machine", "from st7789py import ST7789, ST7789_MADCTL"];
    if (isIndexed) {
      imports.push("import array");
      if (!DIAGNOSTIC_PLAIN_PYTHON) imports.push("import micropython");
    }

    const statements: SinkCodegenResult["statements"] = [
      {
        key: base,
        code: [
          `${spiVar} = machine.SPI(${spiBus}, baudrate=${baudrate}, polarity=0, phase=0, sck=machine.Pin(${sck}), mosi=machine.Pin(${mosi}))`,
          `${csVar} = ${csExpr}`,
          `${dcVar} = machine.Pin(${dc}, machine.Pin.OUT)`,
          `${resetVar} = ${resetExpr}`,
          `${blVar} = ${blExpr}`,
          `${dispVar} = ST7789(${spiVar}, ${width}, ${height}, ${resetVar}, ${dcVar}, cs=${csVar}, backlight=${blVar}, xstart=${xstart}, ystart=${ystart})`,
          `${dispVar}.init()`,
          // Overrides ST7789.init()'s own hardcoded inversion_mode(True)
          // and _set_mem_access_mode(4, True, True, False) calls -- see
          // this file's header for why MADCTL is written directly rather
          // than through _set_mem_access_mode() a second time.
          `${dispVar}.inversion_mode(${invertColors ? "True" : "False"})`,
          `${dispVar}.write(ST7789_MADCTL, bytes([${madctl}]))`,
          `if ${blVar} is not None:`,
          `    ${blVar}.value(1)`,
        ].join("\n"),
      },
    ];

    if (isIndexed) {
      const format = frameFormat as IndexedFrameFormat;
      const paletteLiteral = palette!
        .slice(0, PALETTE_ENTRIES_USED[format])
        .map((v) => `0x${v.toString(16).padStart(4, "0")}`)
        .join(", ");
      const scratchBytes = width * 2 * INDEXED_ROWS_PER_BATCH; // real pixels only, no row-padding in the OUTPUT
      statements.push({
        key: `${base}_${format}`,
        // The palette + expansion helper are per-instance, matching every
        // other setup block in this file (no shared/deduped codegen
        // infrastructure exists to reuse one across multiple display_spi
        // nodes in the same flow) -- cheap in flash for the realistic
        // case of one or a few display_spi nodes per flow, per
        // CLAUDE.md's "cheapest correct implementation" default.
        //
        // Pixel-count-aware, not a flat byte count -- see this file's
        // header and `expandFunctionBody()`'s own per-format comments for
        // exactly how each format's bit-unpacking works and why it's
        // independently hand-verified per format, not shared/derived by
        // analogy.
        code: [
          `${palVar} = array.array('H', [${paletteLiteral}])`,
          ``,
          // @micropython.viper, typed ptr8/ptr16 params -- spiked off-
          // device first (this file's header, learnings/micropython-
          // device-runtime.md's 2026-09-18 entry), since confirmed on
          // real Xtensa/ESP32 hardware for gs4 (decisions/node-
          // authoring.md's 2026-09-18 entries) -- gs2/mono share the same
          // mechanism and the same real-hardware confidence, though
          // neither has its own real-hardware deploy yet (this file's
          // header).
          //
          // DIAGNOSTIC_PLAIN_PYTHON (see that const's own comment,
          // TEMPORARY): when true, the decorator and ptr8/ptr16/int type
          // annotations are omitted -- real MicroPython evaluates
          // annotations as plain expressions at def time when there's no
          // @micropython.viper/@micropython.native decorator to special-
          // case them, and ptr8/ptr16 aren't real names outside that
          // context, so they have to be stripped entirely, not just the
          // decorator line -- everything else below is byte-for-byte
          // identical either way.
          ...(DIAGNOSTIC_PLAIN_PYTHON ? [] : [`@micropython.viper`]),
          DIAGNOSTIC_PLAIN_PYTHON
            ? `def ${expandVar}(src, off, stride, dst, width, rows, pal):`
            : `def ${expandVar}(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):`,
          ...expandFunctionBody(format),
          ``,
          // Reused across batches (not reallocated per message/per batch)
          // -- same "small scratch buffer, not a full expanded frame"
          // shape the corroborating GS4 driver account used.
          `${scratchVar} = bytearray(${scratchBytes})`,
        ].join("\n"),
      });
    }

    const lengthCheck = isIndexed
      ? `    raise ValueError('display_spi: expected ${expectedBytes} bytes (${width}x${height} ${frameFormat}/framebuf.${FRAMEBUF_ATTR[frameFormat as IndexedFrameFormat]}, ${BITS_PER_PIXEL[frameFormat as IndexedFrameFormat]}bpp, ${strideBytes} bytes/row), got %d' % len(_buf))`
      : `    raise ValueError('display_spi: expected ${expectedBytes} bytes (${width}x${height} RGB565), got %d' % len(_buf))`;

    // A whole frame, or (2026-10-08, the GUI's banded screens) a strip of whole rows with `msg['y']` its first
    // row: a GUI screen never holds a full frame in RAM, so it sends strips. No `y`: a full frame, as before.
    const rowBytes = isIndexed ? strideBytes! : width * 2;
    const frameOrStrip = [
      `_buf = msg.get('payload', b'')`,
      `_y0 = msg.get('y')`,
      `if _y0 is None:`,
      `    if len(_buf) != ${expectedBytes}:`,
      indent4(lengthCheck),
      `    _y0 = 0`,
      `    _rows = ${height}`,
      `else:`,
      `    _rows = len(_buf) // ${rowBytes}`,
      `    if _rows < 1 or len(_buf) != _rows * ${rowBytes} or _y0 < 0 or _y0 + _rows > ${height}:`,
      `        raise ValueError('display_spi: a strip must be whole rows of ${rowBytes} bytes inside the ${height}-row screen, got %d bytes at row %r' % (len(_buf), _y0))`,
    ];
    const functionBody = isIndexed
      ? [
          ...frameOrStrip,
          // set_window once, then several write(None, ...) calls --
          // the same two primitives blit_buffer() itself calls, just
          // split apart. st7789py.py's own write() toggles cs_low()/
          // cs_high() around every call (confirmed by reading it
          // directly, this file's header), so each batch below is its
          // own complete, correctly-framed SPI transaction.
          `${dispVar}.set_window(0, _y0, ${width - 1}, _y0 + _rows - 1)`,
          `_row = 0`,
          `while _row < _rows:`,
          `    _n = ${INDEXED_ROWS_PER_BATCH} if (_rows - _row) >= ${INDEXED_ROWS_PER_BATCH} else (_rows - _row)`,
          `    ${expandVar}(_buf, _row * ${strideBytes}, ${strideBytes}, ${scratchVar}, ${width}, _n, ${palVar})`,
          `    _cnt = ${width} * 2 * _n`,
          `    ${dispVar}.write(None, memoryview(${scratchVar})[:_cnt])`,
          `    _row += _n`,
        ].join("\n")
      : [...frameOrStrip, `${dispVar}.blit_buffer(_buf, 0, _y0, ${width}, _rows)`].join("\n");

    return {
      imports,
      statements,
      functionName: ctx.uniqueName("display_spi_sink"),
      functionBody,
    };
  },
};
