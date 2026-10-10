// SPDX-License-Identifier: Apache-2.0
// clock (editor/src/node-library/clock.ts). Runs the generated transform in real CPython with pymock's network,
// ntptime and time_mock (TZ=UTC so mktime/localtime are UTC like the board's RTC), and checks what it sends.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { clockNode } from "../src/node-library/clock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function freshCtx(): CodegenContext {
  const used = new Set<string>();
  return {
    uniqueName(hint: string): string {
      let candidate = `_${hint}`;
      let i = 1;
      while (used.has(candidate)) candidate = `_${hint}_${i++}`;
      used.add(candidate);
      return candidate;
    },
    resolveConfig(id: string): Record<string, unknown> {
      throw new Error(`unexpected resolveConfig("${id}")`);
    },
  };
}

const node = (properties: Record<string, unknown>): GraphNode => ({ id: "c1", type: "thingstudio/clock", properties });
const indent = (code: string) => code.split("\n").map((l) => (l.length ? "    " + l : l)).join("\n");

/** Each step is Python run before one call of the node, e.g. "ntp(2026,10,10,14,5,9)". Output lines (one per step):
 * "time=14:05 date=Sat 10 Oct", with "-" for a slot that sent nothing, or "dropped". */
function run(properties: Record<string, unknown>, steps: string[]): string[] {
  const r = clockNode.codegenTransform!(node(properties), freshCtx());
  const lines = [
    "import sys, calendar",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    "import runtime, network, ntptime",
    "asyncio = runtime.asyncio",
    ...(r.imports ?? []),
    ...(r.statements ?? []).map((s) => s.code),
    "",
    `async def ${r.functionName}(msg):`,
    indent(r.functionBody),
    "",
    "def ntp(*a):",
    "    ntptime.NTP.EPOCH = calendar.timegm(a)",
    "def at(*a):",
    "    time_mock.CLOCK.epoch = calendar.timegm(a)",
    "",
    "async def _main():",
    ...steps.flatMap((s) => [
      `    ${s}`,
      `    o = await ${r.functionName}({'payload': 1, 'topic': 't'})`,
      "    print('RESULT', 'dropped' if o is None else 'time=%s date=%s' % tuple('-' if m is None else m['payload'] for m in o))",
    ]),
    "    print('INFO', ntptime.NTP.CALLS, ','.join(ntptime.NTP.HOSTS))",
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-clock-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock"), TZ: "UTC" },
    encoding: "utf8",
  });
  const info = out.split("\n").find((l) => l.startsWith("INFO "))!.split(" ");
  lastInfo = { calls: Number(info[1]), hosts: info[2] ?? "" };
  return out.split("\n").filter((l) => l.startsWith("RESULT ")).map((l) => l.slice(7));
}

let lastInfo = { calls: 0, hosts: "" };

const online = "network.WLAN.CONNECTED = True";

describe("thingstudio/clock node", () => {
  it("sends the time and date once synced, in UTC with no offset", () => {
    const out = run({ dst: "none" }, [`${online}; ntp(2026,10,10,14,5,9)`]);
    expect(out).toEqual(["time=14:05 date=Sat 10 Oct"]);
  });

  it("sends nothing until WiFi is up and the sync works, retrying no sooner than 30 s", () => {
    const out = run({ dst: "none" }, [
      "network.WLAN.CONNECTED = False; ntp(2026,1,5,8,0,0)",
      `${online}; time_mock.CLOCK.now = 30000; ntptime.NTP.FAIL = True`,
      "time_mock.CLOCK.now = 40000; ntptime.NTP.FAIL = False",
      "time_mock.CLOCK.now = 61000",
    ]);
    expect(out).toEqual(["dropped", "dropped", "dropped", "time=08:00 date=Mon 5 Jan"]);
    expect(lastInfo.calls).toBe(2);
  });

  it("applies the UTC offset", () => {
    const out = run({ dst: "none", utcOffset: 5.5 }, [`${online}; ntp(2026,1,5,23,0,0)`]);
    expect(out).toEqual(["time=04:30 date=Tue 6 Jan"]);
  });

  describe("UK / EU daylight saving", () => {
    const eu = (y: number, mo: number, d: number, h: number, mi: number) =>
      run({ dst: "eu", utcOffset: 0 }, [`${online}; ntp(${y},${mo},${d},${h},${mi},0)`])[0];
    it("is winter time before the last Sunday of March 01:00 UTC", () => {
      expect(eu(2026, 3, 29, 0, 59)).toBe("time=00:59 date=Sun 29 Mar");
    });
    it("is summer time from then on", () => {
      expect(eu(2026, 3, 29, 1, 0)).toBe("time=02:00 date=Sun 29 Mar");
    });
    it("is summer time in July", () => {
      expect(eu(2026, 7, 1, 12, 0)).toBe("time=13:00 date=Wed 1 Jul");
    });
    it("is still summer time just before the last Sunday of October 01:00 UTC", () => {
      expect(eu(2026, 10, 25, 0, 59)).toBe("time=01:59 date=Sun 25 Oct");
    });
    it("is winter time from then on", () => {
      expect(eu(2026, 10, 25, 1, 0)).toBe("time=01:00 date=Sun 25 Oct");
    });
    it("works in a year whose March ends on a Sunday that is the 31st (2024: 31 Mar)", () => {
      expect(eu(2024, 3, 31, 1, 0)).toBe("time=02:00 date=Sun 31 Mar");
    });
    it("adds to the offset (CET + summer)", () => {
      const o = run({ dst: "eu", utcOffset: 1 }, [`${online}; ntp(2026,7,1,12,0,0)`]);
      expect(o).toEqual(["time=14:00 date=Wed 1 Jul"]);
    });
  });

  it("sends only what changed", () => {
    const out = run({ dst: "none" }, [
      `${online}; ntp(2026,10,10,23,58,0)`,
      "at(2026,10,10,23,58,30)",
      "at(2026,10,10,23,59,0)",
      "at(2026,10,11,0,0,0)",
    ]);
    expect(out).toEqual([
      "time=23:58 date=Sat 10 Oct",
      "dropped",
      "time=23:59 date=-",
      "time=00:00 date=Sun 11 Oct",
    ]);
  });

  it("shows seconds on request", () => {
    const out = run({ dst: "none", seconds: true }, [`${online}; ntp(2026,10,10,9,5,7)`, "at(2026,10,10,9,5,8)"]);
    expect(out).toEqual(["time=09:05:07 date=Sat 10 Oct", "time=09:05:08 date=-"]);
  });

  it("shows 12-hour time without a leading zero, with midnight and noon as 12", () => {
    const out = run({ dst: "none", hour12: true }, [
      `${online}; ntp(2026,10,10,15,5,0)`,
      "at(2026,10,11,0,5,0)",
      "at(2026,10,11,12,5,0)",
    ]);
    expect(out.map((l) => l.split(" date=")[0])).toEqual(["time=3:05", "time=12:05", "dropped"]);
  });

  it("blinks the colon when asked, and only then", () => {
    const out = run({ dst: "none", seconds: true, blink: true }, [`${online}; ntp(2026,10,10,9,5,8)`, "at(2026,10,10,9,5,9)"]);
    expect(out).toEqual(["time=09:05:08 date=Sat 10 Oct", "time=09 05:09 date=-"]);
  });

  it("uses the configured NTP server", () => {
    run({ dst: "none", server: "time.example.org" }, [`${online}; ntp(2026,1,5,8,0,0)`]);
    expect(lastInfo.hosts).toBe("time.example.org");
  });

  it("syncs again after an hour and not before", () => {
    const out = run({ dst: "none" }, [
      `${online}; ntp(2026,1,5,8,0,0); time_mock.CLOCK.now = 0`,
      "time_mock.CLOCK.now = 3599000",
      "time_mock.CLOCK.now = 3600001",
    ]);
    expect(out.length).toBe(3);
    expect(lastInfo.calls).toBe(2);
  });

  describe("properties", () => {
    const bad = (p: Record<string, unknown>) => () => clockNode.codegenTransform!(node(p), freshCtx());
    it("rejects an offset outside -12..14", () => {
      expect(bad({ utcOffset: 15 })).toThrow(CompileError);
      expect(bad({ utcOffset: "x" })).toThrow(/UTC offset "x"/);
    });
    it("rejects an unknown daylight-saving mode", () => {
      expect(bad({ dst: "us" })).toThrow(/eu or none/);
    });
    it("rejects an odd server name", () => {
      expect(bad({ server: "a b;c" })).toThrow(/NTP server/);
    });
    it("writes the shared helpers once for two clocks", () => {
      const ctx = freshCtx();
      const a = clockNode.codegenTransform!(node({}), ctx);
      const b = clockNode.codegenTransform!({ ...node({}), id: "c2" }, ctx);
      expect(a.statements!.find((s) => s.key === "clock-helpers")).toEqual(b.statements!.find((s) => s.key === "clock-helpers"));
    });
  });
});
