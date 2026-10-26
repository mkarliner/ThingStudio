// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/journal.ts
//
// A rolling archive of one number as a core package (node-format-parity phase 4, option A). The descriptor is
// the TypeScript journal.ts's data half (two outputs: series, rollup); the `.node.py` is its codegen ported. The
// built-in emitted the `_Journal` class once per flow (a keyed setup statement); a package defines it inside the
// one per-instance closure, so two journals carry two copies -- they are small and behaviour is identical (the
// accepted package-vs-built-in difference, builtins-as-packages-scoping.md §14).

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const JOURNAL_MAX_ROWS = 256;
/** The `rows kept` default: how many columns a default histogram is told to expect (core-packages/journal.ts and
 * gui/screens.ts's warning about a journal too short for its histogram both read this). */
export const JOURNAL_DEFAULT_ROWS = 60;

export const descriptor: NodeDescriptor = {
  type: "thingstudio/journal",
  kind: "transform",
  paletteId: "journal",
  label: "journal",
  group: "general",
  priority: 36,
  color: "#2e6e4a",
  bgcolor: "#1f3f2c",
  icon: "≋",
  width: 100,
  description:
    "Keeps the last rows of a number, as an average with its min and max. The first output sends the series (wire " +
    "it to a histogram); the second sends one summary message every roll-up (wire it to the next journal for a longer " +
    "time scale). Rows with no readings are gaps. With seconds per row set, a row closes when a message arrives " +
    "after its time is up.",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [
      { name: "series", type: "any" },
      { name: "rollup", type: "any" },
    ],
  },
  properties: [
    { name: "rows", label: "rows kept", kind: "number", default: JOURNAL_DEFAULT_ROWS, min: 1, max: 256 },
    { name: "stepSeconds", label: "seconds per row (0 = one row per message)", kind: "number", default: 60, min: 0, step: "any" },
    { name: "steps", label: "rows per roll-up (0 = none)", kind: "number", default: 0, min: 0 },
    { name: "xff", label: "gaps allowed in a roll-up (0 to 1)", kind: "number", default: 0.5, min: 0, max: 1, step: 0.05, visibleWhen: { field: "steps", gt: 0 } },
    { name: "nodeId", label: "node id", kind: "nodeId", default: "" },
  ],
};

export const python = `import array
import time

_node_id = properties['nodeId']
_rows = properties['rows']
_steps = properties['steps']
_xff = properties['xff']
_step_ms = round(properties['stepSeconds'] * 1000)
_warned = False

_NAN = float('nan')


class _Journal:
    def __init__(self, rows, step_ms, steps, xff):
        self.rows = rows
        self.avg = array.array('f', [_NAN] * rows)
        self.lo = array.array('f', [_NAN] * rows)
        self.hi = array.array('f', [_NAN] * rows)
        self.n = 0
        self.head = 0
        self.total = 0
        self.step_ms = step_ms
        self.steps = steps
        self.xff = xff
        self.start = None
        self.s = 0.0
        self.c = 0
        self.mn = _NAN
        self.mx = _NAN
        self.cur = 0
        self.cs = 0.0
        self.cc = 0
        self.cmn = _NAN
        self.cmx = _NAN

    def _row(self, a, lo, hi, out):
        i = self.head
        self.avg[i] = a
        self.lo[i] = lo
        self.hi[i] = hi
        self.head = (i + 1) % self.rows
        if self.n < self.rows:
            self.n += 1
        self.total += 1
        if not self.steps:
            return
        self.cur += 1
        if a == a:
            self.cs += a
            self.cc += 1
            if self.cmn != self.cmn or lo < self.cmn:
                self.cmn = lo
            if self.cmx != self.cmx or hi > self.cmx:
                self.cmx = hi
        if self.cur >= self.steps:
            if self.cc and (self.steps - self.cc) <= self.xff * self.steps:
                out.append((self.cs / self.cc, self.cmn, self.cmx))
            else:
                out.append((None, None, None))
            self.cur = 0
            self.cs = 0.0
            self.cc = 0
            self.cmn = _NAN
            self.cmx = _NAN

    def _close(self, out):
        if self.c:
            self._row(self.s / self.c, self.mn, self.mx, out)
        else:
            self._row(_NAN, _NAN, _NAN, out)
        self.s = 0.0
        self.c = 0
        self.mn = _NAN
        self.mx = _NAN

    def add(self, v, lo, hi, now):
        """Takes one reading; returns (the series changed, the roll-ups produced)."""
        out = []
        before = self.total
        if not self.step_ms:
            if v is None:
                self._row(_NAN, _NAN, _NAN, out)
            else:
                self._row(v, lo, hi, out)
            return self.total != before, out
        if self.start is None:
            self.start = now
        k = time.ticks_diff(now, self.start) // self.step_ms
        if k > 0:
            for _ in range(k if k < self.rows + 1 else self.rows + 1):
                self._close(out)
            self.start = time.ticks_add(self.start, k * self.step_ms)
        if v is not None:
            self.s += v
            self.c += 1
            if self.mn != self.mn or lo < self.mn:
                self.mn = lo
            if self.mx != self.mx or hi > self.mx:
                self.mx = hi
        return self.total != before, out


_j = _Journal(_rows, _step_ms, _steps, _xff)


async def run(msg, properties):
    nonlocal _warned
    _v = msg.get('payload')
    _lo = msg.get('min')
    _hi = msg.get('max')
    if _v is not None:
        try:
            _v = float(_v)
        except (TypeError, ValueError):
            if not _warned:
                _warned = True
                runtime._report_error(_node_id, ValueError("journal needs a number, got %s %r" % (type(_v).__name__, _v)))
            return None
        _warned = False
        _lo = _v if _lo is None else float(_lo)
        _hi = _v if _hi is None else float(_hi)
    _changed, _out = _j.add(_v, _lo, _hi, time.ticks_ms())
    _topic = msg.get('topic', '')
    _series = {'payload': _j, 'topic': _topic} if _changed else None
    _roll = [{'payload': a, 'min': l, 'max': h, 'topic': _topic} for (a, l, h) in _out]
    return [_series, _roll if _roll else None]
`;
