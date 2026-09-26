// filter (editor/src/node-library/filter.ts). Runs the generated transform in real CPython against a
// sequence of messages, with pymock's runtime and time_mock (a test-driven clock, installed as
// sys.modules["time"] -- see fixtures/pymock/time_mock.py), and checks which messages come out.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { FILTER_MAX_TOPICS, filterNode } from "../src/node-library/filter.js";

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
      throw new Error(`unexpected resolveConfig("${id}") -- filter reads no config nodes`);
    },
  };
}

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "f1", type: "thingstudio/filter", properties };
}

function indent(code: string): string {
  return code
    .split("\n")
    .map((l) => (l.length ? "    " + l : l))
    .join("\n");
}

/** One input message: payload as a Python literal, optional topic, optional clock time (ms). */
interface In {
  py: string;
  topic?: string;
  at?: number;
}

/** Feeds `inputs` through the filter in order. Returns one line per input: the passed payload's repr,
 * or "-" for a dropped message; plus any other printed lines (NODE_ERROR, FILTER_INFO). */
function run(properties: Record<string, unknown>, inputs: In[]): string[] {
  const r = filterNode.codegenTransform!(node(properties), freshCtx());
  const feed = inputs
    .map((m) => {
      const at = m.at === undefined ? "" : `    time_mock.CLOCK.now = ${m.at}\n`;
      return `${at}    _out = await ${r.functionName}({'payload': ${m.py}, 'topic': ${JSON.stringify(m.topic ?? "")}})\n    print('-' if _out is None else repr(_out['payload']))`;
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
    "async def _main():",
    feed,
    "",
    "asyncio.run(_main())",
  ];
  const dir = mkdtempSync(join(tmpdir(), "thingstudio-filter-"));
  const scriptPath = join(dir, "_snippet.py");
  writeFileSync(scriptPath, lines.join("\n"));
  const out = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: join(__dirname, "fixtures", "pymock") },
    encoding: "utf8",
  });
  return out.trim().split("\n");
}

describe("thingstudio/filter node", () => {
  describe("change", () => {
    it("passes the first message and each change, drops repeats", () => {
      expect(run({ mode: "change" }, [{ py: "1" }, { py: "1" }, { py: "2" }, { py: "2" }, { py: "1" }])).toEqual(["1", "-", "2", "-", "1"]);
    });

    it("compares strings, bools and dicts by value", () => {
      expect(run({}, [{ py: "'on'" }, { py: "'on'" }, { py: "{'a': 1}" }, { py: "{'a': 1}" }, { py: "True" }, { py: "True" }])).toEqual([
        "'on'",
        "-",
        "{'a': 1}",
        "-",
        "True",
        "-",
      ]);
    });

    it("ignore first: the first message only sets the starting value", () => {
      expect(run({ mode: "change", ignoreFirst: true }, [{ py: "1" }, { py: "1" }, { py: "2" }])).toEqual(["-", "-", "2"]);
    });

    it("tracks each topic separately by default", () => {
      expect(run({ mode: "change" }, [{ py: "1", topic: "a" }, { py: "1", topic: "b" }, { py: "1", topic: "a" }])).toEqual(["1", "1", "-"]);
    });

    it("with per topic off, all topics share one value", () => {
      expect(run({ mode: "change", perTopic: false }, [{ py: "1", topic: "a" }, { py: "1", topic: "b" }])).toEqual(["1", "-"]);
    });

    it(`clears its table past ${FILTER_MAX_TOPICS} topics, saying so once`, () => {
      const topics = Array.from({ length: FILTER_MAX_TOPICS + 2 }, (_, i) => ({ py: "1", topic: `t${i}` }));
      const out = run({ mode: "change" }, [...topics, { py: "1", topic: "t0" }]);
      expect(out.filter((l) => l.startsWith("FILTER_INFO"))).toEqual([`FILTER_INFO node=f1 more than ${FILTER_MAX_TOPICS} topics, starting again`]);
      // t0 was forgotten in the clear, so its repeat passes again.
      expect(out[out.length - 1]).toBe("1");
    });
  });

  describe("deadband", () => {
    it("passes when the value has moved at least threshold from the last PASSED value, either direction", () => {
      const out = run({ mode: "deadband", threshold: 1 }, [
        { py: "20.0" },
        { py: "20.4" },
        { py: "20.8" },
        { py: "21.1" }, // 1.1 above 20.0
        { py: "20.5" }, // 0.6 below 21.1
        { py: "20.0" }, // 1.1 below 21.1
      ]);
      expect(out).toEqual(["20.0", "-", "-", "21.1", "-", "20.0"]);
    });

    it("parses numeric strings and bytes, and sends the original payload unchanged", () => {
      expect(run({ mode: "deadband", threshold: 1 }, [{ py: "'20.0'" }, { py: "b'20.5'" }, { py: "b'21.5'" }])).toEqual(["'20.0'", "-", "b'21.5'"]);
    });

    it("threshold 0 passes any change", () => {
      expect(run({ mode: "deadband", threshold: 0 }, [{ py: "1" }, { py: "1.5" }])).toEqual(["1", "1.5"]);
    });

    it("drops non-numbers and reports once, until a number arrives", () => {
      const out = run({ mode: "deadband", threshold: 1 }, [{ py: "'abc'" }, { py: "True" }, { py: "5" }, { py: "float('nan')" }]);
      expect(out).toEqual([
        "NODE_ERROR node=f1 type=ValueError msg=deadband needs a number, got str 'abc'",
        "-",
        "-",
        "5",
        "NODE_ERROR node=f1 type=ValueError msg=deadband needs a number, got float nan",
        "-",
      ]);
    });

    it("ignore first works here too", () => {
      expect(run({ mode: "deadband", threshold: 1, ignoreFirst: true }, [{ py: "20" }, { py: "22" }])).toEqual(["-", "22"]);
    });
  });

  describe("rate", () => {
    it("passes at most one message per interval, dropping the rest", () => {
      const out = run({ mode: "rate", intervalMs: 1000 }, [
        { py: "1", at: 0 },
        { py: "2", at: 500 },
        { py: "3", at: 999 },
        { py: "4", at: 1000 },
        { py: "5", at: 1500 },
        { py: "6", at: 2100 },
      ]);
      expect(out).toEqual(["1", "-", "-", "4", "-", "6"]);
    });

    it("limits each topic separately", () => {
      const out = run({ mode: "rate", intervalMs: 1000 }, [
        { py: "1", topic: "a", at: 0 },
        { py: "2", topic: "b", at: 100 },
        { py: "3", topic: "a", at: 200 },
      ]);
      expect(out).toEqual(["1", "2", "-"]);
    });
  });

  describe("properties", () => {
    it("rejects an unknown mode", () => {
      expect(() => filterNode.codegenTransform!(node({ mode: "sometimes" }), freshCtx())).toThrow(CompileError);
    });

    it("rejects a negative or non-numeric threshold", () => {
      for (const threshold of [-1, "abc"]) {
        expect(() => filterNode.codegenTransform!(node({ mode: "deadband", threshold }), freshCtx())).toThrow(CompileError);
      }
    });

    it("rejects a zero, negative or fractional interval", () => {
      for (const intervalMs of [0, -5, 1.5, "abc"]) {
        expect(() => filterNode.codegenTransform!(node({ mode: "rate", intervalMs }), freshCtx())).toThrow(CompileError);
      }
    });
  });

  it("two filters in one flow keep separate state and share the number helper", () => {
    const graph = {
      nodes: [
        { id: "t1", type: "thingstudio/timer", properties: { intervalMs: 100 } },
        { id: "fa", type: "thingstudio/filter", properties: { mode: "deadband" } },
        { id: "fb", type: "thingstudio/filter", properties: { mode: "deadband" } },
        { id: "d1", type: "thingstudio/debug", properties: {} },
      ],
      links: [
        [1, "t1", 0, "fa", 0, "any"],
        [2, "fa", 0, "fb", 0, "any"],
        [3, "fb", 0, "d1", 0, "any"],
      ],
    } as Parameters<typeof compile>[0];
    const { source } = compile(graph, buildRegistry());
    expect(source.match(/def _filter_num\(/g)).toHaveLength(1);
    expect(source).toContain("_filter_state = {}");
    expect(source).toContain("_filter_state_1 = {}");
  });
});
