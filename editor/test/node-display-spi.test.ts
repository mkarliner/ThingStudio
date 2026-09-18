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
});
