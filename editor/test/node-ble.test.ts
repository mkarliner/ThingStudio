// The BLE phase 1 packages, ble_scan and ble_advertise (editor/src/node-library/core-packages/ble-*.ts), through the
// whole compile the editor runs (checkFlowText: hooks, the board's capabilities, codegen), then the generated
// MicroPython run in CPython against pymock's bluetooth/runtime and the real ts_ble library. A source loops forever,
// so the flow's own runtime.spawn line is replaced by a few iterations driven from the test.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFlowText } from "../src/cli/check-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const C5 = "board:esp32-c5-340x";

type N = { id: string; type: string; properties: Record<string, unknown> };
function flow(nodes: N[], edges: [string, number, string, number][] = []): string {
  return JSON.stringify({ formatVersion: 1, flowName: "t", nodes, edges, layout: {}, configs: [] });
}
const scan = (id: string, properties: Record<string, unknown> = {}): N => ({ id, type: "thingstudio/ble_scan", properties });
const adv = (id: string, properties: Record<string, unknown> = {}): N => ({ id, type: "thingstudio/ble_advertise", properties });
const debug: N = { id: "d", type: "thingstudio/debug", properties: { fullMessage: true } };

function errorsOf(nodes: N[], board = C5, edges: [string, number, string, number][] = []): string[] {
  return checkFlowText(flow(nodes, edges), { board }).errors.map((e) => e.message);
}

/** Compiles, drops the spawn line, and runs `driver` (Python) after the flow's setup. Returns stdout. */
function runFlow(nodes: N[], edges: [string, number, string, number][], driver: string): string {
  const r = checkFlowText(flow(nodes, edges), { board: C5 });
  expect(r.errors).toEqual([]);
  const source = r.source!.split("\n").filter((l) => !l.startsWith("runtime.spawn(")).join("\n");
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-ble-"));
  const script = join(dir, "_flow.py");
  writeFileSync(script, "import bluetooth\nB = bluetooth.BLE()\n" + source + "\n" + driver);
  return execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("ble_scan / ble_advertise compile checks", () => {
  it("compile on a board with BLE, and are refused by name on one without", () => {
    expect(errorsOf([scan("s"), debug], C5, [["s", 0, "d", 0]])).toEqual([]);
    const inject: N = { id: "i", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "hi" } };
    expect(errorsOf([inject, adv("a")], C5, [["i", 0, "a", 0]])).toEqual([]);
    expect(errorsOf([scan("s")], "board:pico")[0]).toMatch(/node s \(thingstudio\/ble_scan\) needs "ble", which Raspberry Pi Pico \(RP2040\) doesn't provide/);
    expect(errorsOf([inject, adv("a")], "processor:esp32-s2", [["i", 0, "a", 0]])[0]).toMatch(/needs "ble", which ESP32-S2/);
  });

  it("refuse bad filters, naming the value", () => {
    expect(errorsOf([scan("s", { addr: "zz:12" })])[0]).toMatch(/address "zz:12" is not a Bluetooth address/);
    expect(errorsOf([scan("s", { mfrId: "0x1FFFF" })])[0]).toMatch(/manufacturer id "0x1FFFF" must be 0-65535/);
    expect(errorsOf([scan("s", { serviceUuid: "fcd" })])[0]).toMatch(/service UUID "fcd" must be 16-bit/);
    expect(errorsOf([scan("s", { scanWindowMs: 500 })])[0]).toMatch(/scan window must be 2.5 ms up to the scan interval \(320 ms\)/);
    expect(errorsOf([scan("s", { scanIntervalMs: 1 })])[0]).toMatch(/scan interval must be 2.5-10240 ms/);
  });

  it("refuse two scans with different settings, and accept two with the same", () => {
    expect(errorsOf([scan("s1"), scan("s2", { active: true })])[0]).toMatch(/ble_scan nodes s1 and s2 ask for different scan settings/);
    expect(errorsOf([scan("s1", { namePrefix: "A" }), scan("s2", { namePrefix: "B" })])).toEqual([]);
  });

  it("refuse a second ble_advertise, a name with no room left, and bad ids", () => {
    expect(errorsOf([adv("a1"), adv("a2")])[0]).toMatch(/only one ble_advertise per flow/);
    expect(errorsOf([adv("a", { name: "a-very-long-device-name-for-ble" })])[0]).toMatch(/leaves no room: 40 of 31 bytes before any payload/);
    expect(errorsOf([adv("a", { mfrId: "nope" })])[0]).toMatch(/manufacturer id "nope" must be 0-65535/);
    expect(errorsOf([adv("a", { field: "service", serviceUuid: "xyz" })])).toEqual([expect.stringMatching(/service UUID "xyz" must be 16-bit/)]);
  });
});

describe("ble_scan on the board", () => {
  it("sends one message per advertisement, with the fields a flow reads", () => {
    const out = runFlow([scan("s", { mfrId: "0x0499" }), debug], [["s", 0, "d", 0]], `
import ts_ble
print('SCAN', [c for c in B.calls if c[0] == 'gap_scan'])
B.deliver(bytes.fromhex('d0cf13f9b7b2'), ts_ble.build_adv('ruuvi', mfr_id=0x0499, mfr=b'\\x05\\x01'), rssi=-48)
B.deliver(bytes.fromhex('a4c138000001'), ts_ble.build_adv('phone'), rssi=-70)
async def main():
    await _custom_thingstudio_ble_scan_wait(_custom_thingstudio_ble_scan_props)
    m = await _custom_thingstudio_ble_scan_emit(_custom_thingstudio_ble_scan_props)
    await _custom_thingstudio_debug_call(m)
    print('LEFT', len(runtime._singletons))
asyncio.run(main())
`);
    expect(out).toContain("SCAN [('gap_scan', 0, 320000, 30000, False)]");
    expect(out).toContain("NODE_STATUS node=s state=connected text=scanning");
    expect(out).toMatch(/DEBUG node=d msg=\{'payload': b'[^']*', 'topic': '', 'addr': 'd0:cf:13:f9:b7:b2', 'addrType': 'public', 'rssi': -48, 'connectable': True, 'scanResponse': False, 'name': 'ruuvi', 'mfrId': 1177, 'mfr': b'\\x05\\x01'/);
    expect(out).not.toContain("phone");
  });
});

describe("ble_advertise on the board", () => {
  const injectAdv: N[] = [
    { id: "t", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "hi" } },
    adv("a", { name: "ts-c5" }),
  ];
  it("advertises its name from flow start, then each payload as manufacturer data", () => {
    const out = runFlow(injectAdv, [["t", 0, "a", 0]], `
print('START', [c for c in B.calls if c[0] == 'gap_advertise'])
async def main():
    await _custom_thingstudio_ble_advertise_call({'payload': b'\\x01\\x02', 'topic': ''})
    await _custom_thingstudio_ble_advertise_call({'payload': 'hi', 'topic': ''})
asyncio.run(main())
import ts_ble
print('LAST', ts_ble.decode(B.advertising)['mfr'], ts_ble.decode(B.advertising)['mfrId'], ts_ble.decode(B.advertising)['name'])
`);
    expect(out).toContain("START [('gap_advertise', 500000, b'\\x02\\x01\\x06\\x06\\tts-c5\\x03\\xff\\xff\\xff', False)]");
    expect(out).toContain("text=advertising, 17 bytes free for the payload");
    expect(out).toContain("LAST b'hi' 65535 ts-c5");
  });

  it("reports a payload it can't send and keeps the last advertisement, without raising", () => {
    const out = runFlow(injectAdv, [["t", 0, "a", 0]], `
async def main():
    await _custom_thingstudio_ble_advertise_call({'payload': b'ok', 'topic': ''})
    await _custom_thingstudio_ble_advertise_call({'payload': 42, 'topic': ''})
    await _custom_thingstudio_ble_advertise_call({'payload': b'x' * 30, 'topic': ''})
    print('STILL', B.advertising.endswith(b'ok'))
asyncio.run(main())
`);
    expect(out).toMatch(/payload is int, not bytes or text; pack a number first \(struct\.pack in a function node\)/);
    expect(out).toMatch(/advertising data is 44 bytes, the limit is 31: shorten the name \(5 bytes\) or the payload \(30 bytes\)/);
    expect(out).toContain("STILL True");
  });
});
