// Generic i2c node (editor/src/node-library/i2c-generic.ts). The generated transform runs in real CPython against a
// small fake bus defined here, one message at a time.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { I2C_BUS_CONFIG_TYPE } from "../src/node-library/i2c-shared.js";
import { i2cGenericNode } from "../src/node-library/i2c-generic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUS0 = { id: "bus0", type: I2C_BUS_CONFIG_TYPE, properties: { bus: 0, scl: 5, sda: 4, freq: 100000 } };

function ctx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let c = `_${hint}`;
      let i = 1;
      while (used.has(c)) c = `_${hint}_${i++}`;
      used.add(c);
      return c;
    },
    resolveConfig: (id) => {
      if (id !== "bus0") throw new CompileError(`referenced config "${id}" not found`);
      return BUS0.properties;
    },
    findNodesOfType: () => [],
    findConfigsOfType: () => [BUS0],
  };
}

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "i1", type: "thingstudio/i2c", properties: { i2cConfigId: "bus0", ...properties } };
}

const FAKE_BUS = `
class _FakeBus:
    def __init__(self):
        self.present = True
        self.mem = bytearray(range(256))
        self.log = []
    def _check(self, addr):
        if not self.present or addr != 0x29:
            raise OSError(19)
    def scan(self):
        return [0x29, 0x76] if self.present else []
    def readfrom(self, addr, n):
        self._check(addr)
        return bytes(self.mem[:n])
    def readfrom_mem(self, addr, reg, n):
        self._check(addr)
        return bytes(self.mem[reg:reg + n])
    def writeto(self, addr, buf):
        self._check(addr)
        self.log.append(('writeto', bytes(buf)))
    def writeto_mem(self, addr, reg, buf):
        self._check(addr)
        self.log.append(('writeto_mem', reg, bytes(buf)))
`;

/** Each step: optional Python to run first, then the payload literal sent in. Prints each result. */
function run(properties: Record<string, unknown>, steps: { pre?: string; py: string }[]): string[] {
  const r = i2cGenericNode.codegenTransform!(node(properties), ctx());
  const body = r.functionBody
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
  const feed = steps
    .map((s) => `    ${s.pre ?? "pass"}\n    _out = await ${r.functionName}({'payload': ${s.py}, 'topic': 't'})\n    print('-' if _out is None else repr(_out['payload']))`)
    .join("\n");
  const lines = [
    "import runtime",
    ...(r.imports ?? []),
    ...(r.statements ?? []).map((s) => s.code),
    FAKE_BUS,
    "_i2c_bus_0 = _FakeBus()",
    `async def ${r.functionName}(msg):`,
    body,
    "async def _main():",
    feed,
    "    print('LOG', _i2c_bus_0.log)",
    "runtime.asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-i2c-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], { env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") }, encoding: "utf8" });
  return out
    .trim()
    .split("\n")
    .filter((l) => !l.startsWith("I2C_INIT") && !l.startsWith("PIN_INIT"));
}

describe("thingstudio/i2c node", () => {
  it("reads bytes from a register, or with no register", () => {
    expect(run({ operation: "read", address: "0x29", register: "0x10", length: 3 }, [{ py: "None" }])).toEqual([
      "NODE_STATUS node=i1 state=connected text=None",
      "b'\\x10\\x11\\x12'",
      "LOG []",
    ]);
    expect(run({ operation: "read", address: 41, length: 2 }, [{ py: "None" }])[1]).toBe("b'\\x00\\x01'");
  });

  it("writes bytes, a list, or one int, and passes the message on unchanged", () => {
    const out = run({ operation: "write", address: "0x29", register: "0x80" }, [{ py: "b'\\x03'" }, { py: "[1, 2]" }, { py: "7" }]);
    expect(out.slice(1, 4)).toEqual(["b'\\x03'", "[1, 2]", "7"]);
    expect(out[4]).toBe("LOG [('writeto_mem', 128, b'\\x03'), ('writeto_mem', 128, b'\\x01\\x02'), ('writeto_mem', 128, b'\\x07')]");
    expect(run({ operation: "write", address: "0x29" }, [{ py: "[9]" }]).at(-1)).toBe("LOG [('writeto', b'\\t')]");
  });

  it("an unwritable payload is dropped with an error status, and the node keeps working", () => {
    const out = run({ operation: "write", address: "0x29" }, [{ py: "'hello'" }, { py: "[300]" }, { py: "[1]" }]);
    expect(out).toEqual([
      "NODE_STATUS node=i1 state=error text=i2c write needs bytes, a list of 0-255, or one 0-255, got str",
      "-",
      "NODE_STATUS node=i1 state=error text=i2c write needs values 0-255, got 300",
      "-",
      "NODE_STATUS node=i1 state=connected text=None",
      "[1]",
      "LOG [('writeto', b'\\x01')]",
    ]);
  });

  it("a missing device shows disconnected, sends nothing, and recovers", () => {
    const out = run({ operation: "read", address: "0x29" }, [{ pre: "_i2c_bus_0.present = False", py: "None" }, { py: "None" }, { pre: "_i2c_bus_0.present = True", py: "None" }]);
    expect(out).toEqual([
      "NODE_STATUS node=i1 state=disconnected text=no reply at 0x29 on I2C bus 0",
      "-",
      "-",
      "NODE_STATUS node=i1 state=connected text=None",
      "b'\\x00'",
      "LOG []",
    ]);
  });

  it("scans the bus", () => {
    expect(run({ operation: "scan" }, [{ py: "None" }])[1]).toBe("[41, 118]");
  });

  it("rejects bad properties at compile time", () => {
    expect(() => i2cGenericNode.codegenTransform!(node({ operation: "read", address: "" }), ctx())).toThrow(/7-bit address/);
    expect(() => i2cGenericNode.codegenTransform!(node({ operation: "read", address: "0x80" }), ctx())).toThrow(/7-bit address/);
    expect(() => i2cGenericNode.codegenTransform!(node({ operation: "read", address: "0x29", register: "0x100" }), ctx())).toThrow(/0-255/);
    expect(() => i2cGenericNode.codegenTransform!(node({ operation: "read", address: "0x29", length: 0 }), ctx())).toThrow(/1-256/);
    expect(() => i2cGenericNode.codegenTransform!(node({ operation: "poke" }), ctx())).toThrow(/must be one of/);
    expect(() => i2cGenericNode.codegenTransform!(node({ operation: "scan", i2cConfigId: "" }), ctx())).toThrow(/no I2C bus/);
  });
});
