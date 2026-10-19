// SPDX-License-Identifier: Apache-2.0
// ntp (editor/src/node-library/ntp.ts). Runs the generated helpers in real CPython with pymock's runtime, network,
// ntptime and time_mock (TZ=UTC so mktime/localtime are UTC like the board's RTC), and checks the sync rules, what
// the status dot and console get, and every format. The compile tests go through the real compiler.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphConfigNode, GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

import { NTP_HELPERS } from "../src/node-library/core-packages/ntp.js";
import { runCompileHooksSync } from "../src/node-library/compile-hooks.js";
import { runHookOnceSync } from "../src/compile-hook/run-hook.js";
import { compileWithHooks } from "./compile-with-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIFI = { id: "w1", type: "thingstudio/config/wifi", properties: { ssid: "HomeNet", password: "pw", security: "password" } };

const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const syncRunner = {
  runSync: (hookSource: string, ctx: Parameters<typeof runHookOnceSync>[0]["context"], properties: Record<string, unknown>) =>
    runHookOnceSync({ wasmBytes, hookSource, context: ctx, properties }),
};

/** The hook's validated/normalized properties for one node (server, offsetSeconds, dstIsEu, format, WiFi). */
function cfg(properties: Record<string, unknown>, configs: GraphConfigNode[] = [WIFI]): Record<string, unknown> {
  const g: GraphData = { nodes: [{ id: "n1", type: "thingstudio/ntp", properties }], links: [], configs };
  const hooks = runCompileHooksSync(g, buildRegistry(), syncRunner);
  return hooks.results.get("n1")!.properties;
}

const indent = (code: string) => code.split("\n").map((l) => (l.length ? "    " + l : l)).join("\n");

/** Runs `body` (Python, inside an async main) after the node's setup code. `N` is the node's _Ntp instance;
 * `ntp(y,m,d,h,mi,s)` sets what the NTP server answers, `at(...)` moves the board's clock. Returns stdout lines. */
function run(properties: Record<string, unknown>, body: string[]): string[] {
  const c = cfg(properties);
  const lines = [
    "import sys, calendar",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    "import time",
    "import runtime, network, ntptime",
    "asyncio = runtime.asyncio",
    NTP_HELPERS,
    `N = _Ntp("n1", ${JSON.stringify(String(c.server))}, ${Number(c.offsetSeconds)}, ${c.dstIsEu ? "True" : "False"})`,
    "def ntp(*a):",
    "    ntptime.NTP.EPOCH = calendar.timegm(a)",
    "def at(*a):",
    "    time_mock.CLOCK.epoch = calendar.timegm(a)",
    "async def wait_sent():",
    "    await N.wait()",
    `    return N.msg(${JSON.stringify(String(c.format))})`,
    "async def _main():",
    indent(body.join("\n")),
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-ntp-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  return execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock"), TZ: "UTC" },
    encoding: "utf8",
  })
    .split("\n")
    .filter((l) => l.length > 0);
}

/** The message sent after a successful sync at the given UTC time, every field. */
function sentAt(properties: Record<string, unknown>, y: number, mo: number, d: number, h: number, mi: number, s: number) {
  const out = run(properties, [
    "network.WLAN.CONNECTED = True",
    `ntp(${y},${mo},${d},${h},${mi},${s})`,
    "m = await wait_sent()",
    "import json",
    "print('MSG', json.dumps(m, sort_keys=True))",
  ]);
  return JSON.parse(out.find((l) => l.startsWith("MSG "))!.slice(4)) as Record<string, unknown>;
}

describe("ntp node: formats", () => {
  it("sends every format, payload picked by format, topic empty", () => {
    const m = sentAt({ dst: "eu", format: "time" }, 2026, 10, 14, 13, 5, 9);
    expect(m).toEqual({
      payload: "14:05",
      topic: "",
      unix: Date.UTC(2026, 9, 14, 13, 5, 9) / 1000,
      time: "14:05",
      time_seconds: "14:05:09",
      time_12h: "2:05 pm",
      date: "Wed 14 Oct",
      date_iso: "2026-10-14",
      iso: "2026-10-14T14:05:09+01:00",
    });
  });

  it("puts the chosen format in payload, unix as an int", () => {
    expect(sentAt({ format: "unix" }, 2026, 1, 5, 8, 0, 0).payload).toBe(Date.UTC(2026, 0, 5, 8) / 1000);
    expect(sentAt({ format: "iso", dst: "none" }, 2026, 1, 5, 8, 0, 0).payload).toBe("2026-01-05T08:00:00+00:00");
    expect(sentAt({ format: "date" }, 2026, 1, 5, 8, 0, 0).payload).toBe("Mon 5 Jan");
  });

  it("applies the offset to local time but keeps unix as UTC", () => {
    const m = sentAt({ utcOffset: 5.5, dst: "none" }, 2026, 1, 5, 20, 0, 0);
    expect(m.time).toBe("01:30");
    expect(m.date_iso).toBe("2026-01-06");
    expect(m.iso).toBe("2026-01-06T01:30:00+05:30");
    expect(m.unix).toBe(Date.UTC(2026, 0, 5, 20) / 1000);
    expect(sentAt({ utcOffset: -5, dst: "none" }, 2026, 1, 5, 20, 0, 0).iso).toBe("2026-01-05T15:00:00-05:00");
  });

  it("starts and ends UK/EU summer time at 01:00 UTC on the last Sundays", () => {
    expect(sentAt({}, 2026, 3, 29, 0, 59, 59).iso).toBe("2026-03-29T00:59:59+00:00");
    expect(sentAt({}, 2026, 3, 29, 1, 0, 0).iso).toBe("2026-03-29T02:00:00+01:00");
    expect(sentAt({}, 2026, 10, 25, 0, 59, 59).iso).toBe("2026-10-25T01:59:59+01:00");
    expect(sentAt({}, 2026, 10, 25, 1, 0, 0).iso).toBe("2026-10-25T01:00:00+00:00");
  });

  it("writes 12-hour midnight and noon as 12", () => {
    expect(sentAt({ dst: "none" }, 2026, 1, 5, 0, 7, 0).time_12h).toBe("12:07 am");
    expect(sentAt({ dst: "none" }, 2026, 1, 5, 12, 7, 0).time_12h).toBe("12:07 pm");
  });
});

describe("ntp node: syncing", () => {
  it("waits for WiFi, checking every 2 s, then syncs and sends", () => {
    const out = run({ dst: "none" }, [
      "ntp(2026,1,5,8,0,0)",
      "print('SYNC', N._sync(), ntptime.NTP.CALLS)",
      "time_mock.CLOCK.now = 1999",
      "print('LEFT', time_mock.ticks_diff(N.due, time_mock.ticks_ms()))",
      "network.WLAN.CONNECTED = True",
      "time_mock.CLOCK.now = 2000",
      "m = await wait_sent()",
      "print('SENT', m['payload'], ntptime.NTP.CALLS)",
    ]);
    expect(out).toContain("NODE_STATUS node=n1 state=connecting text=waiting for WiFi");
    expect(out).toContain("SYNC False 0");
    expect(out).toContain("LEFT 1");
    expect(out).toContain("NODE_STATUS node=n1 state=connected text=synced");
    expect(out).toContain("SENT 08:00 1");
  });

  it("reports a failure once on the console and on the dot, and retries after 30 s", () => {
    const out = run({ server: "time.example.org" }, [
      "network.WLAN.CONNECTED = True",
      "ntptime.NTP.FAIL = True",
      "print('A', N._sync())",
      "print('DUE', time_mock.ticks_diff(N.due, time_mock.ticks_ms()))",
      "time_mock.CLOCK.now = 30000",
      "print('B', N._sync())",
      "ntptime.NTP.FAIL = False",
      "ntp(2026,1,5,8,0,0)",
      "time_mock.CLOCK.now = 60000",
      "print('C', N._sync(), ','.join(ntptime.NTP.HOSTS))",
    ]);
    expect(out.filter((l) => l.startsWith("NODE_ERROR"))).toEqual([
      "NODE_ERROR node=n1 type=OSError msg=NTP from time.example.org failed: OSError(110)",
    ]);
    expect(out.filter((l) => l.startsWith("NODE_STATUS"))).toEqual([
      "NODE_STATUS node=n1 state=error text=NTP from time.example.org failed",
      "NODE_STATUS node=n1 state=connected text=synced",
    ]);
    expect(out).toContain("A False");
    expect(out).toContain("DUE 30000");
    expect(out).toContain("B False");
    expect(out).toContain("C True time.example.org,time.example.org,time.example.org");
  });

  it("syncs again an hour later, and not before", () => {
    const out = run({}, [
      "network.WLAN.CONNECTED = True",
      "ntp(2026,1,5,8,0,0)",
      "await wait_sent()",
      "print('DUE', time_mock.ticks_diff(N.due, time_mock.ticks_ms()))",
      "time_mock.CLOCK.now = 3600000",
      "await wait_sent()",
      "print('CALLS', ntptime.NTP.CALLS)",
    ]);
    expect(out).toContain("DUE 3600000");
    expect(out).toContain("CALLS 2");
  });

  it("once synced, sends for each message in without syncing again", () => {
    const out = run({ format: "time_seconds", dst: "none" }, [
      "network.WLAN.CONNECTED = True",
      "ntp(2026,1,5,8,0,0)",
      "await wait_sent()",
      "at(2026,1,5,8,0,7)",
      "asyncio.get_running_loop().call_later(0.01, N.poke)",
      "m = await wait_sent()",
      "print('SENT', m['payload'], ntptime.NTP.CALLS)",
    ]);
    expect(out).toContain("SENT 08:00:07 1");
  });

  it("sends nothing for a message in before the first sync", () => {
    const out = run({}, [
      "N.poke()",
      "try:",
      "    await asyncio.wait_for(wait_sent(), 0.2)",
      "    print('SENT')",
      "except asyncio.TimeoutError:",
      "    print('NOTHING')",
    ]);
    expect(out).toContain("NOTHING");
  });

  it("says so when the firmware has no ntptime", () => {
    const out = run({}, ["network.WLAN.CONNECTED = True", "ntptime_mod = sys.modules['ntptime']", "globals()['ntptime'] = None", "print('S', N._sync())"]);
    expect(out).toContain("NODE_ERROR node=n1 type=OSError msg=NTP from pool.ntp.org failed: OSError('this firmware has no ntptime module')");
  });
});

describe("ntp node: compiling", () => {
  const registry = buildRegistry();
  const flow = (configs: GraphData["configs"], extra: Partial<GraphData> = {}): GraphData => ({
    nodes: [
      { id: "t1", type: "thingstudio/timer", properties: { intervalMs: 1000 } },
      { id: "n1", type: "thingstudio/ntp", properties: { format: "time" } },
      { id: "d1", type: "thingstudio/debug", properties: {} },
    ],
    links: [
      [1, "t1", 0, "n1", 0, "msg"],
      [2, "n1", 0, "d1", 0, "msg"],
    ],
    configs,
    ...extra,
  });

  it("compiles a timer -> ntp -> debug flow, joining WiFi", async () => {
    const r = await compileWithHooks(flow([WIFI]), registry);
    expect(r.source).toContain('class _Ntp');
    expect(r.source).toContain('ts_wifi.ensure_station(');
    expect(r.source).toMatch(/async def run\(msg, properties\):/);
    expect(r.source).toMatch(/async def wait\(properties\):/);
    expect(r.source).toMatch(/async def emit\(properties\):/);
    expect(r.source.match(/class _Ntp/g)).toHaveLength(1); // one closure, one helper class
    expect(r.warnings).toEqual([]);
  });

  it("refuses a flow with no WiFi config", async () => {
    await expect(compileWithHooks(flow([]), registry)).rejects.toThrow(/needs a WiFi network/);
  });

  it("compiles with nothing wired in, and warns when nothing is wired out", async () => {
    const alone: GraphData = { nodes: [{ id: "n1", type: "thingstudio/ntp", properties: {} }], links: [], configs: [WIFI] };
    const r = await compileWithHooks(alone, registry);
    expect(r.warnings).toEqual(["thingstudio/ntp (node n1): sends the time nowhere: wire its output to something"]);
  });

  it("validates its properties", () => {
    const bad = (p: Record<string, unknown>): string => {
      try {
        cfg(p);
        return "";
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    };
    expect(bad({ utcOffset: 15 })).toMatch(/UTC offset must be hours from -12 to 14/);
    expect(bad({ utcOffset: "x" })).toMatch(/offset must be a number/);
    expect(bad({ dst: "us" })).toMatch(/eu or none/);
    expect(bad({ server: "a b;c" })).toMatch(/NTP server|ntp server/);
    expect(bad({ format: "rfc822" })).toMatch(/not recognised/);
  });
});
