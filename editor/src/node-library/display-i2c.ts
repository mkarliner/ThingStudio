// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/display-i2c.ts
//
// framebuffer-display-node-scoping.md's converged design -- the I2C half
// of the two-node-family display split (display-spi.ts's own header has
// the full design story, not repeated here). I2C mono/OLED panels
// (SSD1306 today; SH1106 etc. are real future candidates, close enough
// in shape -- bus id, address, width, height -- to likely share this same
// node via its `controller` property, same bet display-spi.ts makes for
// the ST77xx-family SPI chips).
//
// Sink kind, one input, same "push an already-rendered frame, no drawing
// primitives" shape as display-spi.ts. msg.payload is expected to already
// be a framebuf-rendered MONO_VLSB buffer (framebuf.FrameBuffer's own
// format, width * (height // 8) bytes) built upstream -- SSD1306 itself
// *is* a framebuf.FrameBuffer subclass (device-runtime/src/vendor/
// ssd1306/README.md), so this is the same framebuffer-as-universal-in-
// RAM-surface convention display-spi.ts uses, just a different concrete
// format.
//
// Vendored driver: device-runtime/src/vendor/ssd1306/ (micropython/
// micropython-lib's own SSD1306 driver, MIT, no local patches needed --
// see that directory's README.md for the full provenance/hash story,
// including a shallow-clone-gave-a-wrong-commit-SHA catch worth reading
// before trusting a similar shortcut in a future vendoring session).
// Only `SSD1306_I2C` is wired up here -- the driver also has an
// `SSD1306_SPI` variant (a real, supported wiring), deliberately out of
// scope for this node (I2C-bus-only by design, matching the two-node-
// family split); an SSD1306 wired over SPI would need `display_spi` to
// grow this controller into its own picklist later, not this node.
//
// `controller` is a real property even though only "ssd1306" is wired up
// this session, same "leave room, don't paint into a dead end" reasoning
// as display-spi.ts's own `controller` property.
//
// Pins/bus id/address are node properties, not defaults -- an I2C-wired
// display's SCL/SDA/address genuinely vary board to board the same way
// display-spi.ts's SPI pins do; no default here would be right for more
// than one board either.
//
// A length check against the expected MONO_VLSB buffer size (width *
// (height // 8) bytes) runs before every push, same CLAUDE.md fault-
// handling-over-happy-path reasoning as display-spi.ts's own check --
// `self.buffer[:] = _buf` is a bytearray full-slice replace, which would
// silently RESIZE the underlying buffer on a wrong-length input (Python
// slice-assignment semantics), corrupting `self.pages`/`self.width`-based
// indexing on the very next `.show()` call rather than failing loudly at
// the point the bad data actually arrived -- exactly the kind of
// quiet-wrong-answer case this project's fault-handling priority exists
// to catch before it does, not after.

import { CompileError } from "../compiler/errors.js";
import { i2cBusFromPins, resolveI2cBus } from "./i2c-shared.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, SinkCodegenResult } from "../compiler/node-definition.js";

const CONTROLLERS = ["ssd1306"] as const;
type Controller = (typeof CONTROLLERS)[number];

export const displayI2cNode: NodeDefinition = {
  type: "thingstudio/display_i2c",
  kind: "sink",
  ports: {
    inputs: [{ name: "frame", type: "bytes" }],
  },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const controller = String(node.properties.controller ?? "ssd1306") as Controller;
    if (!CONTROLLERS.includes(controller)) {
      throw new CompileError(`display_i2c controller "${String(node.properties.controller)}" must be one of: ${CONTROLLERS.join(", ")}`);
    }

    // The bus comes from a shared I2C bus config (i2c-shared.ts, 2026-09-26). A flow saved before that has
    // i2cBus/scl/sda/freq on the node itself; those still compile, onto the same shared bus object. The editor
    // moves them into a config when it loads the flow (flow-file's migrateI2cBusConfigs).
    const bus =
      typeof node.properties.i2cConfigId === "string" && node.properties.i2cConfigId !== ""
        ? resolveI2cBus(ctx, "display_i2c", node.properties.i2cConfigId)
        : node.properties.scl !== undefined || node.properties.sda !== undefined
          ? i2cBusFromPins(ctx, {
              bus: node.properties.i2cBus ?? 0,
              scl: node.properties.scl,
              sda: node.properties.sda,
              freq: node.properties.freq ?? 400000,
            })
          : resolveI2cBus(ctx, "display_i2c", node.properties.i2cConfigId);

    const addr = Math.round(Number(node.properties.addr ?? 0x3c));
    if (!Number.isFinite(addr) || addr < 0 || addr > 0x7f) {
      throw new CompileError(`display_i2c addr "${String(node.properties.addr)}" must be a 7-bit I2C address (0-127)`);
    }

    const width = Math.round(Number(node.properties.width ?? 128));
    const height = Math.round(Number(node.properties.height ?? 64));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || height % 8 !== 0) {
      throw new CompileError(`display_i2c width/height "${String(node.properties.width)}x${String(node.properties.height)}" must be positive integers, height a multiple of 8 (MONO_VLSB pages)`);
    }

    const base = ctx.uniqueName("display_i2c");
    const dispVar = `${base}_disp`;

    const expectedBytes = width * (height / 8); // MONO_VLSB

    return {
      imports: ["import machine", "from ssd1306 import SSD1306_I2C"],
      statements: [bus.statement, { key: base, code: `${dispVar} = SSD1306_I2C(${width}, ${height}, ${bus.varName}, addr=${addr})` }],
      functionName: ctx.uniqueName("display_i2c_sink"),
      functionBody: [
        `_buf = msg.get('payload', b'')`,
        `if len(_buf) != ${expectedBytes}:`,
        `    raise ValueError('display_i2c: expected ${expectedBytes} bytes (${width}x${height} MONO_VLSB), got %d' % len(_buf))`,
        `${dispVar}.buffer[:] = _buf`,
        `${dispVar}.show()`,
      ].join("\n"),
    };
  },
};
