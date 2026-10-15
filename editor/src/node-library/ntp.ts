// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/ntp.ts
//
// The time of day from NTP (2026-10-14; replaces `clock`, docs/working-notes/outstanding-items/
// ntp-node-replaces-clock.md, decisions/gui-layout.md). The ntp node does one job: keep the board's clock right and
// say what time it is. Showing the time is the display's job (a gui label, with a seg7 font if wanted).
//
// Two-faced (compiler/node-definition.ts, codegenEventSource): the input face asks for the time now (wire a timer
// in for a ticking display); the output face sends one message after each successful sync, and one per input once
// synced. Nothing is sent before the first sync, so a label shows "unknown", not a wrong time.
//
// Each message carries every format as its own field, and `payload` is the one the `format` property picks:
//   unix          1791995667 (int, seconds since 1970 UTC; true UTC whatever the offset)
//   time          "14:05"
//   time_seconds  "14:05:09"
//   time_12h      "2:05 pm"
//   date          "Wed 14 Oct"
//   date_iso      "2026-10-14"
//   iso           "2026-10-14T14:05:09+01:00"
//
// The node joins WiFi itself, through the flow's one WiFi config, like udp_send: a flow with no WiFi config does
// not compile. The old clock node only checked isconnected() and showed "--" for ever in a flow with nothing else
// that joined WiFi.
//
// Sync: ntptime.settime() sets the board's RTC to UTC (blocks up to about a second). Tried as soon as WiFi is up
// (checked every 2 s), retried every 30 s after a failure, repeated hourly. The RTC stays on UTC; the UTC offset and
// UK/EU summer time (01:00 UTC on the last Sunday of March to the last Sunday of October) are applied when a message
// is built, so the hour changes on time rather than at the next sync, and `unix` stays true UTC. The time-zone
// settings still live on this node (Mike, 2026-10-14). Other countries' summer-time rules are not built in.
//
// Faults: the status dot shows waiting for WiFi / synced / the failed server; the first failure in a run of failures
// also goes to the console with the server name. A firmware without ntptime says so instead of failing at boot.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type {
  CodegenContext,
  EventSourceCodegenResult,
  NodeDefinition,
  SinkCodegenResult,
  SetupCode,
} from "../compiler/node-definition.js";
import { flowHasMqttNodes, resolveFlowWifiCredentials, wifiSetupStatement } from "./wifi-status.js";

export const NTP_DST_MODES = ["eu", "none"] as const;
export const NTP_FORMATS = ["unix", "time", "time_seconds", "time_12h", "date", "date_iso", "iso"] as const;
export type NtpFormat = (typeof NTP_FORMATS)[number];

// Shared by every ntp node in a flow (statement key "ntp-helpers").
const NTP_HELPERS = `try:
    import ntptime
except ImportError:
    ntptime = None

_NTP_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_NTP_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
# Seconds to add to time.time() for Unix time: 0 where the board's epoch is 1970, 946684800 where it is 2000.
_NTP_UNIX = 946684800 - time.mktime((2000, 1, 1, 0, 0, 0, 0, 0, 0))

def _ntp_last_sunday(y, m):
    wd = time.localtime(time.mktime((y, m, 31, 1, 0, 0, 0, 0, 0)))[6]
    return 31 - (wd + 1) % 7

def _ntp_eu_dst(utc):
    y = time.localtime(utc)[0]
    start = time.mktime((y, 3, _ntp_last_sunday(y, 3), 1, 0, 0, 0, 0, 0))
    end = time.mktime((y, 10, _ntp_last_sunday(y, 10), 1, 0, 0, 0, 0, 0))
    return start <= utc < end

class _Ntp:
    def __init__(self, nid, host, offset, dst):
        self.nid = nid
        self.host = host
        self.offset = offset
        self.dst = dst
        self.synced = False
        self.failing = False
        self.due = None
        self.shown = None
        self.evt = None

    def _status(self, state, text):
        if self.shown != (state, text):
            self.shown = (state, text)
            runtime.report_status(self.nid, state, text)

    def poke(self):
        if self.evt is None:
            self.evt = asyncio.Event()
        self.evt.set()

    def _sync(self):
        now = time.ticks_ms()
        if not network.WLAN(network.STA_IF).isconnected():
            self.due = time.ticks_add(now, 2000)
            if not self.synced:
                self._status('connecting', 'waiting for WiFi')
            return False
        try:
            if ntptime is None:
                raise OSError("this firmware has no ntptime module")
            ntptime.host = self.host
            ntptime.settime()
        except Exception as e:
            self.due = time.ticks_add(now, 30000)
            if not self.failing:
                self.failing = True
                runtime._report_error(self.nid, OSError("NTP from %s failed: %r" % (self.host, e)))
            self._status('error', "NTP from %s failed" % self.host)
            return False
        self.synced = True
        self.failing = False
        self.due = time.ticks_add(now, 3600000)
        self._status('connected', 'synced')
        return True

    async def wait(self):
        if self.evt is None:
            self.evt = asyncio.Event()
        while True:
            left = 0 if self.due is None else time.ticks_diff(self.due, time.ticks_ms())
            if left <= 0:
                if self._sync():
                    return
                continue
            try:
                await asyncio.wait_for(self.evt.wait(), left / 1000)
            except asyncio.TimeoutError:
                continue
            self.evt.clear()
            if self.synced:
                return

    def msg(self, fmt):
        t = int(time.time())
        loc = t + self.offset + (3600 if self.dst and _ntp_eu_dst(t) else 0)
        lt = time.localtime(loc)
        o = loc - t
        hm = "%02d:%02d" % (lt[3], lt[4])
        m = {
            'unix': t + _NTP_UNIX,
            'time': hm,
            'time_seconds': hm + ":%02d" % lt[5],
            'time_12h': "%d:%02d %s" % (lt[3] % 12 or 12, lt[4], "am" if lt[3] < 12 else "pm"),
            'date': "%s %d %s" % (_NTP_DAYS[lt[6]], lt[2], _NTP_MONTHS[lt[1] - 1]),
            'date_iso': "%04d-%02d-%02d" % (lt[0], lt[1], lt[2]),
            'iso': "%04d-%02d-%02dT%02d:%02d:%02d%s%02d:%02d" % (
                lt[0], lt[1], lt[2], lt[3], lt[4], lt[5], "-" if o < 0 else "+", abs(o) // 3600, abs(o) % 3600 // 60),
        }
        m['payload'] = m[fmt]
        m['topic'] = ''
        return m`;

interface NtpConfig {
  host: string;
  offsetSeconds: number;
  dst: (typeof NTP_DST_MODES)[number];
  format: NtpFormat;
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

export function ntpConfig(node: GraphNode): NtpConfig {
  const p = node.properties;
  const host = blank(p.server) ? "pool.ntp.org" : String(p.server).trim();
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new CompileError(`ntp node's NTP server "${host}" must be a host name such as pool.ntp.org`);
  const offset = blank(p.utcOffset) ? 0 : Number(p.utcOffset);
  if (!Number.isFinite(offset) || offset < -12 || offset > 14) {
    throw new CompileError(`ntp node's UTC offset "${String(p.utcOffset)}" must be hours from -12 to 14`);
  }
  const dst = blank(p.dst) ? "eu" : String(p.dst);
  if (!(NTP_DST_MODES as readonly string[]).includes(dst)) throw new CompileError(`ntp node's daylight saving "${dst}" must be eu or none`);
  const format = blank(p.format) ? "time" : String(p.format);
  if (!(NTP_FORMATS as readonly string[]).includes(format)) {
    throw new CompileError(`ntp node's format "${format}" must be one of ${NTP_FORMATS.join(", ")}`);
  }
  return { host, offsetSeconds: Math.round(offset * 3600), dst: dst as NtpConfig["dst"], format: format as NtpFormat };
}

/** The setup both faces share: helpers, this node's _Ntp instance, and the flow's WiFi join. */
function ntpSetup(node: GraphNode, ctx: CodegenContext): SetupCode & { instance: string } {
  const c = ntpConfig(node);
  const { ssid, password, security } = resolveFlowWifiCredentials(ctx, "ntp node");
  const instance = `_ntp_${String(node.id).replace(/[^A-Za-z0-9_]/g, "_")}`;
  return {
    instance,
    imports: ["import time", "import network"],
    statements: [
      { key: "ntp-helpers", code: NTP_HELPERS },
      {
        key: instance,
        code: `${instance} = _Ntp(${JSON.stringify(String(node.id))}, ${JSON.stringify(c.host)}, ${c.offsetSeconds}, ${c.dst === "eu" ? "True" : "False"})`,
      },
      // Same deferToMqtt call as udp-send.ts: the shared "wifi-sta" statement is first-writer-wins.
      wifiSetupStatement(ssid, password, security, flowHasMqttNodes(ctx)),
    ],
  };
}

export const ntpNode: NodeDefinition = {
  type: "thingstudio/ntp",
  kind: "sink",
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "ntp",
  label: "ntp",
  group: "network",
  priority: 15,
  color: "#1f5c6e",
  bgcolor: "#12343f",
  icon: "◷",
  width: 84,
  description:
    "Sends the time after each sync, and for each message in once synced: wire a timer in (1 s with seconds) for " +
    "a clock that ticks. Format picks the payload; every message also has all the formats as fields. The offset is " +
    "for standard time; UK / EU adds the summer hour itself.",
  // Useful with nothing wired in: it still sends after each sync.
  allowUnwired: true,
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [{ name: "msg", type: "any" }],
  },
  properties: [
    { name: "server", label: "NTP server", kind: "text", default: "pool.ntp.org" },
    { name: "utcOffset", label: "UTC offset (hours)", kind: "number", default: 0, min: -12, max: 14, step: 0.5 },
    {
      name: "dst",
      label: "daylight saving",
      kind: "select",
      default: "eu",
      options: [
        { value: "eu", label: "UK / EU: automatic" },
        { value: "none", label: "none" },
      ],
    },
    {
      name: "format",
      label: "format",
      kind: "select",
      default: "time",
      options: [
        { value: "time", label: "time (14:05)" },
        { value: "time_seconds", label: "time with seconds (14:05:09)" },
        { value: "time_12h", label: "12-hour time (2:05 pm)" },
        { value: "date", label: "date (Wed 14 Oct)" },
        { value: "date_iso", label: "ISO date (2026-10-14)" },
        { value: "iso", label: "ISO date and time" },
        { value: "unix", label: "Unix time (seconds)" },
      ],
    },
    // Info-only: the WiFi config is a flow singleton, not a property of this node.
    { kind: "configRef", configType: "thingstudio/config/wifi", label: "WiFi" },
  ],
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const { instance, imports, statements } = ntpSetup(node, ctx);
    return { imports, statements, functionName: ctx.uniqueName("ntp_in"), functionBody: `${instance}.poke()` };
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const { instance, imports, statements } = ntpSetup(node, ctx);
    const c = ntpConfig(node);
    if (ctx.isOutputWired?.(node.id) === false) {
      ctx.warn?.(`ntp node ${node.id} sends the time nowhere: wire its output to something.`);
    }
    return {
      imports,
      statements,
      waitStatement: `await ${instance}.wait()`,
      buildMsg: `msg = ${instance}.msg(${JSON.stringify(c.format)})`,
    };
  },
};
