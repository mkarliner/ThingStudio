// outstanding-items.md's "[P4] SSD1306 display node" -- display-spi.ts's
// own header has the full design story (SPI color-TFT half of the
// display_spi/display_i2c bus-family split; framebuffer-display-node-
// scoping.md's converged design).
//
// Runs codegenSink's output directly against the REAL vendored driver
// (device-runtime/src/vendor/st7789py_mpy/st7789py.py, unmodified -- see
// that directory's README) through a real CPython asyncio loop, same
// pattern node-display-i2c.test.ts/node-eswitch.test.ts use for their own
// vendored/generated-sink code. PYTHONPATH points at both fixtures/pymock
// (machine.py's new SPI mock, ustruct.py) and the real vendor directory,
// so `from st7789py import ST7789` resolves to the real file.
//
// Needs the time_mock swap node-interrupt.test.ts's runEvents established
// (fixtures/pymock/time_mock.py's own header) -- st7789py.py's
// hard_reset()/soft_reset()/ST7789.init() all call the real
// `time.sleep_ms(...)` (a MicroPython-only stdlib function), which would
// AttributeError against real CPython `time` otherwise. time_mock.py's
// own `sleep_ms` (added alongside this file) advances the test-controlled
// CLOCK rather than actually blocking, so these tests stay fast despite
// the real init sequence's ~970ms of on-device delays.

import { execFileSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { displaySpiNode } from "../src/node-library/display-spi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pymockDir = join(__dirname, "fixtures", "pymock");
// The REAL vendored driver, not a stand-in -- see this file's header.
const vendorDir = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "st7789py_mpy");

let uniqueCounter = 0;
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}_${++uniqueCounter}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- display_spi has no config references`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/display_spi", properties };
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** Runs codegenSink's output once against a payload of exactly `byteLength`
 * zero bytes (bytes(N) -- content doesn't matter for these tests, only
 * length and the resulting write sequence do). Swaps in time_mock for
 * `time` BEFORE the node's own imports run, same ordering node-interrupt.
 * test.ts's runEvents uses and for the same reason (see this file's
 * header) -- `machine` is imported first so its own `_real_time` binds
 * the genuine stdlib module, though no test here actually exercises
 * machine.py's wall-clock SCHEDULE path. */
function runSink(properties: Record<string, unknown>, byteLength: number): string {
  const result = displaySpiNode.codegenSink!(node(properties), ctx);
  // Captures the real generated `..._disp` variable name (ctx.uniqueName-
  // derived, not fixed) straight out of the setup statement text, rather
  // than hardcoding a pattern -- so an extra `print(dispVar.xstart, ...)`
  // line below can read back the REAL vendored ST7789 instance's own
  // resolved `.xstart`/`.ystart` attributes (st7789py_mpy's own
  // 240x240/135x240 offset table, or an explicit override), not a
  // TypeScript-side guess at what the driver would have picked.
  const setupCode = (result.statements ?? []).map((s) => s.code).join("\n");
  const dispVarMatch = setupCode.match(/(\w+_disp) = ST7789\(/);
  if (!dispVarMatch) throw new Error("couldn't find the generated ST7789(...) assignment to read .xstart/.ystart back from");
  const dispVar = dispVarMatch[1];
  const lines = [
    "import time",
    "import sys",
    "import machine",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    "import runtime",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    `print("OFFSETS", ${dispVar}.xstart, ${dispVar}.ystart)`,
    // The three writes right after .init() are, in order: inversion_mode()'s
    // own single command byte, then ST7789_MADCTL's command byte, then its data
    // byte -- see display-spi.ts's header for why these are written directly
    // rather than through _set_mem_access_mode().
    `print("LAST_WRITES", " ".join(w.hex() for w in ${dispVar}.spi.writes[-3:]))`,
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    `msg = {'payload': bytes(${byteLength}), 'topic': ''}`,
    `asyncio.run(${result.functionName}(msg))`,
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: `${pymockDir}${delimiter}${vendorDir}` },
    encoding: "utf8",
    timeout: 10_000,
  });
}

/** Same real-driver/real-pymock harness as runSink, but for `frameFormat: "gs4"`:
 * runs the sink once against a specific hex-encoded gs4 payload and returns every
 * SPI write issued DURING that one sink call (not init-time writes, unlike
 * runSink's OFFSETS/LAST_WRITES which capture only init). `ptr8 = ptr16 = ptr32
 * = int` is TEST-HARNESS-ONLY scaffolding (matching time_mock's own pattern) --
 * codegen itself never imports or defines those names; see fixtures/pymock/
 * micropython.py's own `viper` stub header for why real MicroPython doesn't need
 * this but plain CPython does. */
function runGs4(properties: Record<string, unknown>, payloadHex: string): string {
  const result = displaySpiNode.codegenSink!(node({ ...properties, frameFormat: "gs4" }), ctx);
  const setupCode = (result.statements ?? []).map((s) => s.code).join("\n");
  const dispVarMatch = setupCode.match(/(\w+_disp) = ST7789\(/);
  if (!dispVarMatch) throw new Error("couldn't find the generated ST7789(...) assignment");
  const dispVar = dispVarMatch[1];
  const lines = [
    "import time",
    "import sys",
    "import machine",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    "import runtime",
    "asyncio = runtime.asyncio",
    "ptr8 = ptr16 = ptr32 = int",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
    "",
    `async def ${result.functionName}(msg):`,
    indent(result.functionBody, 4),
    "",
    `_before = len(${dispVar}.spi.writes)`,
    `msg = {'payload': bytes.fromhex('${payloadHex}'), 'topic': ''}`,
    `asyncio.run(${result.functionName}(msg))`,
    `print("PAYLOAD_WRITES", " ".join(w.hex() for w in ${dispVar}.spi.writes[_before:]))`,
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-nodetest-gs4-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: `${pymockDir}${delimiter}${vendorDir}` },
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("thingstudio/display_spi node", () => {
  it("constructs the SPI bus/pins and ST7789, and blits a correctly-sized RGB565 buffer", () => {
    // width=4, height=4 -> expected bytes = 4 * 4 * 2 = 32
    const output = runSink({ spiBus: 2, baudrate: 40000000, sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, 32);
    expect(output).toContain("SPI_INIT bus=2 baudrate=40000000 sck=12 mosi=11");
    expect(output).toContain("PIN_INIT 13 OUT pull=None"); // dc pin
    // blit_buffer's own write(None, buffer) call -> one SPI_WRITE of the full buffer
    expect(output).toContain("SPI_WRITE 32 bytes");
  });

  it("leaves cs/reset/backlight unconstructed (None) when left at the -1 'not wired' sentinel", () => {
    const output = runSink({ sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, 32);
    // Exactly 3 PIN_INIT lines: sck/mosi (wrapped in machine.Pin(...) by the SPI() call itself)
    // and dc -- cs/reset/backlight all resolve to a literal None at codegen time, never a
    // machine.Pin(...) construction, so no PIN_INIT for any of those three.
    const pinInitCount = (output.match(/PIN_INIT/g) ?? []).length;
    expect(pinInitCount).toBe(3);
  });

  it("wires cs/reset/backlight as real pins and turns the backlight on when configured", () => {
    const output = runSink({ sck: 12, mosi: 11, dc: 13, cs: 10, reset: 14, backlight: 9, width: 4, height: 4, xstart: 0, ystart: 0 }, 32);
    expect(output).toContain("PIN_INIT 10 OUT pull=None"); // cs
    expect(output).toContain("PIN_INIT 14 OUT pull=None"); // reset
    expect(output).toContain("PIN_INIT 9 OUT pull=None"); // backlight
    expect(output).toContain("PIN_VALUE 9 1"); // backlight turned on after init
  });

  it("defaults controller/spiBus/baudrate/width/height/rotation when not configured", () => {
    // defaults: width 135, height 240 -> expected bytes = 135 * 240 * 2 = 64800
    const output = runSink({ sck: 12, mosi: 11, dc: 13 }, 64800);
    expect(output).toContain("SPI_INIT bus=2 baudrate=40000000 sck=12 mosi=11");
  });

  it("raises a clear ValueError on a wrong-length payload instead of desyncing the panel silently", () => {
    expect.assertions(1);
    try {
      runSink({ sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, 31);
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? "");
      expect(stderr).toContain("display_spi: expected 32 bytes (4x4 RGB565), got 31");
    }
  });

  it("rejects an out-of-range required pin (sck/mosi/dc)", () => {
    expect(() => displaySpiNode.codegenSink!(node({ sck: 99, mosi: 11, dc: 13 }), ctx)).toThrow(CompileError);
    expect(() => displaySpiNode.codegenSink!(node({ sck: 99, mosi: 11, dc: 13 }), ctx)).toThrow(/out of range/);
  });

  it("rejects an out-of-range optional pin (cs/reset/backlight) that isn't the -1 sentinel", () => {
    expect(() => displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, cs: 99 }), ctx)).toThrow(/not wired/);
  });

  it("rejects an unknown controller", () => {
    expect(() => displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, controller: "ili9341" }), ctx)).toThrow(/must be one of/);
  });

  it("rejects a rotation outside 0-7", () => {
    expect(() => displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, rotation: 8 }), ctx)).toThrow(/0-7/);
  });

  // Self-correction, 2026-09-17 (display-spi.ts's own header comment has
  // the full story): xstart/ystart used to be hardcoded to 0/0 always,
  // silently wrong for TiDAL's real 135x240 panel (needs 52/40) -- caught
  // on real hardware, not by this test suite, which is exactly why these
  // four cases exist now: off-device coverage that would have caught it.
  it("defaults xstart/ystart to -1, letting st7789py_mpy's own table resolve TiDAL's real 135x240 offset (52, 40)", () => {
    const output = runSink({ sck: 12, mosi: 11, dc: 13, width: 135, height: 240 }, 135 * 240 * 2);
    expect(output).toContain("OFFSETS 52 40");
  });

  it("defaults xstart/ystart to -1, resolving a 240x240 panel's offset to (0, 0) via the same table", () => {
    const output = runSink({ sck: 12, mosi: 11, dc: 13, width: 240, height: 240 }, 240 * 240 * 2);
    expect(output).toContain("OFFSETS 0 0");
  });

  it("honors an explicit xstart/ystart override instead of the built-in table", () => {
    const output = runSink({ sck: 12, mosi: 11, dc: 13, width: 135, height: 240, xstart: 1, ystart: 2 }, 135 * 240 * 2);
    expect(output).toContain("OFFSETS 1 2");
  });

  it("propagates the vendored driver's own ValueError for an unsupported resolution with no explicit offset, instead of silently defaulting to (0, 0)", () => {
    expect.assertions(1);
    try {
      runSink({ sck: 12, mosi: 11, dc: 13, width: 100, height: 100 }, 100 * 100 * 2);
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? "");
      expect(stderr).toContain("Unsupported display");
    }
  });

  it("declares a single bytes 'frame' input port (sink kind, no outputs)", () => {
    expect(displaySpiNode.ports?.inputs).toEqual([{ name: "frame", type: "bytes" }]);
    expect(displaySpiNode.ports?.outputs).toBeUndefined();
  });

  // 2026-09-18, real CYD (ESP32-2432S028) hardware bring-up --
  // display-spi.ts's own header and docs/working-notes/decisions/
  // node-authoring.md's 2026-09-18 entry have the full story. These
  // four cases exist for the same reason the xstart/ystart cases above
  // do: off-device coverage for exactly the real-hardware finding that
  // prompted the property, not a re-derivation of the finding itself.
  describe("colorOrder / invertColors / dataLatchOrder / rotation (MADCTL)", () => {
    it("defaults to CYD's confirmed real-hardware config: colorOrder=bgr, invertColors=false, dataLatchOrder=true, rotation=1", () => {
      const output = runSink({ sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, 32);
      // inversion_mode(False) -> INVOFF (0x20); MADCTL command (0x36);
      // data byte 0x4C = BGR (0x08) | MH (0x04) | MX (0x40, rotation=1).
      expect(output).toContain("LAST_WRITES 20 36 4c");
    });

    it("honors an explicit colorOrder=rgb/invertColors=true/dataLatchOrder=false/rotation=0 override, reproducing TiDAL's own pre-2026-09-18 confirmed-working MADCTL/inversion bytes", () => {
      const output = runSink(
        { sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0, colorOrder: "rgb", invertColors: true, dataLatchOrder: false, rotation: 0 },
        32,
      );
      // inversion_mode(True) -> INVON (0x21); MADCTL command (0x36);
      // data byte 0x00 (no BGR, no MH, rotation=0 -> no MY/MX/MV either)
      // -- the exact byte the old _set_mem_access_mode(0, False, False,
      // False)-based codegen produced for TiDAL before this property
      // change, confirmed by re-deriving it here rather than assumed.
      expect(output).toContain("LAST_WRITES 21 36 00");
    });

    it("computes MX|MH|BGR (0x4c) explicitly the same way the default does, so the default isn't the only path that reaches CYD's byte", () => {
      const output = runSink(
        { sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0, colorOrder: "bgr", invertColors: false, dataLatchOrder: true, rotation: 1 },
        32,
      );
      expect(output).toContain("LAST_WRITES 20 36 4c");
    });

    it("rejects an unknown colorOrder", () => {
      expect(() => displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, colorOrder: "cmyk" }), ctx)).toThrow(/must be "rgb" or "bgr"/);
    });
  });

  // 2026-09-18, display-spi-framebuffer-format-decision.md / decisions/
  // node-authoring.md's 2026-09-18 entries: frameFormat "gs4" landed as
  // the first reduced-depth format (gs2/mono decided, not yet built).
  // These tests exist for the same reason the xstart/ystart/MADCTL cases
  // above do -- off-device coverage for a real correctness subtlety this
  // file's own header documents, not a re-derivation of it: GS4_HMSB's
  // per-row byte stride is rounded up to a whole number of bytes, which
  // differs from a flat width*height/2 buffer size on an ODD width (like
  // TiDAL's real 135) even though it happens to match on an EVEN width
  // (like CYD's real 240) -- exactly the kind of thing that passes if you
  // only ever test the even-width case.
  describe("frameFormat gs4", () => {
    it("defaults frameFormat to rgb565 (unchanged behavior) when not set", () => {
      const output = runSink({ sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, 32);
      expect(output).toContain("SPI_WRITE 32 bytes");
    });

    it("rejects an unknown frameFormat", () => {
      expect(() => displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, frameFormat: "gs8" }), ctx)).toThrow(/must be one of/);
    });

    it("accepts the correct byte count for an EVEN width, where a flat w*h/2 formula happens to also be right", () => {
      // width=4 (even) -> stride 2 bytes/row * height 4 = 8 bytes, the
      // same number a naive flat ceil(w*h/2) would also give here -- the
      // even-width case where the two formulas happen to agree (unlike
      // the odd-width case below, where they don't).
      const output = runGs4({ sck: 12, mosi: 11, dc: 13, width: 4, height: 4, xstart: 0, ystart: 0 }, "00".repeat(8));
      const writes = output.match(/PAYLOAD_WRITES (.+)/)?.[1]?.trim().split(" ") ?? [];
      // 5 set_window writes + 2 data writes (4 rows / 2 rows-per-batch = 2 batches).
      expect(writes.length).toBe(7);
    });

    it("rejects a wrong-length gs4 payload with a clear error naming the real (row-padded) byte count", () => {
      expect.assertions(1);
      try {
        runGs4({ sck: 12, mosi: 11, dc: 13, width: 3, height: 2, xstart: 0, ystart: 0 }, "00".repeat(3));
      } catch (err) {
        const stderr = String((err as { stderr?: string }).stderr ?? "");
        // width=3 (odd) -> stride ceil(3/2)=2 bytes/row * height 2 = 4 bytes,
        // NOT a flat ceil(3*2/2)=3 -- this is the exact number that would be
        // wrong if expectedBytes used the naive flat formula.
        expect(stderr).toContain("display_spi: expected 4 bytes (3x2 gs4/4bpp, 2 bytes/row), got 3");
      }
    });

    it("expands an odd-width (3x2) gs4 frame to the correct per-pixel RGB565 bytes, discarding the per-row pad nibble", () => {
      // Real end-to-end check (hand-derived and independently verified
      // against the real vendored driver + pymock harness before this
      // test was written, not just asserted on faith):
      // row0 byte 0x01 -> pixels (black=0x0000, white=0xffff); row0 byte
      // 0x2F -> pixel 2 = palette[2] red=0xf800 (low nibble 0xF is the
      // pad, must be ignored); row1 byte 0x34 -> pixels (green=0x07e0,
      // blue=0x001f); row1 byte 0x5F -> pixel 2 = palette[5] yellow=0xffe0
      // (low nibble again padding). Both rows land in ONE batch (height=2,
      // GS4_ROWS_PER_BATCH=2), so this is a single 12-byte SPI write.
      const output = runGs4({ sck: 12, mosi: 11, dc: 13, width: 3, height: 2, xstart: 0, ystart: 0 }, "012f345f");
      expect(output).toContain("PAYLOAD_WRITES");
      const writes = output.match(/PAYLOAD_WRITES (.+)/)?.[1]?.trim().split(" ") ?? [];
      // 5 set_window writes (CASET cmd+data, RASET cmd+data, RAMWR cmd) + 1 data write.
      expect(writes.length).toBe(6);
      expect(writes[writes.length - 1]).toBe("0000fffff80007e0001fffe0");
    });

    it("splits a taller gs4 frame into multiple row-batches (2 rows/transaction)", () => {
      // height=3, GS4_ROWS_PER_BATCH=2 -> batches of 2 rows then 1 row,
      // i.e. two separate write(None, ...) data calls, not one.
      // width=2 (even) -> stride 1 byte/row, 1 pixel-pair/row.
      // row0 0x01->(black,white), row1 0x23->(red,green), row2 0x45->(blue,yellow).
      const output = runGs4({ sck: 12, mosi: 11, dc: 13, width: 2, height: 3, xstart: 0, ystart: 0 }, "012345");
      const writes = output.match(/PAYLOAD_WRITES (.+)/)?.[1]?.trim().split(" ") ?? [];
      // 5 set_window writes + 2 data writes (batch of 2 rows, then 1 row) --
      // verified independently against the real driver before this test was
      // written (rows 0-1 packed into one write, row 2 into a second).
      expect(writes.length).toBe(7);
      expect(writes[5]).toBe("0000fffff80007e0");
      expect(writes[6]).toBe("001fffe0");
    });

    it("rejects a palette that isn't exactly 16 entries", () => {
      expect(() => displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, frameFormat: "gs4", palette: [0, 1, 2] }), ctx)).toThrow(
        /exactly 16 RGB565 values/,
      );
    });

    it("rejects a palette entry out of RGB565 range", () => {
      expect(() =>
        displaySpiNode.codegenSink!(node({ sck: 12, mosi: 11, dc: 13, frameFormat: "gs4", palette: new Array(16).fill(0x10000) }), ctx),
      ).toThrow(/palette\[0\]/);
    });

    it("honors a custom palette instead of the default", () => {
      const customPalette = new Array(16).fill(0);
      customPalette[0] = 0x1234;
      customPalette[1] = 0x5678;
      // width=2, height=1 -> one byte, hi=0 -> palette[0], lo=1 -> palette[1].
      const output = runGs4({ sck: 12, mosi: 11, dc: 13, width: 2, height: 1, xstart: 0, ystart: 0, palette: customPalette }, "01");
      const writes = output.match(/PAYLOAD_WRITES (.+)/)?.[1]?.trim().split(" ") ?? [];
      expect(writes[writes.length - 1]).toBe("12345678");
    });
  });
});
