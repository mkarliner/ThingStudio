// The shared BLE radio library (device-runtime/src/vendor/thingstudio_ble/ts_ble/, a package), run in CPython against
// pymock's bluetooth/runtime fixtures (2026-11-03, BLE phase 1). Covers advertising data (build, read, the 31-byte
// limit, malformed input), the shared scan (one gap_scan, per-node filters and queues, the repeat window, copying the
// stack's buffers), conflicting settings, and redeploy cleanup.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-tsble-"));
  const script = join(dir, "_ts_ble.py");
  writeFileSync(script, PRELUDE + body);
  return execFileSync("python3", [script], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
    timeout: 15_000,
  });
}

const PRELUDE = `import asyncio, bluetooth, runtime, ts_ble
B = bluetooth.BLE()
def redeploy():
    # What runtime.cancel_running() does: clear singletons, then run the cleanups.
    runtime._singletons.clear()
    for fn in list(runtime._cleanups.values()):
        fn()
    runtime._cleanups.clear()
MAC = bytes.fromhex('d0cf13f9b7b2')
OTHER = bytes.fromhex('a4c138000001')
`;

describe("ts_ble library", () => {
  it("the pymock fixture is a byte-identical copy of the vendored library, part by part", () => {
    for (const part of ["__init__.py", "server.py", "central.py"]) {
      const fixture = readFileSync(join(__dirname, "fixtures", "pymock", "ts_ble", part));
      const vendor = readFileSync(join(__dirname, "../../device-runtime/src/vendor/thingstudio_ble/ts_ble", part));
      expect(fixture.equals(vendor), part).toBe(true);
    }
  });

  it("a scan-only flow loads only the core: the server and the client stay out of memory", () => {
    const out = run(`
import sys
r = ts_ble.radio()
r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
print('LOADED', sorted(m for m in sys.modules if m.startswith('ts_ble')))
`);
    expect(out).toContain("LOADED ['ts_ble']");
  });

  it("builds advertising data that decodes back to what was put in", () => {
    const out = run(`
a = ts_ble.build_adv('ts-c5', mfr_id=0xFFFF, mfr=b'\\x01\\x02')
print('HEX', a.hex())
d = ts_ble.decode(a)
print('NAME', d['name'], 'MFR', d['mfrId'], d['mfr'].hex())
s = ts_ble.decode(ts_ble.build_adv('', svc_uuid='FCD2', svc=b'\\x40\\x02\\xc4\\x09'))
print('SVC', s['svcData'])
`);
    expect(out).toContain("HEX 020106060974732d633505ffffff0102");
    expect(out).toContain("NAME ts-c5 MFR 65535 0102");
    expect(out).toContain("SVC {'fcd2': b'@\\x02\\xc4\\t'}");
  });

  it("refuses advertising data over 31 bytes, naming both sizes", () => {
    const out = run(`
try:
    ts_ble.build_adv('a-long-name', mfr_id=1, mfr=b'x' * 20)
except ValueError as e:
    print('ERR', e)
`);
    expect(out).toContain("ERR advertising data is 40 bytes, the limit is 31: shorten the name (11 bytes) or the payload (20 bytes)");
  });

  it("reads malformed or hostile advertising data without raising", () => {
    const out = run(`
for bad in (b'', b'\\x00', b'\\xff\\x09abc', b'\\x05\\x09ab', b'\\x02\\xff\\x01', b'\\x03\\x09\\xff\\xfe'):
    print('OK', ts_ble.decode(bad)['name'] == '' )
`);
    expect(out.trim().split("\n")).toEqual(Array(6).fill("OK True"));
  });

  it("starts one scan for every scanner, and gives each the advertisements that pass its own filters", () => {
    const out = run(`
r = ts_ble.radio()
everything = r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
ruuvi = r.scan('n2', 320, 30, False, name_prefix='', addr='', mfr_id=0x0499, svc_uuid='', repeat_ms=0)
print('SCANS', [c for c in B.calls if c[0] == 'gap_scan'])
B.deliver(MAC, ts_ble.build_adv('ts', mfr_id=0x0499, mfr=b'\\x05'), rssi=-40)
B.deliver(OTHER, ts_ble.build_adv('phone'), rssi=-70, addr_type=1, adv_type=3)
async def main():
    m = await everything.next(); print('N1', m['addr'], m['name'], m['rssi'], m['mfrId'], m['addrType'], m['connectable'])
    m = await everything.next(); print('N1', m['addr'], m['name'], m['rssi'], m['mfrId'], m['addrType'], m['connectable'])
    m = await ruuvi.next(); print('N2', m['addr'], m['mfr'].hex(), m['topic'] == '', m['payload'] == ts_ble.build_adv('ts', mfr_id=0x0499, mfr=b'\\x05'))
    print('N2 LEFT', len(ruuvi.queue))
asyncio.run(main())
`);
    expect(out).toContain("SCANS [('gap_scan', 0, 320000, 30000, False)]");
    expect(out).toContain("N1 d0:cf:13:f9:b7:b2 ts -40 1177 public True");
    expect(out).toContain("N1 a4:c1:38:00:00:01 phone -70 None random False");
    expect(out).toContain("N2 d0:cf:13:f9:b7:b2 05 True True");
    expect(out).toContain("N2 LEFT 0");
  });

  it("filters by name prefix, address and service UUID", () => {
    const out = run(`
r = ts_ble.radio()
byname = r.scan('n1', 320, 30, False, name_prefix='ATC_', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
byaddr = r.scan('n2', 320, 30, False, name_prefix='', addr='A4-C1-38-00-00-01', mfr_id=None, svc_uuid='', repeat_ms=0)
bysvc = r.scan('n3', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='0xFCD2', repeat_ms=0)
B.deliver(MAC, ts_ble.build_adv('ATC_1234'))
B.deliver(OTHER, ts_ble.build_adv('', svc_uuid='fcd2', svc=b'\\x40'))
print('COUNTS', len(byname.queue), len(byaddr.queue), len(bysvc.queue))
print('ADDR', byaddr.queue[0]['addr'], 'SVC', bysvc.queue[0]['svcData'])
`);
    expect(out).toContain("COUNTS 1 1 1");
    expect(out).toContain("ADDR a4:c1:38:00:00:01 SVC {'fcd2': b'@'}");
  });

  it("drops an empty scan response, and marks a non-empty one (connectable unknown)", () => {
    const out = run(`
r = ts_ble.radio()
s = r.scan('n1', 320, 30, True, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
B.deliver(MAC, ts_ble.build_adv('', mfr_id=76, mfr=b'\\x10'), adv_type=0)
B.deliver(MAC, b'', adv_type=4)
B.deliver(MAC, ts_ble.build_adv('watch'), adv_type=4)
print('LEN', len(s.queue))
print('FIRST', s.queue[0]['scanResponse'], s.queue[0]['connectable'])
print('RSP', s.queue[1]['scanResponse'], s.queue[1]['connectable'], s.queue[1]['name'])
`);
    expect(out).toContain("LEN 2");
    expect(out).toContain("FIRST False True");
    expect(out).toContain("RSP True None watch");
  });

  it("drops a repeat of the same advertisement inside the repeat window, but not a changed one", () => {
    const out = run(`
r = ts_ble.radio()
s = r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=60000)
a = ts_ble.build_adv('t', mfr_id=1, mfr=b'\\x01')
B.deliver(MAC, a); B.deliver(MAC, a); B.deliver(MAC, ts_ble.build_adv('t', mfr_id=1, mfr=b'\\x02')); B.deliver(OTHER, a)
print('QUEUED', len(s.queue))
`);
    expect(out).toContain("QUEUED 3");
  });

  it("copies the stack's buffers: a message is intact after the stack reuses them", () => {
    const out = run(`
r = ts_ble.radio()
s = r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
B.deliver(MAC, ts_ble.build_adv('keep'))
m = s.queue[0]
print('KEPT', m['addr'], ts_ble.decode(m['payload'])['name'], type(m['payload']).__name__)
`);
    expect(out).toContain("KEPT d0:cf:13:f9:b7:b2 keep bytes");
  });

  it("keeps a full queue at 20 by dropping the oldest, and counts what it dropped", () => {
    const out = run(`
r = ts_ble.radio()
s = r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
for i in range(25):
    B.deliver(MAC, ts_ble.build_adv('t', mfr_id=1, mfr=bytes([i])))
print('LEN', len(s.queue), 'DROPPED', s.dropped, 'FIRST', s.queue[0]['mfr'][0])
`);
    expect(out).toContain("LEN 20 DROPPED 5 FIRST 5");
  });

  it("refuses a second scanner with different scan settings, naming both", () => {
    const out = run(`
r = ts_ble.radio()
r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
try:
    r.scan('n2', 320, 60, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
except ValueError as e:
    print('ERR', e)
`);
    expect(out).toContain("ERR ble_scan 0 is already set up as (320000, 30000, False), not (320000, 60000, False)");
  });

  it("advertises without being connectable, and reports its status", () => {
    const out = run(`
r = ts_ble.radio()
r.advertise('a1', 500, ts_ble.build_adv('ts'))
print('ADV', [c for c in B.calls if c[0] == 'gap_advertise'])
`);
    expect(out).toContain("ADV [('gap_advertise', 500000, b'\\x02\\x01\\x06\\x03\\tts', False)]");
    expect(out).toContain("NODE_STATUS node=a1 state=connected text=advertising 7 bytes");
  });

  it("a redeploy stops the scan and the advertisement, leaves the radio on, and the next deploy starts afresh", () => {
    // Left on, not switched off (2026-11-04): on the ESP32-C5, off-then-on between flows made the next scan fail
    // with OSError(-519) until a power cycle.
    const out = run(`
r = ts_ble.radio()
r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
r.advertise('a1', 500, ts_ble.build_adv('ts'))
redeploy()
print('AFTER', B.is_active, B.scanning, B.advertising, ('active', False) in B.calls, B.handler.__name__)
r2 = ts_ble.radio()
print('FRESH', r2 is not r, B.is_active, len(r2.scanners))
r2.scan('n1', 320, 60, True, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
print('NEW SETTINGS OK')
`);
    expect(out).toContain("AFTER True False None False _ignore_irq");
    // Its own stop is not "the radio stopped the scan".
    expect(out).not.toContain("scan stopped by the radio");
    expect(out).toContain("FRESH True True 0");
    expect(out).toContain("NEW SETTINGS OK");
  });

  it("says the radio failed to start, with the reason and what to do", () => {
    expect(() => run(`
bluetooth.FAIL_ACTIVE = OSError(12)
ts_ble.radio()
`)).toThrow(/Bluetooth radio failed to start \(OSError\(12\)\): the board may be short of memory; hard-reset it/);
  });

  it("reports a scan the radio stopped by itself on every scanner's status", () => {
    const out = run(`
r = ts_ble.radio()
r.scan('n1', 320, 30, False, name_prefix='', addr='', mfr_id=None, svc_uuid='', repeat_ms=0)
B.scan_done()
`);
    expect(out).toContain("NODE_STATUS node=n1 state=error text=scan stopped by the radio");
  });
});
