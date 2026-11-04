// BLE phase 3 packages (2026-11-04): ble_read, ble_write and ble_notify with the `ble peer` config. Each flow goes
// through the editor's whole compile (checkFlowText), then its generated MicroPython runs in CPython against pymock's
// bluetooth stand-in (a scripted peripheral) and the real ts_ble: find, connect, discover, subscribe, a dropped link
// and the reconnect.

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
const peer = (p: Record<string, unknown> = { namePrefix: "ts-peer" }) => ({ id: "p1", type: "thingstudio/config/ble-peer", properties: { timeoutMs: 2000, ...p } });
const at = (type: string, id: string, p: Record<string, unknown> = {}): N => ({ id, type: `thingstudio/${type}`, properties: { peerConfigId: "p1", serviceUuid: SVC, charUuid: CHAR, encoding: "uint16", ...p } });
const debug: N = { id: "d", type: "thingstudio/debug", properties: {} };
const inject: N = { id: "i", type: "thingstudio/inject", properties: { payloadType: "number", payloadValue: "1" } };

function flow(nodes: N[], edges: E[], configs: unknown[]): string {
  return JSON.stringify({ formatVersion: 1, flowName: "t", nodes, edges, layout: {}, configs });
}

function runFlow(nodes: N[], edges: E[], driver: string, configs: unknown[] = [peer()], peripheral = ""): string {
  const r = checkFlowText(flow(nodes, edges, configs), { board: C5 });
  expect(r.errors).toEqual([]);
  const source = r.source!.split("\n").filter((l) => !l.startsWith("runtime.spawn(")).join("\n");
  const prelude = `import bluetooth, struct, ts_ble
import ts_ble.central
ts_ble.central.RETRY_MS = 100
B = bluetooth.BLE()
B.fake_peripheral(bytes.fromhex('a4c138000001'), ts_ble.build_adv('ts-peer'),
    [('${SVC}', [('${CHAR}', 0x02 | 0x08 | 0x10, struct.pack('<H', 7))])]${peripheral})
`;
  const helpers = `
import runtime
P = runtime._singletons[('ble_peer', 'p1')][1]
async def connected():
    P.start()
    for _ in range(200):
        if P.state == 'connected':
            return
        await asyncio.sleep(0.01)
    raise AssertionError('never connected: ' + P.state)
`;
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-central-"));
  const script = join(dir, "_flow.py");
  writeFileSync(script, prelude + source + "\n" + helpers + driver);
  return execFileSync("python3", [script], { env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") }, encoding: "utf8", timeout: 20_000 });
}

describe("central compile checks", () => {
  const errs = (nodes: N[], edges: E[], configs: unknown[]) => checkFlowText(flow(nodes, edges, configs), { board: C5 }).errors.map((e) => e.message);
  it("need a peer with an address or a name, and good UUIDs; refused without BLE", () => {
    expect(errs([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], [peer()])).toEqual([]);
    expect(errs([at("ble_notify", "n", { peerConfigId: "" }), debug], [["n", 0, "d", 0]], [])[0]).toMatch(/needs a BLE peer/);
    expect(errs([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], [peer({ namePrefix: "" })])[0]).toMatch(/needs an address or a name/);
    expect(errs([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], [peer({ addr: "zz" })])[0]).toMatch(/BLE peer address "zz" is not a Bluetooth address/);
    expect(errs([at("ble_notify", "n", { charUuid: "x" }), debug], [["n", 0, "d", 0]], [peer()])[0]).toMatch(/needs a characteristic UUID/);
    expect(checkFlowText(flow([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], [peer()]), { board: "board:pico" }).errors[0]!.message).toMatch(/needs "ble"/);
  });
});

describe("central on the board", () => {
  it("finds the peer by name, connects, discovers, reads and writes", () => {
    const out = runFlow([inject, at("ble_read", "r"), at("ble_write", "w"), debug], [["i", 0, "r", 0], ["r", 0, "d", 0], ["i", 0, "w", 0]], `
async def main():
    await connected()
    m = await _custom_thingstudio_ble_read_run({'payload': 1, 'topic': ''}, _custom_thingstudio_ble_read_props)
    print('READ', m['payload'])
    await _custom_thingstudio_ble_write_run({'payload': 300, 'topic': ''}, _custom_thingstudio_ble_write_props)
    print('WROTE', B.peer_writes[-1])
    await _custom_thingstudio_ble_write_run({'payload': 70000, 'topic': ''}, _custom_thingstudio_ble_write_props)
asyncio.run(main())
`);
    expect(out).toContain("NODE_STATUS node=r state=connecting text=finding ts-peer");
    expect(out).toContain("NODE_STATUS node=r state=connected text=connected to ts-peer");
    expect(out).toContain("READ 7");
    expect(out).toContain("WROTE (3, b',\\x01', 1)");
    expect(out).toMatch(/ble_write: 70000 doesn't fit uint16/);
  });

  it("subscribes, sends each notified value, and subscribes again after the link drops", () => {
    const out = runFlow([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], `
async def take():
    await _custom_thingstudio_ble_notify_wait(_custom_thingstudio_ble_notify_props)
    return await _custom_thingstudio_ble_notify_emit(_custom_thingstudio_ble_notify_props)
async def main():
    await connected()
    print('CCCD', [w for w in B.peer_writes if w[1] == b'\\x01\\x00'])
    B.peripheral_notify('${CHAR}', struct.pack('<H', 5))
    m = await take()
    print('VALUE', m['payload'], m['peer'])
    B.peripheral_disconnect()
    await asyncio.sleep(0.02)
    print('STATE', P.state)
    await connected()
    B.peripheral_notify('${CHAR}', struct.pack('<H', 6))
    print('AGAIN', (await take())['payload'])
    P.stop()
asyncio.run(main())
`);
    expect(out).toContain("CCCD [(4, b'\\x01\\x00', 1)]");
    expect(out).toContain("VALUE 5 ts-peer");
    expect(out).toContain("NODE_STATUS node=n state=error text=ts-peer disconnected");
    expect(out).toContain("AGAIN 6");
  });

  it("reports a read while not connected, a missing peer once, and a missing service by name", () => {
    const out = runFlow([inject, at("ble_read", "r", { serviceUuid: "181a" })], [["i", 0, "r", 0]], `
async def main():
    m = await _custom_thingstudio_ble_read_run({'payload': 1, 'topic': ''}, _custom_thingstudio_ble_read_props)
    print('DROPPED', m)
    for _ in range(100):
        if 'no service' in (P.last_error or ''):
            break
        await asyncio.sleep(0.01)
    print('LAST', P.last_error)
    P.stop()
asyncio.run(main())
`);
    expect(out).toContain("DROPPED None");
    expect(out).toMatch(/ts-peer isn't connected \(finding\): can't read/);
    expect(out).toContain("LAST ts-peer: no service 181a -- check the service UUID");
    expect(out.match(/NODE_ERROR node=r type=PeerError msg=ts-peer: no service/g)?.length).toBe(1);
  });

  it("keeps going when the radio refuses a scan: reports it, retries, connects", () => {
    // Seen on the ESP32-C5 (2026-11-04): OSError(-519) from gap_scan killed the peer task, leaving it on "finding".
    const out = runFlow([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], `
B.fail_scan = OSError(-519)
async def main():
    await connected()
    print('STATE', P.state)
    P.stop()
asyncio.run(main())
`);
    expect(out).toMatch(/ts-peer: the radio refused to scan for it \(OSError\(-519/);
    expect(out).toContain("STATE connected");
  });

  it("gives up connecting after the timeout and says so", () => {
    const out = runFlow([at("ble_notify", "n"), debug], [["n", 0, "d", 0]], `
async def main():
    P.start()
    for _ in range(400):
        if P.last_error:
            break
        await asyncio.sleep(0.01)
    print('LAST', P.last_error)
    P.stop()
asyncio.run(main())
`, [peer({ namePrefix: "ts-peer", timeoutMs: 1000 })], `, fail='connect'`);
    expect(out).toContain("LAST connecting to ts-peer took over 2 s");
  });
});
