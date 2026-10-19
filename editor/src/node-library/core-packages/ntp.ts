// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/ntp.ts
//
// ntp as a two-faced core package (2026-10-19): a sink whose input asks for the time now, and an event source that
// sends after each sync and once per input after that. Both faces come from one closure (the package format's
// two-faced sink), so the _Ntp instance and its state are shared. The hook validates the time-zone settings and
// derives the flow's WiFi config; the Python is the built-in's helper class and sync loop unchanged.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";
import { WIFI_DERIVATION } from "./compile-hooks.js";

export const descriptor: NodeDescriptor = {
  type: "thingstudio/ntp",
  kind: "sink",
  eventSource: true,
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
    { name: "wifiConfigId", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const compileHook = `${WIFI_DERIVATION}
import re

def compile(ctx, properties):
    server = str(properties.get('server') or '').strip() or 'pool.ntp.org'
    if not re.match(r'^[A-Za-z0-9.-]+$', server):
        return {'errors': ['ntp server "' + server + '" must be a host name such as pool.ntp.org']}
    try:
        offset = float(properties.get('utcOffset', 0) or 0)
    except (TypeError, ValueError):
        return {'errors': ['ntp UTC offset must be a number']}
    if offset < -12 or offset > 14:
        return {'errors': ['ntp UTC offset must be hours from -12 to 14']}
    dst = str(properties.get('dst') or 'eu')
    if dst not in ('eu', 'none'):
        return {'errors': ['ntp daylight saving must be eu or none']}
    fmt = str(properties.get('format') or 'time')
    if fmt not in ('unix', 'time', 'time_seconds', 'time_12h', 'date', 'date_iso', 'iso'):
        return {'errors': ['ntp format "' + fmt + '" is not recognised']}

    wifi, err = _ts_wifi(ctx)
    if err:
        return {'errors': [err]}
    wifi['server'] = server
    wifi['offsetSeconds'] = int(round(offset * 3600))
    wifi['dstIsEu'] = dst == 'eu'
    wifi['format'] = fmt
    warnings = []
    if not ctx['node'].get('wired', {}).get('outputs', [True])[0]:
        warnings.append('sends the time nowhere: wire its output to something')
    return {'properties': wifi, 'warnings': warnings}
`;

export const NTP_HELPERS = `try:
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

export const python = `import time
import network
import ts_wifi

${NTP_HELPERS}


_N = _Ntp(properties['nodeId'], properties['server'], properties['offsetSeconds'], properties['dstIsEu'])

ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])


async def run(msg, properties):
    _N.poke()


async def wait(properties):
    await _N.wait()


async def emit(properties):
    return _N.msg(properties['format'])
`;
