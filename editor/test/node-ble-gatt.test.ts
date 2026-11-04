// BLE phase 2 packages (2026-11-03): ble_characteristic_in/out and ble_uart_in/out, with the `ble` config and the
// GATT service table the hooks build (core-packages/ble-shared.ts). Each flow goes through the editor's whole compile
// (checkFlowText), then its generated MicroPython runs in CPython against pymock's bluetooth stand-in and the real
// ts_ble, with the test playing the phone: connect, write, MTU exchange, disconnect.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFlowText } from "../src/cli/check-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const C5 = "board:esp32-c5-340x";
const SVC = "6e400010-b5a3-f393-e0a9-e50e24dcca9e";
const CHAR = "6e400011-b5a3-f393-e0a9-e50e24dcca9e";

type N = { id: string; type: string; properties: Record<string, unknown> };
type E = [string, number, string, number];
const bleConfig = (name: string) => ({ id: "b", type: "thingstudio/config/ble", properties: { name } });
function flow(nodes: N[], edges: E[], configs: unknown[] = []): string {
  return JSON.stringify({ formatVersion: 1, flowName: "t", nodes, edges, layout: {}, configs });
}
const charIn = (p: Record<string, unknown> = {}): N => ({ id: "ci", type: "thingstudio/ble_characteristic_in", properties: { serviceUuid: SVC, charUuid: CHAR, encoding: "int16", ...p } });
const charOut = (p: Record<string, unknown> = {}): N => ({ id: "co", type: "thingstudio/ble_characteristic_out", properties: { serviceUuid: SVC, charUuid: CHAR, encoding: "int16", ...p } });
const debug: N = { id: "d", type: "thingstudio/debug", properties: {} };
const inject: N = { id: "i", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "1" } };

function errorsOf(nodes: N[], edges: E[], configs: unknown[] = []): string[] {
  return checkFlowText(flow(nodes, edges, configs), { board: C5 }).errors.map((e) => e.message);
}

function runFlow(nodes: N[], edges: E[], driver: string, configs: unknown[] = []): string {
  const r = checkFlowText(flow(nodes, edges, configs), { board: C5 });
  expect(r.errors).toEqual([]);
  const source = r.source!.split("\n").filter((l) => !l.startsWith("runtime.spawn(")).join("\n");
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-gatt-"));
  const script = join(dir, "_flow.py");
  const prelude = `import bluetooth, struct\nB = bluetooth.BLE()\n`;
  const helpers = `
import runtime, ts_ble, ts_ble.server
G = runtime._singletons[('ble_gatt', 0)][1]
def handle(svc, char):
    return G.handles[(ts_ble.norm_uuid(svc), ts_ble.norm_uuid(char))]
`;
  writeFileSync(script, prelude + source + "\n" + helpers + driver);
  return execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("GATT compile checks", () => {
  it("compile on a board with BLE; refuse missing UUIDs, a clash of encodings, two writers, a long name", () => {
    expect(errorsOf([charIn(), debug], [["ci", 0, "d", 0]])).toEqual([]);
    expect(errorsOf([charIn({ serviceUuid: "" }), debug], [["ci", 0, "d", 0]])[0]).toMatch(/needs a service UUID/);
    expect(errorsOf([charIn(), charOut({ encoding: "uint8" })], [["ci", 0, "co", 0]])[0]).toMatch(/share 6e400011-.* but encode it as int16 and uint8/);
    const two = [inject, charOut(), { ...charOut(), id: "co2" }];
    expect(errorsOf(two, [["i", 0, "co", 0], ["i", 0, "co2", 0]])[0]).toMatch(/ble characteristic out nodes co and co2 both set/);
    expect(errorsOf([charIn(), debug], [["ci", 0, "d", 0]], [bleConfig("x".repeat(27))])[0]).toMatch(/BLE name "x+" is 27 bytes; 26 is the most/);
    expect(checkFlowText(flow([charIn(), debug], [["ci", 0, "d", 0]]), { board: "board:pico" }).errors[0]!.message).toMatch(/needs "ble"/);
  });

  it("types the output by the encoding, so the canvas refuses a wire that can't carry it", () => {
    const pwm: N = { id: "p", type: "thingstudio/pwm_out", properties: { pin: 4 } };
    expect(errorsOf([charIn({ encoding: "int16" }), pwm], [["ci", 0, "p", 0]])).toEqual([]);
    expect(errorsOf([charIn({ encoding: "bytes" }), pwm], [["ci", 0, "p", 0]])[0]).toMatch(/would refuse this wire \(bytes from ble_characteristic_in/);
  });
});

describe("GATT server on the board", () => {
  it("registers the whole flow's table once, advertises connectably under the BLE name, and decodes a phone's write", () => {
    const out = runFlow([charIn(), charOut({ encoding: "int16" }), debug], [["ci", 0, "d", 0], ["ci", 0, "co", 0]], `
regs = [c for c in B.calls if c[0] == 'gatts_register_services']
print('REGISTERS', len(regs))
print('SERVICES', [(s.value, [(c.value, f) for c, f in chars]) for s, chars in regs[0][1]])
print('BUFFER', B.buffers[handle('${SVC}', '${CHAR}')], 'MTU', B.mtu)
print('ADV', ts_ble.decode(B.advertising)['name'], B.adv_connectable)
B.connect()
B.phone_write(handle('${SVC}', '${CHAR}'), struct.pack('<h', -5))
B.phone_write(handle('${SVC}', '${CHAR}'), b'\\x01')
B.phone_write(handle('${SVC}', '${CHAR}'), struct.pack('<h', 300))
async def main():
    for _ in range(2):
        await _custom_thingstudio_ble_characteristic_in_wait(_custom_thingstudio_ble_characteristic_in_props)
        m = await _custom_thingstudio_ble_characteristic_in_emit(_custom_thingstudio_ble_characteristic_in_props)
        await _custom_thingstudio_debug_call(m)
asyncio.run(main())
`, [bleConfig("ts-c5")]);
    expect(out).toContain("REGISTERS 1");
    expect(out).toContain(`SERVICES [('${SVC}', [('${CHAR}', 30)])]`); // read | write-no-response | write | notify
    expect(out).toContain("BUFFER 244 MTU 247");
    expect(out).toContain("ADV ts-c5 True");
    expect(out).toContain("NODE_STATUS node=ci state=disconnected text=advertising, no one connected");
    expect(out).toContain("NODE_STATUS node=ci state=connected text=1 connected");
    expect(out).toMatch(/DEBUG node=d payload=-5\b/);
    expect(out).toMatch(/a phone wrote 1 bytes, but int16 is 2/);
    expect(out).toMatch(/DEBUG node=d payload=300\b/);
  });

  it("sets the value, notifies only connected phones, and reports a value that doesn't fit", () => {
    const out = runFlow([inject, charOut()], [["i", 0, "co", 0]], `
h = handle('${SVC}', '${CHAR}')
async def main():
    await _custom_thingstudio_ble_characteristic_out_call({'payload': 21, 'topic': ''})
    print('ALONE', B.values[h], B.notified)
    B.connect(conn=7)
    await _custom_thingstudio_ble_characteristic_out_call({'payload': -2, 'topic': ''})
    print('NOTIFIED', B.notified)
    await _custom_thingstudio_ble_characteristic_out_call({'payload': 'abc', 'topic': ''})
    await _custom_thingstudio_ble_characteristic_out_call({'payload': 70000, 'topic': ''})
    print('KEPT', B.values[h])
asyncio.run(main())
`);
    expect(out).toContain("ALONE b'\\x15\\x00' []");
    expect(out).toContain("NOTIFIED [(7, 3, b'\\xfe\\xff')]");
    expect(out).toMatch(/ble_characteristic_out: 'abc' doesn't fit int16: it isn't a number/);
    expect(out).toMatch(/ble_characteristic_out: 70000 doesn't fit int16: the range is -32768 to 32767/);
    expect(out).toContain("KEPT b'\\xfe\\xff'");
  });

  it("starts advertising again when a phone disconnects", () => {
    const out = runFlow([inject, charOut()], [["i", 0, "co", 0]], `
B.connect()
print('CONNECTED', B.advertising)
B.disconnect()
print('AGAIN', ts_ble.decode(B.advertising)['name'], B.adv_connectable)
`);
    expect(out).toContain("CONNECTED None");
    expect(out).toContain("AGAIN thingstudio True");
    expect(out).toContain("NODE_STATUS node=co state=disconnected text=advertising, no one connected");
  });

  it("makes a ble advertise node's advertisement connectable when the flow has a GATT server", () => {
    const adv: N = { id: "a", type: "thingstudio/ble_advertise", properties: {} };
    const out = runFlow([inject, adv, charOut()], [["i", 0, "a", 0], ["i", 0, "co", 0]], `
d = ts_ble.decode(B.advertising)
print('ADV', d['name'], d['mfrId'], B.adv_connectable)
`, [bleConfig("ts-c5")]);
    expect(out).toContain("ADV ts-c5 65535 True");
  });
});

describe("Nordic UART on the board", () => {
  const uartIn: N = { id: "ui", type: "thingstudio/ble_uart_in", properties: {} };
  const uartOut: N = { id: "uo", type: "thingstudio/ble_uart_out", properties: {} };

  it("registers the Nordic UART Service, joins a phone's writes into lines, and sends text back in MTU-sized pieces", () => {
    const out = runFlow([uartIn, uartOut], [["ui", 0, "uo", 0]], `
NUS = ts_ble.server.NUS_SERVICE
print('SERVICES', [(s.value, [(c.value, f) for c, f in chars]) for s, chars in B.services])
rx = handle(NUS, ts_ble.server.NUS_RX)
tx = handle(NUS, ts_ble.server.NUS_TX)
B.connect()
B.phone_write(rx, b'hel')
B.phone_write(rx, b'lo\\r\\nwor')
B.phone_write(rx, b'ld\\n')
B.phone_write(rx, b'\\xff\\xfe\\n')
B.phone_write(rx, b'ok\\n')
async def main():
    for _ in range(3):
        await _custom_thingstudio_ble_uart_in_wait(_custom_thingstudio_ble_uart_in_props)
        m = await _custom_thingstudio_ble_uart_in_emit(_custom_thingstudio_ble_uart_in_props)
        print('LINE', repr(m['payload']), m['conn'])
    await _custom_thingstudio_ble_uart_out_call({'payload': 'x' * 45, 'topic': ''})
    print('PIECES', [len(d) for c, h, d in B.notified])
    B.notified.clear()
    B.mtu_exchanged(100)
    await _custom_thingstudio_ble_uart_out_call({'payload': 'x' * 45, 'topic': ''})
    print('AFTER MTU', [len(d) for c, h, d in B.notified], B.notified[0][2][-1:])
asyncio.run(main())
`);
    expect(out).toContain("SERVICES [('6e400001-b5a3-f393-e0a9-e50e24dcca9e', [('6e400002-b5a3-f393-e0a9-e50e24dcca9e', 12), ('6e400003-b5a3-f393-e0a9-e50e24dcca9e', 16)])]");
    expect(out).toContain("LINE 'hello' 1");
    expect(out).toContain("LINE 'world' 1");
    expect(out).toMatch(/ble_uart_in: a phone sent 2 bytes that aren't UTF-8 text/);
    expect(out).toContain("LINE 'ok' 1");
    expect(out).toContain("PIECES [20, 20, 6]");
    expect(out).toContain("AFTER MTU [46] b'\\n'");
  });

  it("with lines off, sends each write as it comes", () => {
    const out = runFlow([{ ...uartIn, properties: { lines: false } }, debug], [["ui", 0, "d", 0]], `
B.connect()
B.phone_write(handle(ts_ble.server.NUS_SERVICE, ts_ble.server.NUS_RX), b'ab')
async def main():
    await _custom_thingstudio_ble_uart_in_wait(_custom_thingstudio_ble_uart_in_props)
    print('MSG', repr((await _custom_thingstudio_ble_uart_in_emit(_custom_thingstudio_ble_uart_in_props))['payload']))
asyncio.run(main())
`);
    expect(out).toContain("MSG 'ab'");
  });
});
