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
// working one. `rotation` (0-7, st7789py_mpy's own MADCTL encoding) is applied
// by calling the vendored driver's `_set_mem_access_mode()` a second time
// right after `.init()`, deliberately overriding `ST7789.init()`'s own
// hardcoded `_set_mem_access_mode(4, True, True, False)` call -- upstream
// gives no other way to configure rotation (`init()` isn't parameterized
// for it), and reaching into a vendored driver's internals this way
// already has precedent in this project (eswitch.ts's `ESwitch.
// debounce_ms` class-attribute manipulation). UNTESTED on real hardware
// this session (no board available -- see CLAUDE.md's mac-mini-down
// caveat for this session) -- off-device tested only, same "off-device
// first, hardware pass separately, non-negotiable" convention every other
// new hardware node type here follows; flag this specifically as needing
// a real-hardware confirmation pass before relying on non-zero rotation
// values in a real flow.
//
// A length check against the expected RGB565 buffer size (width * height
// * 2 bytes) runs before every blit -- CLAUDE.md's fault-handling-over-
// happy-path priority: `blit_buffer` itself would just SPI-write whatever
// length it's given (no internal validation), silently desyncing the
// panel's own address window on a wrong-sized buffer rather than failing
// loudly. A clear NODE_ERROR here (design doc §5) is much easier to debug
// than a garbled screen with no error at all.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

const CONTROLLERS = ["st7789"] as const;
type Controller = (typeof CONTROLLERS)[number];

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
    const rotation = Math.round(Number(node.properties.rotation ?? 0));
    if (!Number.isFinite(rotation) || rotation < 0 || rotation > 7) {
      throw new CompileError(`display_spi rotation "${String(node.properties.rotation)}" must be an integer 0-7`);
    }

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
      imports: ["import machine", "from st7789py import ST7789"],
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
            `${dispVar}._set_mem_access_mode(${rotation}, False, False, False)`,
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
