// outstanding-items.md's "[P4] SSD1306 display node" -- display-i2c.ts's
// own header has the full design story (I2C mono/OLED half of the
// display_spi/display_i2c bus-family split; framebuffer-display-node-
// scoping.md's converged design).
//
// Runs codegenSink's output directly against the REAL vendored driver
// (device-runtime/src/vendor/ssd1306/ssd1306.py, unmodified -- see that
// directory's README) through a real CPython asyncio loop, same pattern
// node-udp-send.test.ts/node-eswitch.test.ts use for their own vendored/
// generated-sink code: this exercises the actual generated setup code +
// the actual SSD1306_I2C class, not a hand-rolled stand-in for either.
// PYTHONPATH points at both fixtures/pymock (machine.py's new I2C mock,
// framebuf.py, micropython.py) and the real vendor directory, so
// `from ssd1306 import SSD1306_I2C` resolves to the real file.
//
// No time_mock swap needed here (unlike node-display-spi.test.ts) --
// SSD1306_I2C's own init/show path never calls time.sleep_ms (only
// SSD1306_SPI's reset() does, out of scope for this node).

import { execFileSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { displayI2cNode } from "../src/node-library/display-i2c.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pymockDir = join(__dirname, "fixtures", "pymock");
// The REAL vendored driver, not a stand-in -- see this file's header.
const vendorDir = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "ssd1306");

let uniqueCounter = 0;
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}_${++uniqueCounter}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- display_i2c has no config references`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/display_i2c", properties };
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
 * length and the resulting write sequence do). */
function runSink(properties: Record<string, unknown>, byteLength: number): string {
  const result = displayI2cNode.codegenSink!(node(properties), ctx);
  const lines = [
    "import runtime",
    "asyncio = runtime.asyncio",
    ...(result.imports ?? []),
    ...(result.statements ?? []).map((s) => s.code),
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
  });
}

describe("thingstudio/display_i2c node", () => {
  it("constructs the I2C bus and SSD1306_I2C, and pushes a correctly-sized MONO_VLSB buffer", () => {
    // width=16, height=8 -> expected bytes = 16 * (8/8) = 16
    const output = runSink({ i2cBus: 0, freq: 400000, scl: 22, sda: 21, addr: 0x3c, width: 16, height: 8 }, 16);
    expect(output).toContain("I2C_INIT bus=0 scl=22 sda=21 freq=400000");
    // show() ends with exactly one write_data -> one I2C_WRITEVTO call. 17 bytes on the wire, not
    // 16 -- SSD1306_I2C.write_data() prepends its own 1-byte "Co=0, D/C#=1" control byte
    // (write_list[0] = b"\x40") ahead of the actual 16-byte buffer, real I2C protocol shape, not a bug.
    expect(output).toContain("I2C_WRITEVTO addr=60 17 bytes");
  });

  it("defaults controller/i2cBus/freq/addr/width/height when not configured", () => {
    // defaults: addr 0x3c (60), width 128, height 64 -> expected bytes = 128 * 8 = 1024
    const output = runSink({ scl: 22, sda: 21 }, 1024);
    expect(output).toContain("I2C_INIT bus=0 scl=22 sda=21 freq=400000");
    // 1025 on the wire (1024-byte buffer + the same 1-byte control prefix noted above).
    expect(output).toContain("I2C_WRITEVTO addr=60 1025 bytes");
  });

  it("raises a clear ValueError on a wrong-length payload instead of silently resizing the buffer", () => {
    expect.assertions(1);
    try {
      runSink({ scl: 22, sda: 21, width: 16, height: 8 }, 15);
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? "");
      expect(stderr).toContain("display_i2c: expected 16 bytes (16x8 MONO_VLSB), got 15");
    }
  });

  it("rejects an out-of-range scl/sda pin", () => {
    expect(() => displayI2cNode.codegenSink!(node({ scl: 99, sda: 21 }), ctx)).toThrow(CompileError);
    expect(() => displayI2cNode.codegenSink!(node({ scl: 99, sda: 21 }), ctx)).toThrow(/out of range/);
  });

  it("rejects an unknown controller", () => {
    expect(() => displayI2cNode.codegenSink!(node({ scl: 22, sda: 21, controller: "sh1106" }), ctx)).toThrow(/must be one of/);
  });

  it("rejects an out-of-range I2C address", () => {
    expect(() => displayI2cNode.codegenSink!(node({ scl: 22, sda: 21, addr: 200 }), ctx)).toThrow(/7-bit I2C address/);
  });

  it("rejects a height that isn't a multiple of 8 (MONO_VLSB pages)", () => {
    expect(() => displayI2cNode.codegenSink!(node({ scl: 22, sda: 21, height: 10 }), ctx)).toThrow(/multiple of 8/);
  });

  it("declares a single bytes 'frame' input port (sink kind, no outputs)", () => {
    expect(displayI2cNode.ports?.inputs).toEqual([{ name: "frame", type: "bytes" }]);
    expect(displayI2cNode.ports?.outputs).toBeUndefined();
  });
});
