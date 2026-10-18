// The real MicroPython WASI interpreter running a package <name>.compile.py hook, end to end
// (interfaces/node-compile-context/SPEC.md draft). Loads the vendored artifact, so a failure here means the
// hook path is broken, not just the TypeScript around it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { validateCompileHookResult } from "../src/node-library/compile-hook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));

const context = {
  version: 1,
  node: { id: "n1", type: "custom/wifi", properties: {}, wired: { inputs: [], outputs: [true] } },
  flow: {
    nodes: [
      { id: "n1", type: "custom/wifi", properties: {} },
      { id: "m1", type: "thingstudio/mqtt_publish", properties: {} },
    ],
    configs: [{ id: "w1", type: "thingstudio/config/wifi", properties: { ssid: "net" } }],
  },
  referencedConfigs: { w1: { ssid: "net", password: "pw", security: "password" } },
  target: null,
};

async function run(hookSource: string, properties: Record<string, unknown> = {}): Promise<unknown> {
  return runHookOnce({ wasmBytes, hookSource, context, properties });
}

describe("runHookOnce (MicroPython WASI)", () => {
  it("runs the worked example: derive WiFi and mqtt-defer from the flow", async () => {
    const raw = await run(`
def compile(ctx, properties):
    wifi = None
    for config in ctx['flow']['configs']:
        if config['type'] == 'thingstudio/config/wifi':
            wifi = config['properties']
            break
    if wifi is None:
        return {'errors': ['no WiFi config in this flow']}
    mqtt = any(n['type'].startswith('thingstudio/mqtt_') for n in ctx['flow']['nodes'])
    return {
        'properties': {
            'ssid': wifi.get('ssid', ''),
            'deferToMqtt': mqtt,
        },
        'warnings': ['derived'],
    }
`);
    const result = validateCompileHookResult(raw, "custom/wifi (node n1)");
    expect(result.properties).toEqual({ ssid: "net", deferToMqtt: true });
    expect(result.warnings).toEqual(["derived"]);
  });

  it("receives the node's raw properties", async () => {
    const raw = await run(
      `
def compile(ctx, properties):
    return {'properties': {'doubled': properties['intervalMs'] * 2}}
`,
      { intervalMs: 250 },
    );
    expect(validateCompileHookResult(raw, "x").properties).toEqual({ doubled: 500 });
  });

  it("a hook exception comes back attributed with its type and message", async () => {
    await expect(
      run(`
def compile(ctx, properties):
    raise ValueError("pin 35 is input-only")
`),
    ).rejects.toThrow(/compile hook raised ValueError: pin 35 is input-only/);
  });

  it("noise printed by the hook does not confuse the result marker", async () => {
    const raw = await run(`
def compile(ctx, properties):
    print('diagnostic line')
    return {'properties': {'ok': True}}
`);
    expect(validateCompileHookResult(raw, "x").properties).toEqual({ ok: true });
  });

  it("a malformed return is caught by validation, not by the interpreter", async () => {
    const raw = await run(`
def compile(ctx, properties):
    return [1, 2]
`);
    expect(() => validateCompileHookResult(raw, "custom/x")).toThrow(CompileError);
  });

  it("a syntax error is reported with the interpreter output", async () => {
    await expect(run("def compile(ctx, properties:\n    return {}\n")).rejects.toThrow(/compile hook produced no result|exited/);
  });
});
