// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/journal.ts
//
// A rolling archive of one number, in the style of RRDtool (2026-10-10; the decisions are in
// docs/working-notes/decisions/gui-layout.md, 2026-10-07). Each row holds the average, min and max of the
// readings in one time step; unknown is a gap (NaN), never a repeated last value.
//
//   input    msg.payload a number (None records a gap). A msg carrying `min`/`max` (the roll-up of another
//            journal) is folded in with those, so a long time scale keeps the spikes.
//   output 1 "series": every time a row is added, msg.payload is the journal itself, to wire to a trend. It is the
//            live ring, not a copy, so nothing is allocated per row: rows, n, head and the avg/lo/hi rings.
//   output 2 "rollup": every `steps` rows, a normal msg for the next journal, a readout or MQTT:
//            payload the average, min, max, topic as the input's. Gap if more than `xff` of those rows were gaps.
//
// Two ways to count rows: `stepSeconds` > 0 closes a row once that much time has passed (checked when a message
// arrives, so a sensor that falls silent doesn't add gaps until it speaks again; the trend widget's stale-after
// covers that); 0 makes every message one row, which is what a downstream journal wants.
//
// The ring is three array('f') of `rows` floats, 12 bytes a row. The class is written into the compiled source once
// however many journals the flow has.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext, NodeDefinition, TransformCodegenResult } from "../compiler/node-definition.js";

export const JOURNAL_MAX_ROWS = 256;

const JOURNAL_CLASS = `_NAN = float('nan')

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
`;

function intProp(node: GraphNode, key: string, fallback: number, min: number, max: number, what: string): number {
  const raw = node.properties[key];
  const n = raw === undefined || raw === null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new CompileError(`journal node's ${what} "${String(raw)}" must be a whole number from ${min} to ${max}`);
  return n;
}

export const journalNode: NodeDefinition = {
  type: "thingstudio/journal",
  kind: "transform",
  ports: {
    inputs: [{ name: "msg", type: "any" }],
    outputs: [
      { name: "series", type: "any" },
      { name: "rollup", type: "any" },
    ],
  },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const rows = intProp(node, "rows", 60, 1, JOURNAL_MAX_ROWS, "rows");
    const steps = intProp(node, "steps", 0, 0, 100000, "rows per roll-up");
    const stepSecondsRaw = node.properties.stepSeconds;
    const stepSeconds = stepSecondsRaw === undefined || stepSecondsRaw === null || stepSecondsRaw === "" ? 0 : Number(stepSecondsRaw);
    if (!Number.isFinite(stepSeconds) || stepSeconds < 0) throw new CompileError(`journal node's seconds per row "${String(stepSecondsRaw)}" must be 0 or more`);
    const stepMs = Math.round(stepSeconds * 1000);
    if (stepSeconds > 0 && stepMs < 1) throw new CompileError(`journal node's seconds per row "${String(stepSecondsRaw)}" is under a millisecond`);
    const xffRaw = node.properties.xff;
    const xff = xffRaw === undefined || xffRaw === null || xffRaw === "" ? 0.5 : Number(xffRaw);
    if (!Number.isFinite(xff) || xff < 0 || xff > 1) throw new CompileError(`journal node's gaps allowed "${String(xffRaw)}" must be from 0 to 1`);
    const nodeId = JSON.stringify(String(node.id));
    const j = ctx.uniqueName("journal");
    const warned = ctx.uniqueName("journal_warned");

    const body = [
      `global ${warned}`,
      "_v = msg.get('payload')",
      "_lo = msg.get('min')",
      "_hi = msg.get('max')",
      "if _v is not None:",
      "    try:",
      "        _v = float(_v)",
      "    except (TypeError, ValueError):",
      `        if not ${warned}:`,
      `            ${warned} = True`,
      `            runtime._report_error(${nodeId}, ValueError("journal needs a number, got %s %r" % (type(_v).__name__, _v)))`,
      "        return None",
      `    ${warned} = False`,
      "    _lo = _v if _lo is None else float(_lo)",
      "    _hi = _v if _hi is None else float(_hi)",
      `_changed, _out = ${j}.add(_v, _lo, _hi, time.ticks_ms())`,
      "_topic = msg.get('topic', '')",
      `_series = {'payload': ${j}, 'topic': _topic} if _changed else None`,
      "_roll = [{'payload': a, 'min': l, 'max': h, 'topic': _topic} for (a, l, h) in _out]",
      "return [_series, _roll if _roll else None]",
    ].join("\n");

    return {
      imports: ["import array", "import time"],
      statements: [
        { key: "journal-class", code: JOURNAL_CLASS },
        { key: j, code: `${j} = _Journal(${rows}, ${stepMs}, ${steps}, ${xff})\n${warned} = False` },
      ],
      functionName: ctx.uniqueName("journal_fn"),
      functionBody: body,
    };
  },
};
