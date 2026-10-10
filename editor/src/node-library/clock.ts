// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/clock.ts
//
// The time of day for a display (2026-10-10; the decisions are in docs/working-notes/decisions/gui-layout.md).
// Every message in (wire a timer, 1 s for a clock with seconds, otherwise 1-5 s) is a look at the clock:
//
//   output 1 "time"  msg.payload "14:05" (or "14:05:09" / "2:05" in 12-hour); only when the text changes
//   output 2 "date"  msg.payload "Sat 10 Oct"; only when the day changes
//
// Nothing is sent until the first NTP sync, so a gui label shows "unknown" rather than a wrong time. Sync is
// ntptime.settime() (UTC, blocks for up to about a second, needs WiFi): retried every 30 s until it works, then
// hourly. Between syncs the board's own clock runs. A failure while WiFi is up is reported once on the node.
//
// MicroPython has no time zones, so the node adds a fixed offset in hours and, with `dst: eu`, an hour from 01:00
// UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October (UK and EU rule). Other DST rules
// are not covered: use "none" and the offset.
//
// ntptime is imported where it exists; a firmware without it reports a clear error instead of failing at boot.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";

const CLOCK_HELPERS = `try:
    import ntptime
except ImportError:
    ntptime = None

_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

def _last_sunday(year, month):
    wd = time.localtime(time.mktime((year, month, 31, 1, 0, 0, 0, 0, 0)))[6]
    return 31 - (wd + 1) % 7

def _eu_dst(utc):
    y = time.localtime(utc)[0]
    start = time.mktime((y, 3, _last_sunday(y, 3), 1, 0, 0, 0, 0, 0))
    end = time.mktime((y, 10, _last_sunday(y, 10), 1, 0, 0, 0, 0, 0))
    return start <= utc < end`;

export const CLOCK_DST_MODES = ["eu", "none"] as const;

export const clockNode: NodeDefinition = {
  type: "thingstudio/clock",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [
      { name: "time", type: "any" },
      { name: "date", type: "any" },
    ],
  },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const p = node.properties;
    const host = p.server === undefined || p.server === null || p.server === "" ? "pool.ntp.org" : String(p.server).trim();
    if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new CompileError(`clock node's NTP server "${host}" must be a host name such as pool.ntp.org`);
    const offRaw = p.utcOffset;
    const offset = offRaw === undefined || offRaw === null || offRaw === "" ? 0 : Number(offRaw);
    if (!Number.isFinite(offset) || offset < -12 || offset > 14) throw new CompileError(`clock node's UTC offset "${String(offRaw)}" must be hours from -12 to 14`);
    const dst = p.dst === undefined || p.dst === null || p.dst === "" ? "none" : String(p.dst);
    if (!(CLOCK_DST_MODES as readonly string[]).includes(dst)) throw new CompileError(`clock node's daylight saving "${dst}" must be eu or none`);
    const hour12 = p.hour12 === true;
    const seconds = p.seconds === true;
    const blink = p.blink === true;
    const nodeId = JSON.stringify(String(node.id));
    const s = ctx.uniqueName("clock");
    const secs = Math.round(offset * 3600);

    const timeFmt = hour12 ? `"%d:%02d" % (_lt[3] % 12 or 12, _lt[4])` : `"%02d:%02d" % (_lt[3], _lt[4])`;
    const body = [
      `global ${s}_synced, ${s}_tried, ${s}_at, ${s}_warned, ${s}_time, ${s}_date`,
      "_now = time.ticks_ms()",
      `if (${s}_tried is None or time.ticks_diff(_now, ${s}_tried) >= 30000) and (not ${s}_synced or time.ticks_diff(_now, ${s}_at) >= 3600000):`,
      `    ${s}_tried = _now`,
      "    if network.WLAN(network.STA_IF).isconnected():",
      "        try:",
      "            if ntptime is None:",
      '                raise OSError("this firmware has no ntptime module")',
      `            ntptime.host = ${JSON.stringify(host)}`,
      "            ntptime.settime()",
      `            ${s}_synced = True`,
      `            ${s}_at = _now`,
      `            ${s}_warned = False`,
      "        except Exception as _e:",
      `            if not ${s}_warned:`,
      `                ${s}_warned = True`,
      `                runtime._report_error(${nodeId}, _e)`,
      `if not ${s}_synced:`,
      "    return None",
      "_utc = time.time()",
      `_local = _utc + ${secs}` + (dst === "eu" ? " + (3600 if _eu_dst(_utc) else 0)" : ""),
      "_lt = time.localtime(_local)",
      `_t = ${timeFmt}`,
      ...(seconds ? [`_t = _t + ":%02d" % _lt[5]`] : []),
      ...(blink ? ["if _lt[5] % 2:", '    _t = _t.replace(":", " ", 1)'] : []),
      '_d = "%s %d %s" % (_DAYS[_lt[6]], _lt[2], _MONTHS[_lt[1] - 1])',
      "_topic = msg.get('topic', '')",
      "_out = [None, None]",
      `if _t != ${s}_time:`,
      `    ${s}_time = _t`,
      "    _out[0] = {'payload': _t, 'topic': _topic}",
      `if _d != ${s}_date:`,
      `    ${s}_date = _d`,
      "    _out[1] = {'payload': _d, 'topic': _topic}",
      "return _out if (_out[0] or _out[1]) else None",
    ].join("\n");

    return {
      imports: ["import time", "import network"],
      statements: [
        { key: "clock-helpers", code: CLOCK_HELPERS },
        {
          key: s,
          code: `${s}_synced = False\n${s}_tried = None\n${s}_at = 0\n${s}_warned = False\n${s}_time = None\n${s}_date = None`,
        },
      ],
      functionName: ctx.uniqueName("clock_fn"),
      functionBody: body,
    };
  },
};
