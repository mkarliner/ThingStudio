// outstanding-items.md's "[P4] eswitch/ebutton nodes" item -- ebutton.ts's
// own header has the full design story. See node-eswitch.test.ts's header
// for why this file's behavioral tests can run the REAL vendored driver
// (device-runtime/src/vendor/primitives_events/{events,delay_ms}.py)
// through a real CPython asyncio loop, unlike interrupt.ts's tests.
//
// The double-click scenario below is also the regression test for a real
// bug found and fixed while building this node (ebutton.ts's/eswitch.ts's
// own header, and events.py's own WaitAny behavior): EButton can set BOTH
// `press` and `double` in the same synchronous call (a rapid second click,
// with `suppress=False` -- press always fires unconditionally, and the
// double-click timer still running also fires double). Clearing every
// event WaitAny watches after each wake (instead of only the one that
// fired) would silently drop whichever of the two lost the internal race
// -- this test proves both are actually reported, not just one.

import { execFileSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";
import { ebuttonNode } from "../src/node-library/ebutton.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pymockDir = join(__dirname, "fixtures", "pymock");
const vendorDir = join(__dirname, "..", "..", "device-runtime", "src", "vendor", "primitives_events");

let uniqueCounter = 0;
const ctx: CodegenContext = {
  uniqueName: (hint) => `_${hint}_${++uniqueCounter}`,
  resolveConfig: (id) => {
    throw new Error(`unexpected resolveConfig("${id}") call -- this test file's ctx doesn't stub any configs`);
  },
};

function node(properties: Record<string, unknown>): GraphNode {
  return { id: "1", type: "thingstudio/ebutton", properties };
}

/**
 * Same harness as node-eswitch.test.ts's runScheduledFlow/buildRunnerScript
 * -- see that file's header for why the whole compiled source has to be
 * wrapped in a real running event loop with a local `runtime.spawn`
 * override, not run as a bare top-level script: EButton's own constructor
 * builds Delay_ms instances (device-runtime/src/vendor/primitives_events/
 * delay_ms.py) whose `__init__` calls `asyncio.create_task()` directly,
 * same real requirement as ESwitch.
 */
function buildRunnerScript(source: string, scheduleLiteral: string, maxRunS: number): string {
  const outerPreamble = [
    "import time",
    "_real_t0 = time.monotonic()",
    "import machine",
    "import sys",
    "import time_mock",
    'sys.modules["time"] = time_mock',
    `machine.Pin.SCHEDULE = {${scheduleLiteral}}`,
    "machine.Pin.T0 = _real_t0",
    "import asyncio as _real_asyncio",
    "import runtime as _runtime_mod",
    "",
    "async def _real_spawn_coro(coro, node_id):",
    "    try:",
    "        await coro",
    "    except Exception as e:",
    '        print("NODE_ERROR node=%s type=%s msg=%s" % (node_id, type(e).__name__, str(e)))',
    "",
    "def _real_spawn(coro, node_id=None):",
    "    return _real_asyncio.create_task(_real_spawn_coro(coro, node_id))",
    "",
    "_runtime_mod.spawn = _real_spawn",
    "",
    "async def _flow_main():",
  ];
  const indentedSource = source
    .split("\n")
    .map((l) => (l.length ? `    ${l}` : l))
    .join("\n");
  const trailer = [`    await _real_asyncio.sleep(${maxRunS})`, "", "_real_asyncio.run(_flow_main())"];
  return [...outerPreamble, indentedSource, ...trailer].join("\n");
}

function runScheduledFlow(graph: GraphData, schedule: Record<number, Array<[number, 0 | 1]>>, maxRunS = 1.0): string[] {
  const { source } = compile(graph, buildRegistry());
  const scheduleLiteral = Object.entries(schedule)
    .map(([pin, entries]) => `${pin}: [${entries.map(([t, v]) => `(${t}, ${v})`).join(", ")}]`)
    .join(", ");
  const fullSource = buildRunnerScript(source, scheduleLiteral, maxRunS);

  const dir = mkdtempSync(join(tmpdir(), "thingstudio-ebutton-"));
  const scriptPath = join(dir, "_flow.py");
  writeFileSync(scriptPath, fullSource);
  const output = execFileSync("python3", [scriptPath], {
    env: { ...process.env, PYTHONPATH: `${pymockDir}${delimiter}${vendorDir}`, PYMOCK_MAX_RUN_S: String(maxRunS) },
    encoding: "utf8",
  });
  return [...output.matchAll(/'topic': '(\w+)'/g)].map((m) => m[1]!);
}

describe("thingstudio/ebutton node", () => {
  it("rejects an out-of-range pin", () => {
    expect(() => ebuttonNode.codegenEventSource!(node({ pin: 99 }), ctx)).toThrow(CompileError);
  });

  it("rejects an invalid senseMode", () => {
    expect(() => ebuttonNode.codegenEventSource!(node({ pin: 4, senseMode: "sideways" }), ctx)).toThrow(/auto.*0.*1/);
  });

  it("rejects doubleClickMs >= longPressMs", () => {
    expect(() => ebuttonNode.codegenEventSource!(node({ pin: 4, doubleClickMs: 1000, longPressMs: 1000 }), ctx)).toThrow(
      /doubleClickMs.*must be less than longPressMs/,
    );
  });

  it("defaults match EButton's own upstream defaults", () => {
    const result = ebuttonNode.codegenEventSource!(node({ pin: 4 }), ctx);
    const code = result.statements?.[0]?.code ?? "";
    expect(code).toContain("EButton.debounce_ms = 50");
    expect(code).toContain("EButton.long_press_ms = 1000");
    expect(code).toContain("EButton.double_click_ms = 400");
    expect(code).toContain("EButton(_ebutton_pin_4, suppress=False)");
  });

  it("passes an explicit sense value through when senseMode isn't auto", () => {
    const result = ebuttonNode.codegenEventSource!(node({ pin: 4, senseMode: "0" }), ctx);
    expect(result.statements?.[0]?.code).toContain("EButton(_ebutton_pin_4, suppress=False, sense=0)");
  });

  it("rejects an invalid pull value", () => {
    expect(() => ebuttonNode.codegenEventSource!(node({ pin: 4, pull: "sideways" }), ctx)).toThrow(
      /must be "none", "up", or "down"/,
    );
  });

  it("defaults pull to none -- no internal pull configured, matching this node's original 2026-09-08 behavior", () => {
    const result = ebuttonNode.codegenEventSource!(node({ pin: 4 }), ctx);
    expect(result.statements?.[0]?.code).toContain("machine.Pin(4, machine.Pin.IN)");
  });

  it("enables the internal pull-up when pull is 'up' -- real-hardware finding, TiDAL badge buttons", () => {
    const result = ebuttonNode.codegenEventSource!(node({ pin: 4, pull: "up" }), ctx);
    expect(result.statements?.[0]?.code).toContain("machine.Pin(4, machine.Pin.IN, machine.Pin.PULL_UP)");
  });

  it("compiles into a full flow with the expected structure", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/ebutton", properties: { pin: 7 } },
        { id: "2", type: "thingstudio/debug", properties: {} },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    const { source } = compile(graph, buildRegistry());
    expect(source).toContain("from events import EButton, WaitAny");
    expect(source).toContain("WaitAny([_ebutton_7.press, _ebutton_7.release, _ebutton_7.long, _ebutton_7.double])");
    expect(source).toContain("_trig.clear()");
    expect(source).toMatch(/runtime\.spawn\(/);
  });

  it("reports a real short press-then-release through the actual vendored EButton driver (no long/double)", () => {
    const graph: GraphData = {
      nodes: [
        {
          id: "1",
          type: "thingstudio/ebutton",
          properties: { pin: 11, senseMode: "0", debounceMs: 10, longPressMs: 300, doubleClickMs: 80 },
        },
        { id: "2", type: "thingstudio/debug", properties: { fullMessage: true } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    // senseMode 0: unpressed reads as electrical 0, pressed as electrical 1.
    // First real transition held off until 300ms -- comfortable margin
    // over real process/import startup time (python3 interpreter start,
    // module imports including the real vendored events.py/delay_ms.py),
    // so EButton's own constructor reads the correct "0, not pressed"
    // boot baseline rather than racing an edge that already happened
    // before construction (see this file's header note on this exact
    // failure mode, found while first writing this test). Press at 300ms,
    // release at 350ms -- a 50ms hold, well under the 300ms long-press
    // threshold, and no second press follows within the 100ms
    // double-click window.
    const topics = runScheduledFlow(graph, { 11: [[0.0, 0], [0.3, 1], [0.35, 0]] }, 1.2);
    expect(topics).toEqual(["press", "release"]);
  });

  it("reports a real long press through the actual vendored EButton driver", () => {
    const graph: GraphData = {
      nodes: [
        {
          id: "1",
          type: "thingstudio/ebutton",
          properties: { pin: 12, senseMode: "0", debounceMs: 10, longPressMs: 100, doubleClickMs: 50 },
        },
        { id: "2", type: "thingstudio/debug", properties: { fullMessage: true } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    // First real transition held off until 300ms, same startup-overhead
    // margin as the short-press test above. Held from 300ms to 500ms --
    // 200ms, comfortably past the 100ms long-press threshold, so `long`
    // fires while still held, before release.
    const topics = runScheduledFlow(graph, { 12: [[0.0, 0], [0.3, 1], [0.5, 0]] }, 1.2);
    expect(topics).toEqual(["press", "long", "release"]);
  });

  it("reports BOTH press and double on a rapid second click -- regression test for the WaitAny full-clear bug (see this file's header)", () => {
    const graph: GraphData = {
      nodes: [
        {
          id: "1",
          type: "thingstudio/ebutton",
          properties: { pin: 13, senseMode: "0", debounceMs: 10, longPressMs: 500, doubleClickMs: 120 },
        },
        { id: "2", type: "thingstudio/debug", properties: { fullMessage: true } },
      ],
      links: [[1, "1", 0, "2", 0, "bool"]],
    };
    // Same startup-overhead margin as the other two behavioral tests --
    // whole sequence shifted out by ~280ms, relative spacing unchanged.
    // Press #1 at 300ms, release at 330ms (30ms hold). Press #2 at 350ms --
    // 20ms after release #1, well inside the 120ms double-click window
    // that started ticking at press #1 -- so press #2's own _pf() finds
    // dtim still running and fires `double`, while ALSO firing `press`
    // unconditionally (suppress=False). Release #2 at 380ms.
    const topics = runScheduledFlow(
      graph,
      {
        13: [
          [0.0, 0],
          [0.3, 1],
          [0.33, 0],
          [0.35, 1],
          [0.38, 0],
        ],
      },
      1.2,
    );
    expect(topics).toContain("double");
    expect(topics.filter((t) => t === "press").length).toBe(2);
    expect(topics.filter((t) => t === "release").length).toBe(2);
    expect(topics).not.toContain("long");
  });
});
