// journal (editor/src/node-library/journal.ts). Runs the generated transform in real CPython against a sequence of
// messages with pymock's runtime and time_mock's test-driven clock, and checks the series and the roll-ups it sends.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { journalNode } from "../src/node-library/journal.js";

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

const node = (properties: Record<string, unknown>): GraphNode => ({ id: "j1", type: "thingstudio/journal", properties });
const indent = (code: string) => code.split("\n").map((l) => (l.length ? "    " + l : l)).join("\n");

interface In {
  /** Python expression for msg['payload'] */
  py: string;
  at?: number;
  min?: number;
  max?: number;
}

/** One line per input: "series: [rows oldest first, '-' for a gap]" or "series: -" when no row was added, then
 * " | rollups: [(avg, min, max), ...]" (None for a gap). */
function run(properties: Record<string, unknown>, inputs: In[]): string[] {
  const r = journalNode.codegenTransform!(node(properties), freshCtx());
  const feed = inputs
    .map((m) => {
      const at = m.at === undefined ? "" : `    time_mock.CLOCK.now = ${m.at}\n`;
      const extra = `${m.min !== undefined ? `, 'min': ${m.min}` : ""}${m.max !== undefined ? `, 'max': ${m.max}` : ""}`;
      return `${at}    _show(await ${r.functionName}({'payload': ${m.py}, 'topic': 't'${extra}}))`;
    })
    .join("\n");
  const lines = [
    "import sys",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    "import runtime",
    "asyncio = runtime.asyncio",
    ...(r.imports ?? []),
    ...(r.statements ?? []).map((s) => s.code),
    "",
    `async def ${r.functionName}(msg):`,
    indent(r.functionBody),
    "",
    "def _rows(j):",
    "    start = (j.head - j.n) % j.rows",
    "    out = []",
    "    for i in range(j.n):",
    "        k = (start + i) % j.rows",
    "        a = j.avg[k]",
    "        out.append('-' if a != a else (round(a, 2), round(j.lo[k], 2), round(j.hi[k], 2)))",
    "    return out",
    "",
    "def _show(o):",
    "    if o is None:",
    "        print('dropped')",
    "        return",
    "    s = '-' if o[0] is None else _rows(o[0]['payload'])",
    "    r = [] if o[1] is None else [(None if m['payload'] is None else round(m['payload'], 2), None if m['min'] is None else round(m['min'], 2), None if m['max'] is None else round(m['max'], 2), m['topic']) for m in o[1]]",
    "    print('series:', s, '| rollups:', r)",
    "",
    "async def _main():",
    feed,
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-journal-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
  });
  return out.trim().split("\n");
}

describe("thingstudio/journal node", () => {
  describe("one row per message (stepSeconds 0)", () => {
    it("adds each reading as a row, oldest first, and sends the series every time", () => {
      const out = run({ rows: 10, stepSeconds: 0 }, [{ py: "1" }, { py: "2" }, { py: "3" }]);
      expect(out[0]).toBe("series: [(1.0, 1.0, 1.0)] | rollups: []");
      expect(out[2]).toBe("series: [(1.0, 1.0, 1.0), (2.0, 2.0, 2.0), (3.0, 3.0, 3.0)] | rollups: []");
    });

    it("keeps only the last `rows` rows", () => {
      const out = run({ rows: 3, stepSeconds: 0 }, [1, 2, 3, 4, 5].map((n) => ({ py: String(n) })));
      expect(out[4]).toBe("series: [(3.0, 3.0, 3.0), (4.0, 4.0, 4.0), (5.0, 5.0, 5.0)] | rollups: []");
    });

    it("records None as a gap, not a repeat of the last value", () => {
      const out = run({ rows: 5, stepSeconds: 0 }, [{ py: "4" }, { py: "None" }, { py: "6" }]);
      expect(out[2]).toBe("series: [(4.0, 4.0, 4.0), '-', (6.0, 6.0, 6.0)] | rollups: []");
    });

    it("takes min and max from the message when it has them (a cascaded roll-up)", () => {
      const out = run({ rows: 5, stepSeconds: 0 }, [{ py: "10", min: 5, max: 20 }]);
      expect(out[0]).toBe("series: [(10.0, 5.0, 20.0)] | rollups: []");
    });
  });

  describe("one row per time step", () => {
    it("closes a row when a reading arrives after the step, averaging what fell in it", () => {
      const out = run({ rows: 10, stepSeconds: 10 }, [
        { py: "10", at: 0 },
        { py: "20", at: 2000 },
        { py: "30", at: 11000 },
      ]);
      expect(out[0]).toBe("series: - | rollups: []"); // no row closed yet: nothing new to draw
      expect(out[1]).toBe("series: - | rollups: []");
      expect(out[2]).toBe("series: [(15.0, 10.0, 20.0)] | rollups: []");
    });

    it("fills a silence with gaps", () => {
      const out = run({ rows: 10, stepSeconds: 10 }, [
        { py: "10", at: 0 },
        { py: "30", at: 11000 },
        { py: "40", at: 45000 },
      ]);
      expect(out[2]).toBe("series: [(10.0, 10.0, 10.0), (30.0, 30.0, 30.0), '-', '-'] | rollups: []");
    });

    it("a very long silence fills the ring with gaps, not an endless loop", () => {
      const out = run({ rows: 4, stepSeconds: 1 }, [{ py: "1", at: 0 }, { py: "2", at: 100000000 }]);
      // Five closes (one more than the ring holds) push the reading out: all four rows are gaps.
      expect(out[1]).toBe("series: ['-', '-', '-', '-'] | rollups: []");
    });
  });

  describe("roll-ups", () => {
    it("sends the average, min and max every `steps` rows, with the input's topic", () => {
      const out = run({ rows: 10, stepSeconds: 0, steps: 3 }, [{ py: "1" }, { py: "2" }, { py: "6" }]);
      expect(out[1]).toContain("rollups: []");
      expect(out[2]).toContain("rollups: [(3.0, 1.0, 6.0, 't')]");
    });

    it("is a gap when more rows than `xff` allows were gaps", () => {
      const props = { rows: 10, stepSeconds: 0, steps: 3 };
      expect(run({ ...props, xff: 0.5 }, [{ py: "None" }, { py: "None" }, { py: "5" }])[2]).toContain("rollups: [(None, None, None, 't')]");
      expect(run({ ...props, xff: 0.7 }, [{ py: "None" }, { py: "None" }, { py: "5" }])[2]).toContain("rollups: [(5.0, 5.0, 5.0, 't')]");
    });

    it("averages over known rows only, never counting a gap as zero", () => {
      const out = run({ rows: 10, stepSeconds: 0, steps: 4, xff: 0.5 }, [{ py: "10" }, { py: "None" }, { py: "20" }, { py: "30" }]);
      expect(out[3]).toContain("rollups: [(20.0, 10.0, 30.0, 't')]");
    });

    it("keeps min and max through a cascade", () => {
      const out = run({ rows: 10, stepSeconds: 0, steps: 2 }, [{ py: "10", min: 2, max: 11 }, { py: "20", min: 15, max: 90 }]);
      expect(out[1]).toContain("rollups: [(15.0, 2.0, 90.0, 't')]");
    });
  });

  describe("bad input", () => {
    it("reports a non-number once and adds no row", () => {
      const out = run({ rows: 5, stepSeconds: 0 }, [{ py: "'hot'" }, { py: "'cold'" }, { py: "7" }]);
      expect(out.filter((l) => l.includes("NODE_ERROR")).length).toBe(1);
      expect(out.filter((l) => l === "dropped").length).toBe(2);
      expect(out[out.length - 1]).toBe("series: [(7.0, 7.0, 7.0)] | rollups: []");
    });
  });

  describe("properties", () => {
    const refuse = (props: Record<string, unknown>, re: RegExp) => expect(() => journalNode.codegenTransform!(node(props), freshCtx())).toThrow(re);
    it("refuses values that make no sense, saying which", () => {
      refuse({ rows: 0 }, /rows "0" must be a whole number from 1 to 256/);
      refuse({ rows: 1000 }, /rows "1000"/);
      refuse({ stepSeconds: -1 }, /seconds per row "-1"/);
      refuse({ steps: 1.5 }, /rows per roll-up "1.5"/);
      refuse({ xff: 2 }, /gaps allowed "2"/);
      expect(() => journalNode.codegenTransform!(node({ rows: 0 }), freshCtx())).toThrow(CompileError);
    });
  });
});
