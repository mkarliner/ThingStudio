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
// framebuf-rendered RGB565 buffer, built upstream (e.g. a `function` node
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
// A length check against the expected RGB565 buffer size (width * height
// * 2 bytes) runs before every blit -- CLAUDE.md's fault-handling-over-
// happy-path priority: `blit_buffer` itself would just SPI-write whatever
// length it's given (no internal validation), silently desyncing the
// panel's own address window on a wrong-sized buffer rather than failing
// loudly. A clear NODE_ERROR here (design doc §5) is much easier to debug
// than a garbled screen with no error at all.
//
// **Known scaling limit, not solved here (`outstanding-items.md` /
// `docs/working-notes/learnings/hardware-bringup-hil-rig.md`'s 2026-09-18
// entry):** a full-frame RGB565 buffer this node's own upstream `function`
// node builds can `MemoryError` on a classic ESP32 for a large panel (CYD's
// 240x320 = 153600 bytes failed as one contiguous allocation on real
// hardware, even though TiDAL's smaller 135x240 = 64800 bytes never hit
// this) -- worked around in test scripts by building/pushing the frame in
// smaller strips instead of one full-screen buffer. Not yet built into
// this node or its upstream contract. A lower-bit-depth software
// framebuffer (e.g. 4-bit/16-color indexed, expanded to the panel's real
// RGB565 color depth on the fly while streaming out, rather than held
// expanded in RAM) is one candidate shape for a real fix, worth scoping
// separately rather than folding into this property change.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

const CONTROLLERS = ["st7789"] as const;
type Controller = (typeof CONTROLLERS)[number];

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

function requirePin(value: unknown, label: string): number {
  const pin = Math.round(Number(value));
  if (!Number.isFinite(pin) || pin < 0 || pin > 39) {
    throw new CompileError(`display_spi ${label} pin ${String(value)} is out of range (0-39)`);
  }
  return pin;
}

/** -1 (st7789py_mpy's own "not overridden" sentinel convention) means "not wired" -- resolved to a literal `None` at codegen time, never a runtime check. */
function optionalPin(value: unknown, label: string): number | null {
  const raw = Math.round(Number(value ?? -1));
  if (raw === -1) return null;
  if (!Number.isFinite(raw) || raw < 0 || raw > 39) {
    throw new CompileError(`display_spi ${label} pin ${String(value)} is out of range (0-39, or -1 for "not wired")`);
  }
  return raw;
}

/** -1 (st7789py_mpy's own "not overridden" sentinel, same convention as `optionalPin` above but for a GRAM offset, not a pin -- no 0-39 range, just >= -1) means "let st7789py_mpy's own 240x240/135x240 offset table decide," passed through as a literal `-1` at codegen time rather than resolved away, so the vendored driver's own `__init__` logic (not a TypeScript re-implementation of its lookup table) is what actually runs at flow-boot time. */
function optionalOffset(value: unknown, label: string): number {
  const raw = Math.round(Number(value ?? -1));
  if (!Number.isFinite(raw) || raw < -1) {
    throw new CompileError(`display_spi ${label} "${String(value)}" must be a non-negative integer, or -1 to use st7789py_mpy's own built-in offset table`);
  }
  return raw;
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

    const spiBus = Math.round(Number(node.properties.spiBus ?? 2));
    if (!Number.isFinite(spiBus) || spiBus < 0) {
      throw new CompileError(`display_spi spiBus "${String(node.properties.spiBus)}" must be a non-negative integer`);
    }
    const baudrate = Math.round(Number(node.properties.baudrate ?? 40000000));
    if (!Number.isFinite(baudrate) || baudrate <= 0) {
      throw new CompileError(`display_spi baudrate "${String(node.properties.baudrate)}" must be a positive number`);
    }

    const sck = requirePin(node.properties.sck, "sck");
    const mosi = requirePin(node.properties.mosi, "mosi");
    const dc = requirePin(node.properties.dc, "dc");
    const cs = optionalPin(node.properties.cs, "cs");
    const reset = optionalPin(node.properties.reset, "reset");
    const backlight = optionalPin(node.properties.backlight, "backlight");

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

    const csExpr = cs === null ? "None" : `machine.Pin(${cs}, machine.Pin.OUT)`;
    const resetExpr = reset === null ? "None" : `machine.Pin(${reset}, machine.Pin.OUT)`;
    const blExpr = backlight === null ? "None" : `machine.Pin(${backlight}, machine.Pin.OUT)`;

    const expectedBytes = width * height * 2; // RGB565

    return {
      imports: ["import machine", "from st7789py import ST7789, ST7789_MADCTL"],
      statements: [
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
      ],
      functionName: ctx.uniqueName("display_spi_sink"),
      functionBody: [
        `_buf = msg.get('payload', b'')`,
        `if len(_buf) != ${expectedBytes}:`,
        `    raise ValueError('display_spi: expected ${expectedBytes} bytes (${width}x${height} RGB565), got %d' % len(_buf))`,
        `${dispVar}.blit_buffer(_buf, 0, 0, ${width}, ${height})`,
      ].join("\n"),
    };
  },
};
